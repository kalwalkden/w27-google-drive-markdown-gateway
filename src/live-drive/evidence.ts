import { createHmac } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { z } from "zod";

import type { LiveDriveProbeConfig } from "./config.js";

export type CapabilityOutcome = "SUPPORTED" | "UNSUPPORTED" | "INCONCLUSIVE";
export type CleanupStatus =
  | "ARCHIVED"
  | "ALREADY_ARCHIVED"
  | "FAILED"
  | "NOT_CREATED";

export const evidenceExpectedCodes = [
  "marked-test-root",
  "direct-child-archive",
  "create-disposable-markdown",
  "create-download-match",
  "actor-b-s0-match",
  "fresh-content-update",
  "stale-content-rejected",
  "second-fresh-content-update",
  "stale-parent-rejected",
  "cleanup-archive",
  "probe-completes",
] as const;
export type EvidenceExpectedCode = (typeof evidenceExpectedCodes)[number];

export const evidenceReasonCodes = [
  "ok",
  "invalid-root",
  "invalid-archive",
  "not-created",
  "preflight-inconclusive",
  "create-failed",
  "missing-etag",
  "content-mismatch",
  "unreadable-post-state",
  "fresh-write-not-proved",
  "stale-request-accepted",
  "stale-request-non-412",
  "stale-state-changed",
  "transport-or-auth-failure",
  "malformed-metadata",
  "identity-verification-failed",
  "already-archived",
  "archived",
  "archive-verification-failed",
  "unexpected-parent",
  "cleanup-transport-or-auth-failure",
  "cleanup-conditional-conflict",
  "archived-with-unconditional-fallback",
  "invalid-version-observation",
] as const;
export type EvidenceReasonCode = (typeof evidenceReasonCodes)[number];

export interface ProbeCheck {
  id: string;
  actor: "actor-a" | "actor-b" | "cleanup" | "system";
  endpoint:
    | "metadata"
    | "download"
    | "create"
    | "content-update"
    | "parent-move"
    | "cleanup";
  method: "GET" | "POST" | "PATCH";
  ifMatchSent: boolean;
  /** Exact raw ETag sent as If-Match. ETags are capability observations, not secrets. */
  ifMatchEtag?: string;
  supportsAllDrivesSent: true;
  /** Status and ETag from the operation itself, never inferred from a later readback. */
  operationStatus?: number;
  operationEtag?: string;
  /** A separately observed metadata-plus-download snapshot. */
  readback?: {
    metadataStatus: number;
    downloadStatus: number;
    responseEtag?: string;
    version?: string;
    headRevisionId?: string;
    opaqueFileRef?: string;
    opaqueParentRefs?: string[];
    payloadSha256?: string;
    payloadByteLength?: number;
  };
  expected: EvidenceExpectedCode;
  passed: boolean;
  reason: EvidenceReasonCode;
}

export interface LiveDriveEvidence {
  schemaVersion: 2;
  probeVersion: "2";
  runId: string;
  startedAt: string;
  finishedAt: string;
  authMode: LiveDriveProbeConfig["authMode"];
  topology: "shared-drive" | "my-drive" | "unknown";
  outcome: CapabilityOutcome;
  checks: ProbeCheck[];
  cleanup: { status: CleanupStatus; reason: EvidenceReasonCode };
  redaction: {
    rawIdentifiersStored: false;
    contentStored: false;
    credentialsStored: false;
  };
}

const forbiddenKey =
  /(?:authorization|access.?token|refresh.?token|client.?secret|(?:credential|secret).*(?:path|file)|(?:^|_)content(?:$|_)|(?:^|_)body(?:$|_)|url|error|stack)/i;

const checkSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    actor: z.enum(["actor-a", "actor-b", "cleanup", "system"]),
    endpoint: z.enum([
      "metadata",
      "download",
      "create",
      "content-update",
      "parent-move",
      "cleanup",
    ]),
    method: z.enum(["GET", "POST", "PATCH"]),
    ifMatchSent: z.boolean(),
    ifMatchEtag: z.string().min(1).optional(),
    supportsAllDrivesSent: z.literal(true),
    operationStatus: z.number().int().optional(),
    operationEtag: z.string().optional(),
    readback: z
      .object({
        metadataStatus: z.number().int(),
        downloadStatus: z.number().int(),
        responseEtag: z.string().optional(),
        version: z.string().optional(),
        headRevisionId: z.string().optional(),
        opaqueFileRef: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        opaqueParentRefs: z
          .array(z.string().regex(/^[a-f0-9]{64}$/))
          .optional(),
        payloadSha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        payloadByteLength: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    expected: z.enum(evidenceExpectedCodes),
    passed: z.boolean(),
    reason: z.enum(evidenceReasonCodes),
  })
  .strict();

const evidenceSchema = z
  .object({
    schemaVersion: z.literal(2),
    probeVersion: z.literal("2"),
    runId: z.string().uuid(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    authMode: z.enum(["shared-drive-adc", "my-drive-refresh-token"]),
    topology: z.enum(["shared-drive", "my-drive", "unknown"]),
    outcome: z.enum(["SUPPORTED", "UNSUPPORTED", "INCONCLUSIVE"]),
    checks: z.array(checkSchema),
    cleanup: z
      .object({
        status: z.enum([
          "ARCHIVED",
          "ALREADY_ARCHIVED",
          "FAILED",
          "NOT_CREATED",
        ]),
        reason: z.enum(evidenceReasonCodes),
      })
      .strict(),
    redaction: z
      .object({
        rawIdentifiersStored: z.literal(false),
        contentStored: z.literal(false),
        credentialsStored: z.literal(false),
      })
      .strict(),
  })
  .strict();

export function opaqueReference(key: Uint8Array, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

export function parseLiveDriveEvidence(value: unknown): LiveDriveEvidence {
  const parsed = evidenceSchema.parse(value);
  const walk = (entry: unknown, key?: string): void => {
    if (key && forbiddenKey.test(key))
      throw new Error("evidence contains a forbidden key");
    if (Array.isArray(entry)) {
      for (const item of entry) walk(item);
      return;
    }
    if (entry && typeof entry === "object") {
      for (const [childKey, childValue] of Object.entries(entry))
        walk(childValue, childKey);
    }
  };
  walk(parsed);
  return parsed;
}

export function assertSanitizedEvidence(
  value: unknown,
): asserts value is LiveDriveEvidence {
  parseLiveDriveEvidence(value);
}

export async function writeEvidenceExclusively(
  outputPath: string,
  evidence: LiveDriveEvidence,
): Promise<void> {
  assertSanitizedEvidence(evidence);
  const temporary = `${outputPath}.tmp-${process.pid}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, outputPath);
  } catch (error: unknown) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await unlink(temporary);
}
