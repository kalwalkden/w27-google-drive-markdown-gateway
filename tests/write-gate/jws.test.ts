import { CompactSign, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";

import {
  Ed25519CompactJwsVerifier,
  parseProtectedApprovalHeader,
} from "../../src/write-gate/jws.js";
import { evidenceBytes, validApproval, validEvidence } from "./fixtures.js";

const encoder = new TextEncoder();

async function signedJws(
  payload: string,
  header: Record<string, unknown> = {},
): Promise<{
  compact: string;
  publicJwk: Awaited<ReturnType<typeof exportJWK>>;
}> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
  });
  const compact = await new CompactSign(encoder.encode(payload))
    .setProtectedHeader({
      alg: "EdDSA",
      kid: "generated-test-key",
      typ: "w27-drive-write-approval+jws",
      ...header,
    })
    .sign(privateKey);
  return { compact, publicJwk: await exportJWK(publicKey) };
}

describe("Ed25519 compact JWS verifier", () => {
  it("verifies a generated, valid JWS without retaining a signing key", async () => {
    const bytes = evidenceBytes(validEvidence());
    const { compact, publicJwk } = await signedJws(
      JSON.stringify(validApproval(bytes)),
    );
    await expect(
      new Ed25519CompactJwsVerifier().verify(compact, publicJwk),
    ).resolves.toMatchObject({ schemaVersion: 1 });
  });

  it("rejects algorithm confusion, embedded keys, tampering, and duplicate claims", async () => {
    expect(() => parseProtectedApprovalHeader("not-a-jws")).toThrow();
    expect(() =>
      parseProtectedApprovalHeader(
        `${Buffer.from(JSON.stringify({ alg: "none", kid: "key", typ: "w27-drive-write-approval+jws" })).toString("base64url")}.e30.c2ln`,
      ),
    ).toThrow();
    expect(() =>
      parseProtectedApprovalHeader(
        `${Buffer.from('{"alg":"EdDSA","kid":"first","kid":"second","typ":"w27-drive-write-approval+jws"}').toString("base64url")}.e30.c2ln`,
      ),
    ).toThrow();
    expect(() =>
      parseProtectedApprovalHeader(
        `${Buffer.from(JSON.stringify({ alg: "EdDSA", kid: "key", typ: "w27-drive-write-approval+jws", jwk: {} })).toString("base64url")}.e30.c2ln`,
      ),
    ).toThrow();

    const bytes = evidenceBytes(validEvidence());
    const { compact, publicJwk } = await signedJws(
      JSON.stringify(validApproval(bytes)),
    );
    const [header, payload] = compact.split(".");
    await expect(
      new Ed25519CompactJwsVerifier().verify(
        `${header}.${payload}.c2ln`,
        publicJwk,
      ),
    ).rejects.toThrow();

    const duplicatePayload = `{"schemaVersion":1,"schemaVersion":1}`;
    const duplicate = await signedJws(duplicatePayload);
    await expect(
      new Ed25519CompactJwsVerifier().verify(
        duplicate.compact,
        duplicate.publicJwk,
      ),
    ).rejects.toThrow();
  });
});
