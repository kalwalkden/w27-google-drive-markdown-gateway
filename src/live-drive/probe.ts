import { createHash, randomBytes, randomUUID } from "node:crypto";

import { testRootMarker, type LiveDriveProbeConfig } from "./config.js";
import type {
  DriveFileMetadata,
  DriveResponse,
  DriveSnapshot,
  RawDriveClient,
} from "./drive-client.js";
import {
  opaqueReference,
  type CapabilityOutcome,
  type CleanupStatus,
  type EvidenceExpectedCode,
  type EvidenceReasonCode,
  type LiveDriveEvidence,
  type ProbeCheck,
} from "./evidence.js";

export interface ProbeClients {
  actorA: RawDriveClient;
  actorB: RawDriveClient;
  cleanup: RawDriveClient;
}

interface InternalSnapshot extends DriveSnapshot {
  contentHash: string;
  metadataStatus: number;
  downloadStatus: number;
}

class ProbeStop extends Error {
  constructor(readonly result: CapabilityOutcome) {
    super("probe stopped");
  }
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isTransient(status: number | undefined): boolean {
  return (
    status === undefined ||
    [401, 403, 408, 429].includes(status) ||
    status >= 500
  );
}

function failedResponseOutcome(
  response: DriveResponse<unknown>,
): CapabilityOutcome {
  return isTransient(response.status) ? "INCONCLUSIVE" : "UNSUPPORTED";
}

function endpointFor(id: string): ProbeCheck["endpoint"] {
  if (id.includes("download")) return "download";
  if (id.includes("create")) return "create";
  if (id.includes("parent")) return "parent-move";
  if (id.includes("cleanup")) return "cleanup";
  if (id.includes("content")) return "content-update";
  return "metadata";
}

function check(
  id: string,
  actor: ProbeCheck["actor"],
  method: ProbeCheck["method"],
  expected: EvidenceExpectedCode,
  passed: boolean,
  reason: EvidenceReasonCode,
  response?: DriveResponse<DriveFileMetadata | Uint8Array>,
  snapshot?: InternalSnapshot,
  referenceKey?: Uint8Array,
  ifMatchEtag?: string,
): ProbeCheck {
  return {
    id,
    actor,
    endpoint: endpointFor(id),
    method,
    ifMatchSent: Boolean(ifMatchEtag),
    ifMatchEtag,
    supportsAllDrivesSent: true,
    operationStatus: response?.status,
    operationEtag: response?.etag,
    readback:
      snapshot && referenceKey
        ? {
            metadataStatus: snapshot.metadataStatus,
            downloadStatus: snapshot.downloadStatus,
            responseEtag: snapshot.etag,
            version: snapshot.metadata.version,
            headRevisionId: snapshot.metadata.headRevisionId,
            opaqueFileRef: opaqueReference(referenceKey, snapshot.metadata.id),
            opaqueParentRefs: snapshot.metadata.parents.map((parent) =>
              opaqueReference(referenceKey, parent),
            ),
            payloadSha256: snapshot.contentHash,
            payloadByteLength: snapshot.payload.length,
          }
        : undefined,
    expected,
    passed,
    reason,
  };
}

function hasNondecreasingVersion(
  before: InternalSnapshot,
  after: InternalSnapshot,
): boolean {
  if (!before.metadata.version || !after.metadata.version) return false;
  if (
    !/^\d+$/.test(before.metadata.version) ||
    !/^\d+$/.test(after.metadata.version)
  )
    return false;
  return BigInt(after.metadata.version) >= BigInt(before.metadata.version);
}

async function snapshot(
  client: RawDriveClient,
  fileId: string,
): Promise<{
  response: DriveResponse<DriveFileMetadata>;
  value?: InternalSnapshot;
  download?: DriveResponse<Uint8Array>;
}> {
  const response = await client.getMetadata(fileId);
  if (response.status < 200 || response.status >= 300 || !response.value)
    return { response };
  const download = await client.download(fileId);
  if (download.status < 200 || download.status >= 300 || !download.value)
    return { response, download };
  return {
    response,
    download,
    value: {
      metadata: response.value,
      etag: response.etag,
      payload: download.value,
      contentHash: digest(download.value),
      metadataStatus: response.status,
      downloadStatus: download.status,
    },
  };
}

function sameState(left: InternalSnapshot, right: InternalSnapshot): boolean {
  return (
    left.etag === right.etag &&
    left.metadata.version === right.metadata.version &&
    left.metadata.headRevisionId === right.metadata.headRevisionId &&
    left.contentHash === right.contentHash &&
    left.payload.length === right.payload.length &&
    left.metadata.parents.length === right.metadata.parents.length &&
    left.metadata.parents.every(
      (parent, index) => parent === right.metadata.parents[index],
    )
  );
}

function sameSnapshot(
  left: InternalSnapshot,
  right: InternalSnapshot,
): boolean {
  return sameState(left, right) && left.metadata.id === right.metadata.id;
}

function folderIsSafe(
  metadata: DriveFileMetadata,
  expectedParent?: string,
): boolean {
  return (
    metadata.mimeType === "application/vnd.google-apps.folder" &&
    !metadata.trashed &&
    (!expectedParent ||
      (metadata.parents.length === 1 && metadata.parents[0] === expectedParent))
  );
}

function evidence(
  config: LiveDriveProbeConfig,
  runId: string,
  startedAt: string,
  finishedAt: string,
  topology: LiveDriveEvidence["topology"],
  outcome: CapabilityOutcome,
  checks: ProbeCheck[],
  cleanupStatus: CleanupStatus,
  cleanupReason: EvidenceReasonCode,
): LiveDriveEvidence {
  return {
    schemaVersion: 2,
    probeVersion: "2",
    runId,
    startedAt,
    finishedAt,
    authMode: config.authMode,
    topology,
    outcome,
    checks,
    cleanup: { status: cleanupStatus, reason: cleanupReason },
    redaction: {
      rawIdentifiersStored: false,
      contentStored: false,
      credentialsStored: false,
    },
  };
}

export async function runLiveDriveCapabilityProbe(
  config: LiveDriveProbeConfig,
  clients: ProbeClients,
  now = () => new Date(),
): Promise<LiveDriveEvidence> {
  const startedAt = now().toISOString();
  const runId = randomUUID();
  const hmacKey = randomBytes(32);
  const checks: ProbeCheck[] = [];
  let outcome: CapabilityOutcome = "INCONCLUSIVE";
  let cleanupStatus: CleanupStatus = "NOT_CREATED";
  let cleanupReason: EvidenceReasonCode = "not-created";
  let topology: LiveDriveEvidence["topology"] = "unknown";
  let fileId: string | undefined;
  const expectedName = `w27-drive-capability-${runId}.md`;
  const versions = [1, 2, 3, "stale"].map((version) =>
    new TextEncoder().encode(
      `# Drive capability probe\n\nrun: ${runId}\nversion: ${version}\n`,
    ),
  );
  const [versionOne, versionTwo, versionThree, stale] = versions;
  const permittedPayloadFingerprints = new Set(
    versions.map((payload) =>
      opaqueReference(hmacKey, `${digest(payload)}:${payload.length}`),
    ),
  );
  const mark = (entry: ProbeCheck) => checks.push(entry);

  try {
    const root = await clients.actorA.getMetadata(config.testRootFolderId);
    const archive = await clients.actorA.getMetadata(config.archiveFolderId);
    const rootOk =
      root.status >= 200 &&
      root.status < 300 &&
      root.value &&
      folderIsSafe(root.value) &&
      root.value.appProperties?.[testRootMarker.key] === testRootMarker.value;
    const archiveOk =
      archive.status >= 200 &&
      archive.status < 300 &&
      archive.value &&
      folderIsSafe(archive.value, config.testRootFolderId);
    const matchingTopology = Boolean(
      root.value &&
        archive.value &&
        root.value.driveId === archive.value.driveId,
    );
    topology = root.value?.driveId ? "shared-drive" : "my-drive";
    const modeOk =
      config.authMode === "shared-drive-adc"
        ? Boolean(root.value?.driveId)
        : !root.value?.driveId;
    mark(
      check(
        "preflight-root",
        "system",
        "GET",
        "marked-test-root",
        Boolean(rootOk),
        rootOk ? "ok" : root.malformed ? "malformed-metadata" : "invalid-root",
        root,
      ),
    );
    mark(
      check(
        "preflight-archive",
        "system",
        "GET",
        "direct-child-archive",
        Boolean(archiveOk && matchingTopology && modeOk),
        archiveOk && matchingTopology && modeOk
          ? "ok"
          : archive.malformed
            ? "malformed-metadata"
            : "invalid-archive",
        archive,
      ),
    );
    if (!rootOk || !archiveOk || !matchingTopology || !modeOk)
      throw new ProbeStop("INCONCLUSIVE");

    const created = await clients.actorA.create(
      expectedName,
      config.testRootFolderId,
      versionOne,
    );
    if (created.status >= 200 && created.status < 300 && created.candidateId) {
      // Cleanup is now armed even if strict metadata validation cannot continue the proof.
      fileId = created.candidateId;
    }
    if (created.status < 200 || created.status >= 300 || !created.value) {
      mark(
        check(
          "create",
          "actor-a",
          "POST",
          "create-disposable-markdown",
          false,
          created.malformed ? "malformed-metadata" : "create-failed",
          created,
        ),
      );
      throw new ProbeStop(
        created.status >= 200 && created.status < 300
          ? "INCONCLUSIVE"
          : failedResponseOutcome(created),
      );
    }
    fileId = created.value.id;
    mark(
      check(
        "create",
        "actor-a",
        "POST",
        "create-disposable-markdown",
        true,
        "ok",
        created,
      ),
    );

    const initial = await snapshot(clients.actorA, fileId);
    if (!initial.value) {
      mark(
        check(
          "create-download",
          "actor-a",
          "GET",
          "create-download-match",
          false,
          initial.response.malformed
            ? "malformed-metadata"
            : "unreadable-post-state",
          initial.response,
        ),
      );
      throw new ProbeStop("INCONCLUSIVE");
    }
    if (!initial.value.etag) {
      mark(
        check(
          "create-download",
          "actor-a",
          "GET",
          "create-download-match",
          false,
          "missing-etag",
          initial.response,
          initial.value,
          hmacKey,
        ),
      );
      throw new ProbeStop("UNSUPPORTED");
    }
    if (initial.value.contentHash !== digest(versionOne)) {
      mark(
        check(
          "create-download",
          "actor-a",
          "GET",
          "create-download-match",
          false,
          "content-mismatch",
          initial.response,
          initial.value,
          hmacKey,
        ),
      );
      throw new ProbeStop("UNSUPPORTED");
    }
    const s0 = initial.value;
    mark(
      check(
        "create-download",
        "actor-a",
        "GET",
        "create-download-match",
        true,
        "ok",
        initial.response,
        s0,
        hmacKey,
      ),
    );

    const actorBS0 = await snapshot(clients.actorB, fileId);
    if (!actorBS0.value) {
      mark(
        check(
          "actor-b-s0",
          "actor-b",
          "GET",
          "actor-b-s0-match",
          false,
          actorBS0.response.malformed
            ? "malformed-metadata"
            : "unreadable-post-state",
          actorBS0.response,
        ),
      );
      throw new ProbeStop("INCONCLUSIVE");
    }
    if (!actorBS0.value.etag) {
      mark(
        check(
          "actor-b-s0",
          "actor-b",
          "GET",
          "actor-b-s0-match",
          false,
          "missing-etag",
          actorBS0.response,
          actorBS0.value,
          hmacKey,
        ),
      );
      throw new ProbeStop("UNSUPPORTED");
    }
    if (!sameSnapshot(s0, actorBS0.value)) {
      mark(
        check(
          "actor-b-s0",
          "actor-b",
          "GET",
          "actor-b-s0-match",
          false,
          "content-mismatch",
          actorBS0.response,
          actorBS0.value,
          hmacKey,
        ),
      );
      throw new ProbeStop("UNSUPPORTED");
    }
    const bS0 = actorBS0.value;
    const bS0Etag = bS0.etag;
    if (!bS0Etag) throw new ProbeStop("UNSUPPORTED");
    mark(
      check(
        "actor-b-s0",
        "actor-b",
        "GET",
        "actor-b-s0-match",
        true,
        "ok",
        actorBS0.response,
        bS0,
        hmacKey,
      ),
    );

    const freshOne = await clients.actorB.updateContent(
      fileId,
      versionTwo,
      bS0Etag,
    );
    const afterOne = await snapshot(clients.actorB, fileId);
    if (freshOne.status < 200 || freshOne.status >= 300) {
      mark(
        check(
          "fresh-content-update",
          "actor-b",
          "PATCH",
          "fresh-content-update",
          false,
          "fresh-write-not-proved",
          freshOne,
          afterOne.value,
          hmacKey,
          bS0Etag,
        ),
      );
      throw new ProbeStop(failedResponseOutcome(freshOne));
    }
    if (!afterOne.value) {
      mark(
        check(
          "fresh-content-update",
          "actor-b",
          "PATCH",
          "fresh-content-update",
          false,
          afterOne.response.malformed
            ? "malformed-metadata"
            : "unreadable-post-state",
          freshOne,
          undefined,
          undefined,
          bS0Etag,
        ),
      );
      throw new ProbeStop("INCONCLUSIVE");
    }
    if (
      !afterOne.value.etag ||
      afterOne.value.etag === s0.etag ||
      afterOne.value.contentHash !== digest(versionTwo) ||
      !hasNondecreasingVersion(s0, afterOne.value)
    ) {
      mark(
        check(
          "fresh-content-update",
          "actor-b",
          "PATCH",
          "fresh-content-update",
          false,
          !afterOne.value.etag || afterOne.value.etag === s0.etag
            ? "missing-etag"
            : !hasNondecreasingVersion(s0, afterOne.value)
              ? "invalid-version-observation"
              : "content-mismatch",
          freshOne,
          afterOne.value,
          hmacKey,
          bS0Etag,
        ),
      );
      throw new ProbeStop("UNSUPPORTED");
    }
    const s1 = afterOne.value;
    const s0Etag = s0.etag;
    if (!s0Etag) throw new ProbeStop("UNSUPPORTED");
    mark(
      check(
        "fresh-content-update",
        "actor-b",
        "PATCH",
        "fresh-content-update",
        true,
        "ok",
        freshOne,
        s1,
        hmacKey,
        bS0Etag,
      ),
    );

    const staleContent = await clients.actorA.updateContent(
      fileId,
      stale,
      s0Etag,
    );
    const staleContentAfter = await snapshot(clients.actorA, fileId);
    if (staleContent.status !== 412) {
      mark(
        check(
          "stale-content-update",
          "actor-a",
          "PATCH",
          "stale-content-rejected",
          false,
          isTransient(staleContent.status)
            ? "transport-or-auth-failure"
            : staleContent.status >= 200 && staleContent.status < 300
              ? "stale-request-accepted"
              : "stale-request-non-412",
          staleContent,
          staleContentAfter.value,
          hmacKey,
          s0Etag,
        ),
      );
      throw new ProbeStop(failedResponseOutcome(staleContent));
    }
    if (!staleContentAfter.value) {
      mark(
        check(
          "stale-content-update",
          "actor-a",
          "PATCH",
          "stale-content-rejected",
          false,
          staleContentAfter.response.malformed
            ? "malformed-metadata"
            : "unreadable-post-state",
          staleContent,
          undefined,
          undefined,
          s0Etag,
        ),
      );
      throw new ProbeStop("INCONCLUSIVE");
    }
    if (!sameState(s1, staleContentAfter.value)) {
      mark(
        check(
          "stale-content-update",
          "actor-a",
          "PATCH",
          "stale-content-rejected",
          false,
          "stale-state-changed",
          staleContent,
          staleContentAfter.value,
          hmacKey,
          s0Etag,
        ),
      );
      throw new ProbeStop("UNSUPPORTED");
    }
    mark(
      check(
        "stale-content-update",
        "actor-a",
        "PATCH",
        "stale-content-rejected",
        true,
        "ok",
        staleContent,
        staleContentAfter.value,
        hmacKey,
        s0Etag,
      ),
    );

    const s1Etag = s1.etag;
    if (!s1Etag) throw new ProbeStop("UNSUPPORTED");
    const freshTwo = await clients.actorB.updateContent(
      fileId,
      versionThree,
      s1Etag,
    );
    const afterTwo = await snapshot(clients.actorB, fileId);
    if (freshTwo.status < 200 || freshTwo.status >= 300) {
      mark(
        check(
          "fresh-content-update-second",
          "actor-b",
          "PATCH",
          "second-fresh-content-update",
          false,
          "fresh-write-not-proved",
          freshTwo,
          afterTwo.value,
          hmacKey,
          s1Etag,
        ),
      );
      throw new ProbeStop(failedResponseOutcome(freshTwo));
    }
    if (!afterTwo.value) {
      mark(
        check(
          "fresh-content-update-second",
          "actor-b",
          "PATCH",
          "second-fresh-content-update",
          false,
          afterTwo.response.malformed
            ? "malformed-metadata"
            : "unreadable-post-state",
          freshTwo,
          undefined,
          undefined,
          s1Etag,
        ),
      );
      throw new ProbeStop("INCONCLUSIVE");
    }
    if (
      !afterTwo.value.etag ||
      afterTwo.value.etag === s1.etag ||
      afterTwo.value.contentHash !== digest(versionThree) ||
      !hasNondecreasingVersion(s1, afterTwo.value)
    ) {
      mark(
        check(
          "fresh-content-update-second",
          "actor-b",
          "PATCH",
          "second-fresh-content-update",
          false,
          !afterTwo.value.etag || afterTwo.value.etag === s1.etag
            ? "missing-etag"
            : !hasNondecreasingVersion(s1, afterTwo.value)
              ? "invalid-version-observation"
              : "content-mismatch",
          freshTwo,
          afterTwo.value,
          hmacKey,
          s1Etag,
        ),
      );
      throw new ProbeStop("UNSUPPORTED");
    }
    const s2 = afterTwo.value;
    mark(
      check(
        "fresh-content-update-second",
        "actor-b",
        "PATCH",
        "second-fresh-content-update",
        true,
        "ok",
        freshTwo,
        s2,
        hmacKey,
        s1Etag,
      ),
    );

    const staleMove = await clients.actorA.move(
      fileId,
      config.archiveFolderId,
      config.testRootFolderId,
      s1Etag,
    );
    const staleMoveAfter = await snapshot(clients.actorA, fileId);
    if (staleMove.status !== 412) {
      mark(
        check(
          "stale-parent-move",
          "actor-a",
          "PATCH",
          "stale-parent-rejected",
          false,
          isTransient(staleMove.status)
            ? "transport-or-auth-failure"
            : staleMove.status >= 200 && staleMove.status < 300
              ? "stale-request-accepted"
              : "stale-request-non-412",
          staleMove,
          staleMoveAfter.value,
          hmacKey,
          s1Etag,
        ),
      );
      throw new ProbeStop(failedResponseOutcome(staleMove));
    }
    if (!staleMoveAfter.value) {
      mark(
        check(
          "stale-parent-move",
          "actor-a",
          "PATCH",
          "stale-parent-rejected",
          false,
          staleMoveAfter.response.malformed
            ? "malformed-metadata"
            : "unreadable-post-state",
          staleMove,
          undefined,
          undefined,
          s1Etag,
        ),
      );
      throw new ProbeStop("INCONCLUSIVE");
    }
    if (
      !sameState(s2, staleMoveAfter.value) ||
      staleMoveAfter.value.metadata.parents[0] !== config.testRootFolderId
    ) {
      mark(
        check(
          "stale-parent-move",
          "actor-a",
          "PATCH",
          "stale-parent-rejected",
          false,
          "stale-state-changed",
          staleMove,
          staleMoveAfter.value,
          hmacKey,
          s1Etag,
        ),
      );
      throw new ProbeStop("UNSUPPORTED");
    }
    mark(
      check(
        "stale-parent-move",
        "actor-a",
        "PATCH",
        "stale-parent-rejected",
        true,
        "ok",
        staleMove,
        staleMoveAfter.value,
        hmacKey,
        s1Etag,
      ),
    );
    outcome = "SUPPORTED";
  } catch (error: unknown) {
    if (error instanceof ProbeStop) outcome = error.result;
    else {
      outcome = "INCONCLUSIVE";
      mark(
        check(
          "probe-exception",
          "system",
          "GET",
          "probe-completes",
          false,
          "transport-or-auth-failure",
        ),
      );
    }
  } finally {
    if (fileId) {
      try {
        const current = await snapshot(clients.cleanup, fileId);
        const payloadFingerprint = current.value
          ? opaqueReference(
              hmacKey,
              `${current.value.contentHash}:${current.value.payload.length}`,
            )
          : "";
        // This in-memory HMAC binds cleanup to one generated payload without retaining an identifier.
        const identityOk =
          current.value?.metadata.name === expectedName &&
          current.value.metadata.mimeType === "text/markdown" &&
          permittedPayloadFingerprints.has(payloadFingerprint);
        if (!current.value || !identityOk) {
          cleanupStatus = "FAILED";
          cleanupReason = "identity-verification-failed";
        } else if (
          current.value.metadata.parents.length === 1 &&
          current.value.metadata.parents[0] === config.archiveFolderId
        ) {
          cleanupStatus = "ALREADY_ARCHIVED";
          cleanupReason = "already-archived";
        } else if (
          current.value.metadata.parents.length === 1 &&
          current.value.metadata.parents[0] === config.testRootFolderId
        ) {
          let usedUnconditionalFallback = !current.value.etag;
          let moved = current.value.etag
            ? await clients.cleanup.move(
                fileId,
                config.archiveFolderId,
                config.testRootFolderId,
                current.value.etag,
              )
            : await clients.cleanup.move(
                fileId,
                config.archiveFolderId,
                config.testRootFolderId,
              );
          if (current.value.etag && moved.status === 412) {
            mark(
              check(
                "cleanup-conditional-conflict",
                "cleanup",
                "PATCH",
                "cleanup-archive",
                false,
                "cleanup-conditional-conflict",
                moved,
                current.value,
                hmacKey,
                current.value.etag,
              ),
            );
            usedUnconditionalFallback = true;
            moved = await clients.cleanup.move(
              fileId,
              config.archiveFolderId,
              config.testRootFolderId,
            );
          }
          const verified = await snapshot(clients.cleanup, fileId);
          const archived =
            moved.status >= 200 &&
            moved.status < 300 &&
            verified.value?.metadata.parents.length === 1 &&
            verified.value.metadata.parents[0] === config.archiveFolderId;
          cleanupStatus = archived ? "ARCHIVED" : "FAILED";
          cleanupReason = archived
            ? usedUnconditionalFallback
              ? "archived-with-unconditional-fallback"
              : "archived"
            : "archive-verification-failed";
          mark(
            check(
              "cleanup-move",
              "cleanup",
              "PATCH",
              "cleanup-archive",
              archived,
              cleanupReason,
              moved,
              verified.value,
              hmacKey,
              usedUnconditionalFallback ? undefined : current.value.etag,
            ),
          );
        } else {
          cleanupStatus = "FAILED";
          cleanupReason = "unexpected-parent";
        }
      } catch {
        cleanupStatus = "FAILED";
        cleanupReason = "cleanup-transport-or-auth-failure";
      }
    }
  }
  if (outcome === "SUPPORTED" && cleanupStatus === "FAILED")
    outcome = "INCONCLUSIVE";
  return evidence(
    config,
    runId,
    startedAt,
    now().toISOString(),
    topology,
    outcome,
    checks,
    cleanupStatus,
    cleanupReason,
  );
}
