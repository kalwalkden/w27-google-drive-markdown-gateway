import { timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";

import { createRemoteJWKSet, jwtVerify } from "jose";

import type {
  SecretFileReference,
  ServiceConfig,
} from "../config/service-config.js";
import {
  AuthenticationError,
  type AuthenticatedPrincipal,
  type PrincipalVerifier,
} from "./principal.js";

export const maxAuthorizationBytes = 16_384;
export const maxCodexSecretFileBytes = 1_024;
export const maxCodexCredentialBytes = 512;
export const maxPrincipalSubjectBytes = 512;
const minCodexCredentialBytes = 16;

export interface VerifiedWorkJwt {
  readonly payload: Readonly<{
    readonly iss?: unknown;
    readonly sub?: unknown;
  }>;
}

export type WorkJwtVerifier = (token: string) => Promise<VerifiedWorkJwt>;
export type SecretTextReader = (
  reference: SecretFileReference,
  maximumBytes: number,
) => Promise<string>;

export interface PrincipalVerifierDependencies {
  /**
   * Test seams are explicit; production uses the configured remote JWKS and mounted-file reader.
   */
  readonly verifyWorkJwt?: WorkJwtVerifier;
  readonly readSecretText?: SecretTextReader;
}

function isCompactJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value);
}

function parseBearerValue(authorization: unknown): string {
  if (
    typeof authorization !== "string" ||
    Buffer.byteLength(authorization, "utf8") > maxAuthorizationBytes
  ) {
    throw new Error("invalid authorization");
  }
  const match = /^Bearer ([!-~]+)$/iu.exec(authorization);
  const value = match?.[1];
  if (!value || value.includes(",")) throw new Error("invalid authorization");
  return value;
}

function isCodexCredential(value: string): boolean {
  if (
    Buffer.byteLength(value, "utf8") > maxCodexCredentialBytes ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  return (
    decoded.byteLength >= minCodexCredentialBytes &&
    decoded.byteLength <= maxCodexCredentialBytes &&
    decoded.toString("base64url") === value
  );
}

function parseCodexSecret(value: string): string {
  const normalized = value.endsWith("\r\n")
    ? value.slice(0, -2)
    : value.endsWith("\n")
      ? value.slice(0, -1)
      : value;
  if (!isCodexCredential(normalized)) throw new Error("invalid secret");
  return normalized;
}

function isSafePrincipalSubject(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= maxPrincipalSubjectBytes &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint < 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029
      );
    })
  );
}

async function readMountedSecret(
  reference: SecretFileReference,
  maximumBytes: number,
): Promise<string> {
  const handle = await open(reference, "r");
  try {
    const content = Buffer.alloc(maximumBytes + 1);
    const { bytesRead } = await handle.read(content, 0, content.byteLength, 0);
    if (bytesRead > maximumBytes) throw new Error("secret exceeds bound");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      content.subarray(0, bytesRead),
    );
  } finally {
    await handle.close();
  }
}

function createConfiguredWorkJwtVerifier(
  config: ServiceConfig,
): WorkJwtVerifier {
  const workMcp = config.authentication.workMcp;
  const resolver = createRemoteJWKSet(new URL(workMcp.jwksUrl), {
    timeoutDuration: workMcp.jwksTimeoutMs,
    cacheMaxAge: workMcp.jwksCacheMaxAgeMs,
  });
  return async (token) => {
    const verified = await jwtVerify(token, resolver, {
      issuer: workMcp.issuer,
      audience: workMcp.audience,
      algorithms: [...workMcp.allowedAlgorithms],
      clockTolerance: workMcp.clockToleranceSeconds,
    });
    return { payload: verified.payload };
  };
}

class ConfiguredPrincipalVerifier implements PrincipalVerifier {
  constructor(
    private readonly config: ServiceConfig,
    private readonly verifyWorkJwt: WorkJwtVerifier,
    private readonly readSecretText: SecretTextReader,
  ) {}

  async verify(authorization: unknown): Promise<AuthenticatedPrincipal> {
    try {
      const value = parseBearerValue(authorization);
      if (isCompactJwt(value)) return await this.verifyWork(value);
      return await this.verifyCodex(value);
    } catch {
      throw new AuthenticationError();
    }
  }

  private async verifyWork(token: string): Promise<AuthenticatedPrincipal> {
    const verified = await this.verifyWorkJwt(token);
    const { iss, sub } = verified.payload;
    if (
      iss !== this.config.authentication.workMcp.issuer ||
      !isSafePrincipalSubject(sub)
    ) {
      throw new Error("invalid verified claims");
    }
    return { kind: "work-mcp", subject: sub, issuer: iss };
  }

  private async verifyCodex(value: string): Promise<AuthenticatedPrincipal> {
    if (!isCodexCredential(value)) throw new Error("invalid credential");
    const secret = parseCodexSecret(
      await this.readSecretText(
        this.config.authentication.codex.bearerSecretFile,
        maxCodexSecretFileBytes,
      ),
    );
    const expected = Buffer.from(secret, "utf8");
    const supplied = Buffer.from(value, "utf8");
    if (
      expected.byteLength !== supplied.byteLength ||
      !timingSafeEqual(expected, supplied)
    ) {
      throw new Error("credential mismatch");
    }
    return {
      kind: "codex",
      subject: "codex",
      issuer: "gateway-codex-bearer",
    };
  }
}

/**
 * Builds a verifier without reading credentials or contacting the configured JWKS until a
 * verification occurs.
 */
export function createPrincipalVerifier(
  config: ServiceConfig,
  dependencies: PrincipalVerifierDependencies = {},
): PrincipalVerifier {
  return new ConfiguredPrincipalVerifier(
    config,
    dependencies.verifyWorkJwt ?? createConfiguredWorkJwtVerifier(config),
    dependencies.readSecretText ?? readMountedSecret,
  );
}
