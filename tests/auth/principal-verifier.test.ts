import { describe, expect, it } from "vitest";
import { AuthenticationError } from "../../src/auth/principal.js";
import {
  createPrincipalVerifier,
  type SecretTextReader,
  type WorkJwtVerifier,
} from "../../src/auth/principal-verifier.js";
import { parseServiceConfig } from "../../src/config/service-config.js";

function credential(seed = 0): string {
  return Buffer.from(
    Uint8Array.from({ length: 32 }, (_, index) => seed + index),
  ).toString("base64url");
}

function workJwtShape(): string {
  return ["header", "payload", "signature"]
    .map((part) => Buffer.from(part).toString("base64url"))
    .join(".");
}

function config() {
  return parseServiceConfig({
    drive: {
      authMode: "shared-drive-adc",
      rootFolderId: "root-folder",
      archiveFolderId: "archive-folder",
      sharedDriveId: "shared-drive",
      maxMarkdownBytes: 1_000_000,
      maxTraversalNodes: 1_000,
      maxPages: 10,
      maxResults: 100,
    },
    authentication: {
      workMcp: {
        issuer: "https://issuer.invalid/tenant",
        audience: "gateway-audience",
        jwksUrl: "https://keys.invalid/tenant/jwks",
        allowedAlgorithms: ["RS256"],
        clockToleranceSeconds: 15,
        jwksTimeoutMs: 5_000,
        jwksCacheMaxAgeMs: 60_000,
      },
      codex: { bearerSecretFile: "/var/run/secrets/codex-bearer" },
    },
    http: {
      maxRequestMarkdownBytes: 1_000_000,
      maxJsonBodyBytes: 6_004_096,
      maxResultItems: 100,
      maxJsonResponseBytes: 1_000_000,
      requestTimeoutMs: 5_000,
      rateLimitWindowMs: 60_000,
      maxRequestsPerWindow: 60,
      maxConcurrentRequestsPerPrincipal: 4,
      maxRateLimitPrincipals: 1_000,
    },
  });
}

function fakeWorkJwt(
  payload: Readonly<{ readonly iss?: unknown; readonly sub?: unknown }> = {
    iss: "https://issuer.invalid/tenant",
    sub: "work-subject",
  },
): WorkJwtVerifier {
  return async () => ({ payload });
}

function reader(value: () => string): SecretTextReader {
  return async () => value();
}

async function expectAuthenticationFailure(action: () => Promise<unknown>) {
  try {
    await action();
    throw new Error("expected authentication failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error).toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Authentication failed.",
    });
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  }
}

describe("principal verifier", () => {
  it("strictly parses Bearer authorization and returns only a normalized Work principal", async () => {
    let jwtCalls = 0;
    let secretCalls = 0;
    const verifier = createPrincipalVerifier(config(), {
      verifyWorkJwt: async (value) => {
        jwtCalls += 1;
        expect(value).toBe(workJwtShape());
        return fakeWorkJwt()("ignored");
      },
      readSecretText: async () => {
        secretCalls += 1;
        return credential();
      },
    });

    await expect(verifier.verify(`bEaReR ${workJwtShape()}`)).resolves.toEqual({
      kind: "work-mcp",
      subject: "work-subject",
      issuer: "https://issuer.invalid/tenant",
    });
    expect(jwtCalls).toBe(1);
    expect(secretCalls).toBe(0);
  });

  it("fails closed for malformed authorization and verified JWT failures", async () => {
    const rejectedWork: WorkJwtVerifier = async () => {
      throw new Error("provider detail must not escape");
    };
    const verifier = createPrincipalVerifier(config(), {
      verifyWorkJwt: rejectedWork,
      readSecretText: reader(credential),
    });
    for (const authorization of [
      undefined,
      ["Bearer anything"],
      "Basic value",
      "Bearer",
      "Bearer  value",
      "Bearer value, value",
      `Bearer ${"a".repeat(20_000)}`,
      `Bearer ${workJwtShape()}`,
    ]) {
      await expectAuthenticationFailure(() => verifier.verify(authorization));
    }
  });

  it("treats a JWT-shaped bearer only as Work and requires a verified issuer and subject", async () => {
    let secretCalls = 0;
    const verifier = createPrincipalVerifier(config(), {
      verifyWorkJwt: fakeWorkJwt({
        iss: "https://other.invalid/tenant",
        sub: "work-subject",
      }),
      readSecretText: async () => {
        secretCalls += 1;
        return credential();
      },
    });
    await expectAuthenticationFailure(() =>
      verifier.verify(`Bearer ${workJwtShape()}`),
    );
    expect(secretCalls).toBe(0);

    const missingSubject = createPrincipalVerifier(config(), {
      verifyWorkJwt: fakeWorkJwt({
        iss: "https://issuer.invalid/tenant",
        sub: " ",
      }),
      readSecretText: reader(credential),
    });
    await expectAuthenticationFailure(() =>
      missingSubject.verify(`Bearer ${workJwtShape()}`),
    );

    for (const sub of ["line\nbreak", "a".repeat(513)]) {
      const unsafeSubject = createPrincipalVerifier(config(), {
        verifyWorkJwt: fakeWorkJwt({
          iss: "https://issuer.invalid/tenant",
          sub,
        }),
        readSecretText: reader(credential),
      });
      await expectAuthenticationFailure(() =>
        unsafeSubject.verify(`Bearer ${workJwtShape()}`),
      );
    }
  });

  it("reads the Codex secret on every comparison and never routes it to JWT verification", async () => {
    let current = credential();
    let reads = 0;
    let jwtCalls = 0;
    const verifier = createPrincipalVerifier(config(), {
      verifyWorkJwt: async () => {
        jwtCalls += 1;
        return fakeWorkJwt()("ignored");
      },
      readSecretText: async () => {
        reads += 1;
        return `${current}\n`;
      },
    });

    await expect(verifier.verify(`Bearer ${current}`)).resolves.toEqual({
      kind: "codex",
      subject: "codex",
      issuer: "gateway-codex-bearer",
    });
    current = credential(1);
    await expect(verifier.verify(`Bearer ${current}`)).resolves.toMatchObject({
      kind: "codex",
    });
    expect(reads).toBe(2);
    expect(jwtCalls).toBe(0);
  });

  it("collapses Codex mismatch, malformed secret, and reader failures to one public error", async () => {
    const supplied = credential();
    for (const readSecretText of [
      reader(() => credential(1)),
      reader(() => `${credential()}\n\n`),
      async () => Promise.reject(new Error("reader detail must not escape")),
    ]) {
      const verifier = createPrincipalVerifier(config(), {
        verifyWorkJwt: fakeWorkJwt(),
        readSecretText,
      });
      await expectAuthenticationFailure(() =>
        verifier.verify(`Bearer ${supplied}`),
      );
    }
  });

  it("does not retain authorization, secrets, or provider errors in the public failure", async () => {
    const value = credential();
    const verifier = createPrincipalVerifier(config(), {
      verifyWorkJwt: async () => {
        throw new Error(value);
      },
      readSecretText: reader(credential),
    });
    try {
      await verifier.verify(`Bearer ${workJwtShape()}`);
    } catch (error) {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(value);
      expect(serialized).not.toContain(workJwtShape());
      expect(serialized).not.toContain("issuer.invalid");
    }
  });
});
