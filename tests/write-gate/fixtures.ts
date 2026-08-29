import { createHash } from "node:crypto";

import type {
  LiveDriveEvidence,
  ProbeCheck,
} from "../../src/live-drive/evidence.js";
import type { WriteApproval } from "../../src/write-gate/approval.js";
import type { RuntimeWriteGateTrust } from "../../src/write-gate/trust.js";

const digest = "a".repeat(64);
const opaque = "b".repeat(64);

function snapshotValues(id: string): {
  responseEtag: string;
  version: string;
  headRevisionId: string;
  payloadSha256: string;
} {
  if (id === "fresh-content-update" || id === "stale-content-update")
    return {
      responseEtag: '"etag-v2"',
      version: "2",
      headRevisionId: "example-head-revision-2",
      payloadSha256: "c".repeat(64),
    };
  if (id === "fresh-content-update-second" || id === "stale-parent-move")
    return {
      responseEtag: '"etag-v3"',
      version: "3",
      headRevisionId: "example-head-revision-3",
      payloadSha256: "d".repeat(64),
    };
  return {
    responseEtag: '"etag-v1"',
    version: "1",
    headRevisionId: "example-head-revision-1",
    payloadSha256: digest,
  };
}

function successfulCheck(
  id: string,
  actor: ProbeCheck["actor"],
  endpoint: ProbeCheck["endpoint"],
  method: ProbeCheck["method"],
  expected: ProbeCheck["expected"],
  httpStatus = 200,
  ifMatchSent = false,
): ProbeCheck {
  const snapshot = snapshotValues(id);
  return {
    id,
    actor,
    endpoint,
    method,
    ifMatchSent,
    ifMatchEtag:
      id === "fresh-content-update" || id === "stale-content-update"
        ? '"etag-v1"'
        : id === "fresh-content-update-second" || id === "stale-parent-move"
          ? '"etag-v2"'
          : undefined,
    supportsAllDrivesSent: true,
    operationStatus: httpStatus,
    operationEtag: "example-operation-etag",
    readback: {
      metadataStatus: 200,
      downloadStatus: 200,
      responseEtag: snapshot.responseEtag,
      version: snapshot.version,
      headRevisionId: snapshot.headRevisionId,
      opaqueFileRef: opaque,
      opaqueParentRefs: [opaque],
      payloadSha256: snapshot.payloadSha256,
      payloadByteLength: 12,
    },
    expected,
    passed: true,
    reason: "ok",
  };
}

export function validEvidence(): LiveDriveEvidence {
  return {
    schemaVersion: 2,
    probeVersion: "2",
    runId: "00000000-0000-4000-8000-000000000000",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    authMode: "shared-drive-adc",
    topology: "shared-drive",
    outcome: "SUPPORTED",
    checks: [
      successfulCheck(
        "preflight-root",
        "system",
        "metadata",
        "GET",
        "marked-test-root",
      ),
      successfulCheck(
        "preflight-archive",
        "system",
        "metadata",
        "GET",
        "direct-child-archive",
      ),
      successfulCheck(
        "create",
        "actor-a",
        "create",
        "POST",
        "create-disposable-markdown",
      ),
      successfulCheck(
        "create-download",
        "actor-a",
        "download",
        "GET",
        "create-download-match",
      ),
      successfulCheck(
        "actor-b-s0",
        "actor-b",
        "metadata",
        "GET",
        "actor-b-s0-match",
      ),
      successfulCheck(
        "fresh-content-update",
        "actor-b",
        "content-update",
        "PATCH",
        "fresh-content-update",
        200,
        true,
      ),
      successfulCheck(
        "fresh-content-update-second",
        "actor-b",
        "content-update",
        "PATCH",
        "second-fresh-content-update",
        200,
        true,
      ),
      successfulCheck(
        "stale-content-update",
        "actor-a",
        "content-update",
        "PATCH",
        "stale-content-rejected",
        412,
        true,
      ),
      successfulCheck(
        "stale-parent-move",
        "actor-a",
        "parent-move",
        "PATCH",
        "stale-parent-rejected",
        412,
        true,
      ),
    ],
    cleanup: { status: "ARCHIVED", reason: "archived" },
    redaction: {
      rawIdentifiersStored: false,
      contentStored: false,
      credentialsStored: false,
    },
  };
}

export function evidenceBytes(evidence: LiveDriveEvidence): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(evidence));
}

export function evidenceDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function validApproval(bytes: Uint8Array): WriteApproval {
  return {
    schemaVersion: 1,
    approvalId: "00000000-0000-4000-8000-000000000001",
    gatewayEnvironment: "test-environment",
    driveConfigurationFingerprint: `sha256:${"c".repeat(64)}`,
    evidenceSha256: evidenceDigest(bytes),
    authMode: "shared-drive-adc",
    topology: "shared-drive",
    issuedAt: "2026-01-01T00:02:00.000Z",
    expiresAt: "2026-01-01T00:07:00.000Z",
  };
}

export function validTrust(): RuntimeWriteGateTrust {
  return {
    gatewayEnvironment: "test-environment",
    driveConfigurationFingerprint: `sha256:${"c".repeat(64)}`,
    authMode: "shared-drive-adc",
    topology: "shared-drive",
    verificationKeys: {
      "test-key": {
        kty: "OKP",
        crv: "Ed25519",
        x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    },
    maxApprovalLifetimeMs: 600_000,
    maxEvidenceAgeMs: 604_800_000,
    clockSkewMs: 30_000,
    leaseLifetimeMs: 60_000,
  };
}

export function compactHeader(overrides: Record<string, unknown> = {}): string {
  const header = {
    alg: "EdDSA",
    kid: "test-key",
    typ: "w27-drive-write-approval+jws",
    ...overrides,
  };
  return `${Buffer.from(JSON.stringify(header)).toString("base64url")}.e30.c2ln`;
}
