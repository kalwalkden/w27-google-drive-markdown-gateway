import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  parseLiveDriveEvidence,
  type LiveDriveEvidence,
} from "../live-drive/evidence.js";
import {
  allowedAudit,
  deniedAudit,
  type AllowedWriteGateAudit,
  type DeniedWriteGateAudit,
  type WriteGateDenialReason,
} from "./audit.js";
import { parseWriteApproval, type WriteApproval } from "./approval.js";
import { validateAtomicDriveProof } from "./evidence-proof.js";
import {
  Ed25519CompactJwsVerifier,
  parseProtectedApprovalHeader,
  type JwsVerifier,
} from "./jws.js";
import { parseJsonWithoutDuplicateKeys } from "./json.js";
import type { ConsumedApprovalStore } from "./replay-store.js";
import {
  isValidRuntimeWriteGateTrust,
  systemClock,
  type Clock,
  type RuntimeWriteGateTrust,
} from "./trust.js";

export const maxEvidenceBytes = 1_000_000;
export const maxCompactJwsBytes = 16_384;

export interface WriteLease {
  /** Opaque process-local capability. It is never suitable for logs or durable storage. */
  readonly value: string;
}

export type WriteGateDecision =
  | {
      readonly allowed: true;
      readonly lease: WriteLease;
      readonly audit: AllowedWriteGateAudit;
    }
  | {
      readonly allowed: false;
      readonly reason: WriteGateDenialReason;
      readonly audit: DeniedWriteGateAudit;
    };

export interface WriteGateInput {
  /** Exact UTF-8 bytes of the sanitized evidence document the approval binds to. */
  readonly evidenceBytes: Uint8Array;
  /** Parsed evidence supplied by the caller; it must exactly match evidenceBytes. */
  readonly evidence: LiveDriveEvidence;
  readonly approvalJws: string;
}

export interface WriteGateDependencies {
  readonly trust: RuntimeWriteGateTrust;
  readonly replayStore: ConsumedApprovalStore;
  readonly clock?: Clock;
  readonly verifier?: JwsVerifier;
  readonly randomBytes?: (size: number) => Uint8Array;
}

interface LeaseRecord {
  readonly expiresAtMs: number;
}

function deny(reason: WriteGateDenialReason): WriteGateDecision {
  return { allowed: false, reason, audit: deniedAudit(reason) };
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactlyMatches(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function parseEvidenceBytes(bytes: Uint8Array): LiveDriveEvidence {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return parseLiveDriveEvidence(parseJsonWithoutDuplicateKeys(source));
}

function isLeaseValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, "base64url").length === 32 &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}

function sameEvidence(
  evidenceFromBytes: LiveDriveEvidence,
  suppliedEvidence: LiveDriveEvidence,
): boolean {
  try {
    return (
      JSON.stringify(evidenceFromBytes) ===
      JSON.stringify(parseLiveDriveEvidence(suppliedEvidence))
    );
  } catch {
    return false;
  }
}

function approvalMatchesTrust(
  approval: WriteApproval,
  evidence: LiveDriveEvidence,
  trust: RuntimeWriteGateTrust,
): boolean {
  return (
    approval.gatewayEnvironment === trust.gatewayEnvironment &&
    approval.driveConfigurationFingerprint ===
      trust.driveConfigurationFingerprint &&
    approval.authMode === trust.authMode &&
    approval.topology === trust.topology &&
    approval.authMode === evidence.authMode &&
    approval.topology === evidence.topology
  );
}

function approvalTimeFailure(
  approval: WriteApproval,
  evidence: LiveDriveEvidence,
  now: Date,
  trust: RuntimeWriteGateTrust,
): WriteGateDenialReason | undefined {
  const issuedAt = Date.parse(approval.issuedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  const evidenceFinishedAt = Date.parse(evidence.finishedAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt))
    return "approval-malformed";
  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > trust.maxApprovalLifetimeMs
  )
    return "approval-lifetime-invalid";
  if (issuedAt > now.getTime() + trust.clockSkewMs)
    return "approval-issued-in-future";
  if (expiresAt <= now.getTime() - trust.clockSkewMs) return "approval-expired";
  if (evidenceFinishedAt > issuedAt + trust.clockSkewMs)
    return "evidence-after-approval";
  if (
    now.getTime() - evidenceFinishedAt >
    trust.maxEvidenceAgeMs + trust.clockSkewMs
  )
    return "evidence-too-old";
  return undefined;
}

/**
 * Default-deny write capability issuer. A lease is process-local and only remains usable for the
 * short lifetime set in deployment trust; restart, expiry, or a fabricated value always denies.
 */
export class WriteGate {
  private readonly clock: Clock;
  private readonly verifier: JwsVerifier;
  private readonly random: (size: number) => Uint8Array;
  private readonly leases = new Map<string, LeaseRecord>();

