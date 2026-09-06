import { randomUUID } from "node:crypto";
import { link, lstat, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import type { MigrationPlan } from "./plan.js";

export const cutoverConfirmation = "W27_PLANNING_CUTOVER_PREFLIGHT_ONLY";
const status = z.enum([
  "NOT_STARTED",
  "BLOCKED",
  "PASSED",
  "FAILED",
  "INCONCLUSIVE",
]);
const reason = z.enum([
  "NONE",
  "WRITE_UNAVAILABLE",
  "CLIENT_NOT_CONFIGURED",
  "DESTINATION_COLLISION",
  "READBACK_MISMATCH",
  "CONFLICT",
  "OUTCOME_UNKNOWN",
  "TRANSPORT_UNCERTAIN",
  "ARCHIVE_VERIFICATION_FAILED",
  "MANUAL_RECOVERY_REQUIRED",
]);
const identifier = z.string().regex(/^ref-[a-z0-9-]{1,120}$/u);
const gate = z.object({ status, reason }).strict();
const clientStates = z
  .object({ work: gate, codex: gate, macos: gate, iphone: gate, ipad: gate })
  .strict();
const operationStates = z
  .object({
    list: gate,
    search: gate,
    read: gate,
    create: gate,
    update: gate,
    archive: gate,
  })
  .strict();
const deploymentWriteMode = z.enum(["default-off", "controlled-write-enabled"]);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const cutoverPreflightConfigSchema = z
  .object({
    schemaVersion: z.literal("w27-planning-file-cutover-preflight-v1"),
    releaseIdentifier: identifier,
    environmentIdentifier: identifier,
    clientProfileIdentifier: identifier,
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    imageDigest: digest,
    nonSecretRuntimeDigest: digest,
    liveDriveProbeDigest: digest,
    deploymentWriteMode,
    gates: z
      .object({ write: gate, archive: gate, destination: gate, readback: gate })
      .strict(),
    clients: clientStates,
    operations: operationStates,
    duplicateCreate: gate,
    staleUpdate: gate,
    archiveVerification: gate,
    cleanup: gate,
    manualRecovery: gate,
  })
  .strict();

export const cutoverEvidenceSchema = z
  .object({
    schemaVersion: z.literal("w27-planning-file-cutover-evidence-v1"),
    recordedAt: z.string().datetime({ offset: true, precision: 3 }),
    releaseIdentifier: identifier,
    environmentIdentifier: identifier,
    clientProfileIdentifier: identifier,
    manifestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    imageDigest: digest,
    nonSecretRuntimeDigest: digest,
    liveDriveProbeDigest: digest,
    deploymentWriteMode,
    overall: z.enum(["BLOCKED", "INCONCLUSIVE"]),
    gates: z
      .object({ write: gate, archive: gate, destination: gate, readback: gate })
      .strict(),
    clients: clientStates,
    operations: operationStates,
    duplicateCreate: gate,
    staleUpdate: gate,
    archiveVerification: gate,
    cleanup: gate,
    sourceOfTruth: z.literal("not-declared"),
    manualRecovery: gate,
  })
  .strict();

export type CutoverPreflightConfig = z.infer<
  typeof cutoverPreflightConfigSchema
>;
export type CutoverEvidence = z.infer<typeof cutoverEvidenceSchema>;
type Gate = z.infer<typeof gate>;

const approvedKeys = new Set([
  "clientProfileIdentifier",
  "manifestSha256",
  "imageDigest",
  "nonSecretRuntimeDigest",
  "liveDriveProbeDigest",
]);
const forbiddenKey =
  /endpoint|credential|reference|account|device|digestcontent|content|path|name|fileid|revision|url|auth|bearer|token|secret|header|body|response|error|stack|stdout|stderr|screenshot|locator/i;
const unsafeValue =
  /https?:\/\/|[\\/]|\bbearer\s|-----begin|\beyJ[A-Za-z0-9_-]{10,}|\bya29\.[A-Za-z0-9._-]+/iu;

export function assertNoSensitiveEvidence(value: unknown): void {
  const inspect = (entry: unknown): void => {
    if (typeof entry === "string" && unsafeValue.test(entry))
      throw new Error("redaction");
    if (Array.isArray(entry)) {
      entry.forEach(inspect);
      return;
    }
    if (entry && typeof entry === "object")
      for (const [key, nested] of Object.entries(entry)) {
        if (
          !approvedKeys.has(key) &&
          (key.toLowerCase() === "id" ||
            key.toLowerCase() === "ip" ||
            forbiddenKey.test(key))
        )
          throw new Error("redaction");
        inspect(nested);
      }
  };
  inspect(value);
}

function sameGate(
  left: Gate,
  nextStatus: Gate["status"],
  nextReason: Gate["reason"],
): boolean {
  return left.status === nextStatus && left.reason === nextReason;
}

function isStarted(value: Gate): boolean {
  return value.status !== "NOT_STARTED";
}

function isPassed(value: Gate): boolean {
  return sameGate(value, "PASSED", "NONE");
}

function assertGateCompatibility(value: Gate, client = false): void {
  if (
    (value.status === "NOT_STARTED" || value.status === "PASSED") !==
    (value.reason === "NONE")
  )
    throw new Error("gate");
  const allowedReasons = {
    BLOCKED: [
      "WRITE_UNAVAILABLE",
      "CLIENT_NOT_CONFIGURED",
      "DESTINATION_COLLISION",
    ],
    FAILED: [
      "DESTINATION_COLLISION",
      "READBACK_MISMATCH",
      "CONFLICT",
      "OUTCOME_UNKNOWN",
      "TRANSPORT_UNCERTAIN",
      "ARCHIVE_VERIFICATION_FAILED",
    ],
    INCONCLUSIVE: [
      "OUTCOME_UNKNOWN",
      "TRANSPORT_UNCERTAIN",
      "MANUAL_RECOVERY_REQUIRED",
    ],
  } as const;
  if (
    value.status in allowedReasons &&
    !allowedReasons[value.status as keyof typeof allowedReasons].includes(
      value.reason as never,
    )
  )
    throw new Error("gate");
  if (
    client &&
    value.status === "BLOCKED" &&
    value.reason !== "CLIENT_NOT_CONFIGURED"
  )
    throw new Error("client");
}

function assertNotStarted(values: readonly Gate[]): void {
  if (!values.every((value) => sameGate(value, "NOT_STARTED", "NONE")))
    throw new Error("transition");
}

function assertPrerequisites(config: CutoverPreflightConfig): void {
  const { operations, gates } = config;
  if (
    isStarted(operations.create) &&
    (!isPassed(gates.destination) || !isPassed(gates.archive))
  )
    throw new Error("create-readiness");
  if (
    [operations.update, config.duplicateCreate, config.staleUpdate].some(
      isStarted,
    ) &&
    (!isPassed(operations.create) || !isPassed(gates.readback))
  )
    throw new Error("create-readback");
  if (
    isStarted(operations.archive) &&
    (!isPassed(operations.update) ||
      !sameGate(config.staleUpdate, "FAILED", "CONFLICT"))
  )
    throw new Error("archive-order");
  if (
    Object.values(config.clients).some(isStarted) &&
    !isPassed(gates.readback)
  )
    throw new Error("client-order");
  if (
    [config.archiveVerification, config.cleanup].some(isStarted) &&
    !isPassed(operations.archive)
  )
    throw new Error("archive-verification");
  if (isStarted(config.cleanup) && !isPassed(config.archiveVerification))
    throw new Error("cleanup-order");
}

function assertRecovery(config: CutoverPreflightConfig): void {
  const ordered = [
    config.operations.create,
    config.duplicateCreate,
    config.operations.update,
    config.staleUpdate,
    config.operations.archive,
    config.archiveVerification,
    config.cleanup,
  ];
  const firstUncertain = ordered.findIndex(
    (entry) =>
      entry.reason === "OUTCOME_UNKNOWN" ||
      entry.reason === "TRANSPORT_UNCERTAIN",
  );
  const archiveFailure = [
    config.operations.archive,
    config.archiveVerification,
    config.cleanup,
  ].some(
    (entry) =>
      entry.status === "FAILED" ||
      entry.status === "INCONCLUSIVE" ||
      entry.reason === "ARCHIVE_VERIFICATION_FAILED",
  );
  if (firstUncertain < 0 && !archiveFailure) return;
  if (
    !sameGate(config.manualRecovery, "INCONCLUSIVE", "MANUAL_RECOVERY_REQUIRED")
  )
    throw new Error("recovery");
  if (firstUncertain >= 0) assertNotStarted(ordered.slice(firstUncertain + 1));
}

export function evaluateCutoverPreflight(
  input: unknown,
  plan: MigrationPlan,
  recordedAt: string,
): CutoverEvidence {
  const config = cutoverPreflightConfigSchema.parse(input);
  assertNoSensitiveEvidence(config);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(recordedAt))
    throw new Error("time");
  if (config.manifestSha256 !== plan.manifestSha256)
    throw new Error("manifest");
  const allGates = [
    ...Object.values(config.gates),
    ...Object.values(config.clients),
    ...Object.values(config.operations),
    config.duplicateCreate,
    config.staleUpdate,
    config.archiveVerification,
    config.cleanup,
    config.manualRecovery,
  ];
  allGates.forEach((entry) => {
    assertGateCompatibility(entry);
  });
  Object.values(config.clients).forEach((entry) => {
    assertGateCompatibility(entry, true);
  });
  if (config.deploymentWriteMode === "default-off") {
    if (!sameGate(config.gates.write, "BLOCKED", "WRITE_UNAVAILABLE"))
      throw new Error("write-mode");
    assertNotStarted(allGates.filter((entry) => entry !== config.gates.write));
  } else if (!isPassed(config.gates.write)) {
    throw new Error("write-mode");
  }
  assertPrerequisites(config);
  assertRecovery(config);
  return cutoverEvidenceSchema.parse({
    schemaVersion: "w27-planning-file-cutover-evidence-v1",
    recordedAt,
    releaseIdentifier: config.releaseIdentifier,
    environmentIdentifier: config.environmentIdentifier,
    clientProfileIdentifier: config.clientProfileIdentifier,
    manifestSha256: config.manifestSha256,
    imageDigest: config.imageDigest,
    nonSecretRuntimeDigest: config.nonSecretRuntimeDigest,
    liveDriveProbeDigest: config.liveDriveProbeDigest,
    deploymentWriteMode: config.deploymentWriteMode,
    overall:
      config.deploymentWriteMode === "default-off" ? "BLOCKED" : "INCONCLUSIVE",
    gates: config.gates,
    clients: config.clients,
    operations: config.operations,
    duplicateCreate: config.duplicateCreate,
    staleUpdate: config.staleUpdate,
    archiveVerification: config.archiveVerification,
    cleanup: config.cleanup,
    sourceOfTruth: "not-declared",
    manualRecovery: config.manualRecovery,
  });
}

