import type { JWK } from "jose";

import type { WriteApprovalBinding } from "./approval.js";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface RuntimeWriteGateTrust extends WriteApprovalBinding {
  /** Public Ed25519 verification keys, provisioned outside this repository. */
  readonly verificationKeys: Readonly<Record<string, JWK>>;
  readonly maxApprovalLifetimeMs: number;
  readonly maxEvidenceAgeMs: number;
  readonly clockSkewMs: number;
  readonly leaseLifetimeMs: number;
}

export function isValidRuntimeWriteGateTrust(
  trust: RuntimeWriteGateTrust,
): boolean {
  const positiveInteger = (value: number, maximum: number): boolean =>
    Number.isSafeInteger(value) && value > 0 && value <= maximum;
  return (
    trust.gatewayEnvironment.length > 0 &&
    trust.gatewayEnvironment.length <= 128 &&
    /^sha256:[a-f0-9]{64}$/.test(trust.driveConfigurationFingerprint) &&
    (trust.authMode === "shared-drive-adc" ||
      trust.authMode === "my-drive-refresh-token") &&
    (trust.topology === "shared-drive" || trust.topology === "my-drive") &&
    positiveInteger(trust.maxApprovalLifetimeMs, 86_400_000) &&
    positiveInteger(trust.maxEvidenceAgeMs, 2_592_000_000) &&
    Number.isSafeInteger(trust.clockSkewMs) &&
    trust.clockSkewMs >= 0 &&
    trust.clockSkewMs <= 300_000 &&
    positiveInteger(trust.leaseLifetimeMs, 300_000) &&
    Object.keys(trust.verificationKeys).length > 0 &&
    Object.values(trust.verificationKeys).every(
      (key) =>
        key.kty === "OKP" &&
        key.crv === "Ed25519" &&
        typeof key.x === "string" &&
        !key.d,
    )
  );
}
