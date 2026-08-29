import { compactVerify, importJWK, type JWK } from "jose";
import { z } from "zod";

import { parseJsonWithoutDuplicateKeys } from "./json.js";

const headerSchema = z
  .object({
    alg: z.literal("EdDSA"),
    kid: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
    typ: z.literal("w27-drive-write-approval+jws"),
  })
  .strict();

export type ProtectedApprovalHeader = z.infer<typeof headerSchema>;

export interface JwsVerifier {
  verify(compactJws: string, verificationKey: JWK): Promise<unknown>;
}

function compactParts(compactJws: string): [string, string, string] {
  const parts = compactJws.split(".");
  if (
    parts.length !== 3 ||
    parts.some(
      (part) =>
        part.length === 0 ||
        !/^[A-Za-z0-9_-]+$/.test(part) ||
        Buffer.from(part, "base64url").toString("base64url") !== part,
    )
  )
    throw new Error("invalid compact JWS serialization");
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature)
    throw new Error("missing compact JWS member");
  return [header, payload, signature];
}

function decodeJsonPart(value: string): unknown {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.from(value, "base64url"),
  );
  return parseJsonWithoutDuplicateKeys(decoded);
}

export function parseProtectedApprovalHeader(
  compactJws: string,
): ProtectedApprovalHeader {
  const [header] = compactParts(compactJws);
  return headerSchema.parse(decodeJsonPart(header));
}

function assertPublicEd25519Jwk(key: JWK): void {
  if (
    key.kty !== "OKP" ||
    key.crv !== "Ed25519" ||
    typeof key.x !== "string" ||
    "d" in key
  )
    throw new Error("expected public Ed25519 JWK");
}

export class Ed25519CompactJwsVerifier implements JwsVerifier {
  async verify(compactJws: string, verificationKey: JWK): Promise<unknown> {
    const [, payload] = compactParts(compactJws);
    parseProtectedApprovalHeader(compactJws);
    assertPublicEd25519Jwk(verificationKey);
    const key = await importJWK(verificationKey, "EdDSA");
    const verified = await compactVerify(compactJws, key, {
      algorithms: ["EdDSA"],
    });
    const verifiedPayload = Buffer.from(verified.payload).toString("base64url");
    if (verifiedPayload !== payload) throw new Error("JWS payload mismatch");
    return decodeJsonPart(payload);
  }
}
