export const writeGateDenialReasons = [
  "runtime-trust-invalid",
  "evidence-malformed",
  "evidence-bytes-mismatch",
  "evidence-not-supported",
  "evidence-cleanup-not-archived",
  "evidence-atomic-proof-missing",
  "evidence-auth-topology-invalid",
  "evidence-after-approval",
  "evidence-too-old",
  "approval-header-invalid",
  "approval-key-unknown",
  "approval-signature-invalid",
  "approval-malformed",
  "approval-digest-mismatch",
  "approval-binding-mismatch",
  "approval-issued-in-future",
  "approval-expired",
  "approval-lifetime-invalid",
  "approval-replayed",
  "approval-store-unavailable",
  "lease-invalid",
  "lease-expired",
  "lease-generation-failed",
] as const;

export type WriteGateDenialReason = (typeof writeGateDenialReasons)[number];

export interface AllowedWriteGateAudit {
  readonly event: "write-gate-evaluated";
  readonly decision: "allowed";
  readonly reason: "approved";
}

export interface DeniedWriteGateAudit {
  readonly event: "write-gate-evaluated";
  readonly decision: "denied";
  readonly reason: WriteGateDenialReason;
}

export function allowedAudit(): AllowedWriteGateAudit {
  return {
    event: "write-gate-evaluated",
    decision: "allowed",
    reason: "approved",
  };
}

export function deniedAudit(
  reason: WriteGateDenialReason,
): DeniedWriteGateAudit {
  return { event: "write-gate-evaluated", decision: "denied", reason };
}
