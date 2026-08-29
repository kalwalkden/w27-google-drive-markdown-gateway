import type { LiveDriveEvidence, ProbeCheck } from "../live-drive/evidence.js";

export type EvidenceProofFailure =
  | "evidence-not-supported"
  | "evidence-cleanup-not-archived"
  | "evidence-atomic-proof-missing"
  | "evidence-auth-topology-invalid";

export type EvidenceProofResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: EvidenceProofFailure };

interface RequiredCheck {
  readonly id: string;
  readonly actor: ProbeCheck["actor"];
  readonly endpoint: ProbeCheck["endpoint"];
  readonly method: ProbeCheck["method"];
  readonly expected: ProbeCheck["expected"];
  readonly requiresIfMatch?: boolean;
  readonly requiresOperationSuccess?: boolean;
  readonly requires412?: boolean;
  readonly requiresReadback?: boolean;
}

const requiredChecks: readonly RequiredCheck[] = [
  {
    id: "preflight-root",
    actor: "system",
    endpoint: "metadata",
    method: "GET",
    expected: "marked-test-root",
    requiresOperationSuccess: true,
  },
  {
    id: "preflight-archive",
    actor: "system",
    endpoint: "metadata",
    method: "GET",
    expected: "direct-child-archive",
    requiresOperationSuccess: true,
  },
  {
    id: "create",
    actor: "actor-a",
    endpoint: "create",
    method: "POST",
    expected: "create-disposable-markdown",
    requiresOperationSuccess: true,
  },
  {
    id: "create-download",
    actor: "actor-a",
    endpoint: "download",
    method: "GET",
    expected: "create-download-match",
    requiresReadback: true,
  },
  {
    id: "actor-b-s0",
    actor: "actor-b",
    endpoint: "metadata",
    method: "GET",
    expected: "actor-b-s0-match",
    requiresReadback: true,
  },
  {
    id: "fresh-content-update",
    actor: "actor-b",
    endpoint: "content-update",
    method: "PATCH",
    expected: "fresh-content-update",
    requiresIfMatch: true,
    requiresOperationSuccess: true,
    requiresReadback: true,
  },
  {
    id: "fresh-content-update-second",
    actor: "actor-b",
    endpoint: "content-update",
    method: "PATCH",
    expected: "second-fresh-content-update",
    requiresIfMatch: true,
    requiresOperationSuccess: true,
    requiresReadback: true,
  },
  {
    id: "stale-content-update",
    actor: "actor-a",
    endpoint: "content-update",
    method: "PATCH",
    expected: "stale-content-rejected",
    requiresIfMatch: true,
    requires412: true,
    requiresReadback: true,
  },
  {
    id: "stale-parent-move",
    actor: "actor-a",
    endpoint: "parent-move",
    method: "PATCH",
    expected: "stale-parent-rejected",
    requiresIfMatch: true,
    requires412: true,
    requiresReadback: true,
  },
];

interface ReadbackSnapshot {
  readonly version: string;
  readonly headRevisionId?: string;
  readonly responseEtag: string;
  readonly opaqueFileRef: string;
  readonly opaqueParentRefs: readonly string[];
  readonly payloadSha256: string;
  readonly payloadByteLength: number;
}

function is2xx(status: number | undefined): boolean {
  return status !== undefined && status >= 200 && status < 300;
}

function readbackSnapshot(check: ProbeCheck): ReadbackSnapshot | undefined {
  const readback = check.readback;
  if (
    !readback ||
    !is2xx(readback.metadataStatus) ||
    !is2xx(readback.downloadStatus) ||
    !readback.version ||
    !/^\d+$/.test(readback.version) ||
    !readback.responseEtag ||
    !readback.opaqueFileRef ||
    readback.opaqueParentRefs?.length !== 1 ||
    !readback.payloadSha256 ||
    readback.payloadByteLength === undefined
  )
    return undefined;
  return {
    version: readback.version,
    headRevisionId: readback.headRevisionId,
    responseEtag: readback.responseEtag,
    opaqueFileRef: readback.opaqueFileRef,
    opaqueParentRefs: readback.opaqueParentRefs,
    payloadSha256: readback.payloadSha256,
    payloadByteLength: readback.payloadByteLength,
  };
}

function sameReadback(
  left: ReadbackSnapshot,
  right: ReadbackSnapshot,
): boolean {
  return (
    left.version === right.version &&
    left.headRevisionId === right.headRevisionId &&
    left.responseEtag === right.responseEtag &&
    left.opaqueFileRef === right.opaqueFileRef &&
    left.opaqueParentRefs.length === right.opaqueParentRefs.length &&
    left.opaqueParentRefs.every(
      (parent, index) => parent === right.opaqueParentRefs[index],
    ) &&
    left.payloadSha256 === right.payloadSha256 &&
    left.payloadByteLength === right.payloadByteLength
  );
}