  constructor(private readonly dependencies: WriteGateDependencies) {
    this.clock = dependencies.clock ?? systemClock;
    this.verifier = dependencies.verifier ?? new Ed25519CompactJwsVerifier();
    this.random = dependencies.randomBytes ?? randomBytes;
  }

  async evaluate(input: WriteGateInput): Promise<WriteGateDecision> {
    const { trust } = this.dependencies;
    try {
      if (!isValidRuntimeWriteGateTrust(trust))
        return deny("runtime-trust-invalid");
    } catch {
      return deny("runtime-trust-invalid");
    }

    if (
      !input ||
      typeof input !== "object" ||
      !(input.evidenceBytes instanceof Uint8Array) ||
      input.evidenceBytes.byteLength > maxEvidenceBytes
    )
      return deny("evidence-malformed");
    let evidence: LiveDriveEvidence;
    try {
      evidence = parseEvidenceBytes(input.evidenceBytes);
    } catch {
      return deny("evidence-malformed");
    }
    if (!sameEvidence(evidence, input.evidence))
      return deny("evidence-bytes-mismatch");
    const proof = validateAtomicDriveProof(evidence);
    if (!proof.valid) return deny(proof.reason);

    if (
      typeof input.approvalJws !== "string" ||
      Buffer.byteLength(input.approvalJws, "utf8") > maxCompactJwsBytes
    )
      return deny("approval-header-invalid");
    let header: ReturnType<typeof parseProtectedApprovalHeader>;
    try {
      header = parseProtectedApprovalHeader(input.approvalJws);
    } catch {
      return deny("approval-header-invalid");
    }
    const verificationKey = Object.hasOwn(trust.verificationKeys, header.kid)
      ? trust.verificationKeys[header.kid]
      : undefined;
    if (!verificationKey) return deny("approval-key-unknown");

    let approvalPayload: unknown;
    try {
      approvalPayload = await this.verifier.verify(
        input.approvalJws,
        verificationKey,
      );
    } catch {
      return deny("approval-signature-invalid");
    }
    let approval: WriteApproval;
    try {
      approval = parseWriteApproval(approvalPayload);
    } catch {
      return deny("approval-malformed");
    }
    if (!exactlyMatches(approval.evidenceSha256, sha256(input.evidenceBytes)))
      return deny("approval-digest-mismatch");
    if (!approvalMatchesTrust(approval, evidence, trust))
      return deny("approval-binding-mismatch");
    const now = this.clock.now();
    const timeFailure = approvalTimeFailure(approval, evidence, now, trust);
    if (timeFailure) return deny(timeFailure);
    const approvalExpiresAt = Date.parse(approval.expiresAt);
    if (approvalExpiresAt <= now.getTime()) return deny("approval-expired");

    let consumed: boolean;
    try {
      consumed = await this.dependencies.replayStore.consumeOnce(
        approval.approvalId,
        new Date(Date.parse(approval.expiresAt)),
      );
    } catch {
      return deny("approval-store-unavailable");
    }
    if (!consumed) return deny("approval-replayed");

    const leaseExpiresAtMs = Math.min(
      now.getTime() + trust.leaseLifetimeMs,
      approvalExpiresAt,
    );
    if (leaseExpiresAtMs <= now.getTime()) return deny("approval-expired");
    let material: Uint8Array;
    try {
      material = this.random(32);
    } catch {
      return deny("lease-generation-failed");
    }
    if (!(material instanceof Uint8Array) || material.byteLength !== 32)
      return deny("lease-generation-failed");
    const lease = { value: Buffer.from(material).toString("base64url") };
    if (!isLeaseValue(lease.value)) return deny("lease-generation-failed");
    this.removeExpiredLeases(now.getTime());
    this.leases.set(lease.value, {
      expiresAtMs: leaseExpiresAtMs,
    });
    return { allowed: true, lease, audit: allowedAudit() };
  }

  /** Future mutation boundaries call this immediately before sending a Drive request. */
  validateLease(lease: WriteLease): WriteGateDecision {
    const now = this.clock.now().getTime();
    let value: unknown;
    try {
      value = lease?.value;
    } catch {
      return deny("lease-invalid");
    }
    if (!isLeaseValue(value)) return deny("lease-invalid");
    const record = this.leases.get(value);
    if (!record) return deny("lease-invalid");
    if (record.expiresAtMs <= now) {
      this.leases.delete(value);
      return deny("lease-expired");
    }
    this.removeExpiredLeases(now);
    return { allowed: true, lease: { value }, audit: allowedAudit() };
  }

  private removeExpiredLeases(now: number): void {
    for (const [value, record] of this.leases) {
      if (record.expiresAtMs <= now) this.leases.delete(value);
    }
  }
}