export type EvidenceParentFacts = Readonly<{
  readonly path: string;
  readonly dev: bigint;
  readonly ino: bigint;
}>;
export type EvidenceWriterHooks = Readonly<{
  readonly beforeLink?: () => Promise<void>;
  readonly afterLink?: () => Promise<void>;
}>;

function sameInode(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function assertParent(
  path: string,
  expected: EvidenceParentFacts,
): Promise<void> {
  if (resolve(path) !== resolve(expected.path)) throw new Error("output");
  const observed = await lstat(path, { bigint: true });
  if (
    !observed.isDirectory() ||
    observed.isSymbolicLink() ||
    !sameInode(observed, expected)
  )
    throw new Error("output");
}

async function unlinkIfOwned(
  path: string,
  handle: Awaited<ReturnType<typeof open>>,
): Promise<void> {
  const opened = await handle.stat({ bigint: true });
  try {
    const candidate = await lstat(path, { bigint: true });
    if (sameInode(candidate, opened)) await unlink(path);
  } catch {
    // A missing or swapped name must never be unlinked by this writer.
  }
}

export async function writeCutoverEvidenceExclusively(
  path: string,
  input: unknown,
  expectedParent: EvidenceParentFacts,
  hooks: EvidenceWriterHooks = {},
): Promise<void> {
  const evidence = cutoverEvidenceSchema.parse(input);
  assertNoSensitiveEvidence(evidence);
  const parent = dirname(resolve(path));
  await assertParent(parent, expectedParent);
  const temporary = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  let linked = false;
  let complete = false;
  try {
    const opened = await handle.stat({ bigint: true });
    const assertTemporary = async (): Promise<void> => {
      const temporaryStat = await lstat(temporary, { bigint: true });
      if (
        !opened.isFile() ||
        !sameInode(opened, temporaryStat) ||
        (opened.mode & 0o777n) !== 0o600n
      )
        throw new Error("output");
    };
    const bytes = Buffer.from(`${JSON.stringify(evidence)}\n`, "utf8");
    await assertTemporary();
    await assertParent(parent, expectedParent);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesWritten === 0) throw new Error("output");
      offset += bytesWritten;
    }
    await handle.sync();
    await assertTemporary();
    await assertParent(parent, expectedParent);
    await hooks.beforeLink?.();
    await assertTemporary();
    await assertParent(parent, expectedParent);
    await link(temporary, path);
    linked = true;
    await hooks.afterLink?.();
    const [published, currentTemporary] = await Promise.all([
      lstat(path, { bigint: true }),
      lstat(temporary, { bigint: true }),
    ]);
    if (!sameInode(published, opened) || !sameInode(currentTemporary, opened))
      throw new Error("output");
    await assertParent(parent, expectedParent);
    complete = true;
  } catch (error) {
    if (!complete) {
      await handle.truncate(0).catch(() => undefined);
      await handle.sync().catch(() => undefined);
    }
    if (linked && !complete) await unlinkIfOwned(path, handle);
    throw error;
  } finally {
    await unlinkIfOwned(temporary, handle).catch(() => undefined);
    await handle.close();
  }
}