function matchingRequiredCheck(
  checks: readonly ProbeCheck[],
  required: RequiredCheck,
): ProbeCheck | undefined {
  const matching = checks.filter((check) => check.id === required.id);
  if (matching.length !== 1) return undefined;
  const [check] = matching;
  if (
    !check ||
    check.actor !== required.actor ||
    check.endpoint !== required.endpoint ||
    check.method !== required.method ||
    check.expected !== required.expected ||
    !check.passed ||
    check.reason !== "ok" ||
    !check.supportsAllDrivesSent ||
    (required.requiresIfMatch && (!check.ifMatchSent || !check.ifMatchEtag)) ||
    (required.requiresOperationSuccess && !is2xx(check.operationStatus)) ||
    (required.requires412 && check.operationStatus !== 412) ||
    (required.requiresReadback && !readbackSnapshot(check))
  )
    return undefined;
  return check;
}

function cleanupIsVerified(evidence: LiveDriveEvidence): boolean {
  return (
    (evidence.cleanup.status === "ARCHIVED" &&
      (evidence.cleanup.reason === "archived" ||
        evidence.cleanup.reason === "archived-with-unconditional-fallback")) ||
    (evidence.cleanup.status === "ALREADY_ARCHIVED" &&
      evidence.cleanup.reason === "already-archived")
  );
}

export function validateAtomicDriveProof(
  evidence: LiveDriveEvidence,
): EvidenceProofResult {
  if (evidence.outcome !== "SUPPORTED")
    return { valid: false, reason: "evidence-not-supported" };
  if (
    evidence.cleanup.status !== "ARCHIVED" &&
    evidence.cleanup.status !== "ALREADY_ARCHIVED"
  )
    return { valid: false, reason: "evidence-cleanup-not-archived" };
  if (!cleanupIsVerified(evidence))
    return { valid: false, reason: "evidence-cleanup-not-archived" };
  if (
    (evidence.authMode === "shared-drive-adc" &&
      evidence.topology !== "shared-drive") ||
    (evidence.authMode === "my-drive-refresh-token" &&
      evidence.topology !== "my-drive")
  )
    return { valid: false, reason: "evidence-auth-topology-invalid" };

  const checks = new Map(
    requiredChecks.map((required) => [
      required.id,
      matchingRequiredCheck(evidence.checks, required),
    ]),
  );
  const createDownload = checks.get("create-download");
  const actorBS0 = checks.get("actor-b-s0");
  const freshContent = checks.get("fresh-content-update");
  const staleContent = checks.get("stale-content-update");
  const freshContentSecond = checks.get("fresh-content-update-second");
  const staleParent = checks.get("stale-parent-move");
  if (
    !requiredChecks.every((required) => checks.get(required.id)) ||
    !createDownload ||
    !actorBS0 ||
    !freshContent ||
    !staleContent ||
    !freshContentSecond ||
    !staleParent
  )
    return { valid: false, reason: "evidence-atomic-proof-missing" };

  const snapshots = [
    createDownload,
    actorBS0,
    freshContent,
    staleContent,
    freshContentSecond,
    staleParent,
  ].map(readbackSnapshot);
  if (snapshots.some((snapshot) => !snapshot))
    return { valid: false, reason: "evidence-atomic-proof-missing" };
  const [s0, bS0, s1, staleContentAfter, s2, staleParentAfter] = snapshots as [
    ReadbackSnapshot,
    ReadbackSnapshot,
    ReadbackSnapshot,
    ReadbackSnapshot,
    ReadbackSnapshot,
    ReadbackSnapshot,
  ];
  const stableFileRef = [
    bS0,
    s1,
    staleContentAfter,
    s2,
    staleParentAfter,
  ].every((snapshot) => snapshot.opaqueFileRef === s0.opaqueFileRef);
  const stableParentRef = [
    bS0,
    s1,
    staleContentAfter,
    s2,
    staleParentAfter,
  ].every(
    (snapshot) => snapshot.opaqueParentRefs[0] === s0.opaqueParentRefs[0],
  );
  const monotonicVersions =
    BigInt(s1.version) >= BigInt(s0.version) &&
    BigInt(s2.version) >= BigInt(s1.version);
  const correctlyBoundIfMatch =
    freshContent.ifMatchEtag === bS0.responseEtag &&
    staleContent.ifMatchEtag === s0.responseEtag &&
    freshContentSecond.ifMatchEtag === s1.responseEtag &&
    staleParent.ifMatchEtag === s1.responseEtag;
  if (
    !sameReadback(s0, bS0) ||
    !sameReadback(s1, staleContentAfter) ||
    !sameReadback(s2, staleParentAfter) ||
    !stableFileRef ||
    !stableParentRef ||
    !monotonicVersions ||
    !correctlyBoundIfMatch ||
    s0.payloadSha256 === s1.payloadSha256 ||
    s1.payloadSha256 === s2.payloadSha256
  )
    return { valid: false, reason: "evidence-atomic-proof-missing" };
  return { valid: true };
}
