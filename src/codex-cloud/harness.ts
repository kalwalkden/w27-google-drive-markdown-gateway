import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";

export const confirmation = "W27_CODEX_CLOUD_TEST_ONLY";
const gatewayFailures = {
  UNAUTHENTICATED: [401, 6, "Authentication failed."],
  UNSUPPORTED: [503, 7, "Operation is unavailable."],
  INVALID_PATH: [400, 7, "Path is invalid."],
  AMBIGUOUS_PATH: [409, 7, "Markdown path is ambiguous."],
  CONFLICT: [409, 8, "Markdown revision conflict."],
  OUTCOME_UNKNOWN: [
    503,
    9,
    "Mutation outcome is unknown. Read the document again before any further mutation.",
  ],
} as const;
const clientFailures = {
  USAGE: [2, "Command usage is invalid."],
  CREDENTIAL: [3, "Credential configuration is invalid."],
  TRANSPORT: [4, "Gateway request failed."],
  PROTOCOL: [5, "Gateway response is invalid."],
} as const;
type GatewayFailureCode = keyof typeof gatewayFailures;
type ClientFailureCode = keyof typeof clientFailures;
type ResultCode =
  | "OK"
  | "NOT_ATTEMPTED"
  | GatewayFailureCode
  | ClientFailureCode
  | "MISMATCH"
  | "ARCHIVE_UNVERIFIED";

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const relativeFolder = (nested: boolean) =>
  z.string().superRefine((value, context) => {
    const segments = value.split("/");
    if (
      value.length > 512 ||
      (nested && segments.length < 2) ||
      segments.some(
        (segment) =>
          segment === "." ||
          segment === ".." ||
          !/^[A-Za-z0-9._-]{1,128}$/u.test(segment),
      )
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: "folder" });
  });
const folderOverlaps = (left: string, right: string) =>
  left === right ||
  left.startsWith(`${right}/`) ||
  right.startsWith(`${left}/`);
const platformControlSchema = z.enum(["verified", "unavailable"]);
export const cloudHarnessConfigSchema = z
  .object({
    cliExecutable: z.literal("md-drive"),
    validationFolder: relativeFolder(true),
    archiveFolder: relativeFolder(false),
    gatewayImageDigest: digest,
    runtimeConfigDigest: digest,
    liveCapabilityEvidenceDigest: digest,
    environmentIdentifier: z.string().regex(/^example-[A-Za-z0-9-]{1,120}$/u),
    gatewayHostnameIdentifier: z
      .string()
      .regex(/^example-[A-Za-z0-9-]{1,120}$/u),
    timeoutMs: z.number().int().min(100).max(30_000),
    platformControls: z
      .object({
        checkedAt: z.string().datetime({ offset: true }),
        credentialInjection: platformControlSchema,
        exactHostnameEgress: platformControlSchema,
        methodEgress: z.enum(["verified", "unavailable", "not-supported"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (folderOverlaps(value.validationFolder, value.archiveFolder))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["archiveFolder"],
        message: "folder-overlap",
      });
  });
export type CloudHarnessConfig = z.infer<typeof cloudHarnessConfigSchema>;
export type HarnessOutcome = "passed" | "failed" | "inconclusive";
type Metadata = Readonly<{
  relativePath: string;
  fileId: string;
  revision: string;
  modifiedTime: string;
  size: number;
}>;
type ReadData = Metadata & Readonly<{ content: string }>;
type CliRecord =
  | Readonly<{ ok: true; data: Record<string, unknown> }>
  | Readonly<{ ok: false; error: GatewayFailureCode | ClientFailureCode }>;
export interface CommandRunner {
  run(
    args: readonly string[],
  ): Promise<Readonly<{ exitCode: number; stdout: string }>>;
}
export interface OperationOutcome {
  readonly outcome: HarnessOutcome;
  readonly code: ResultCode;
}
const operationStages = [
  "list",
  "archive_preflight",
  "search",
  "create",
  "read",
  "duplicate_create",
  "read_after_duplicate",
  "update",
  "read_after_update",
  "stale_update",
  "read_after_conflict",
  "archive",
] as const;
type OperationStage = (typeof operationStages)[number];
export type OperationOutcomes = Readonly<{
  [stage in OperationStage]: OperationOutcome;
}>;
export interface HarnessEvidence {
  readonly schemaVersion: 1;
  readonly harnessVersion: "3";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly runIdentifier: string;
  readonly gatewayImageDigest: string;
  readonly runtimeConfigDigest: string;
  readonly liveCapabilityEvidenceDigest: string;
  readonly environmentIdentifier: string;
  readonly gatewayHostnameIdentifier: string;
  readonly allowedMethods: readonly ["GET", "POST"];
  readonly platformControls: CloudHarnessConfig["platformControls"];
  readonly gatewayCapabilities: Readonly<{
    readonly expected: Readonly<{
      readonly topology: "nested-tree";
      readonly writes: "enabled";
      readonly archive: "enabled";
    }>;
    readonly observed: Readonly<{
      readonly topology: "nested-tree" | "not-observed";
      readonly writes: "enabled" | "unsupported" | "not-observed";
      readonly archive: "enabled" | "unsupported" | "not-observed";
    }>;
  }>;
  readonly overall: HarnessOutcome;
  readonly operationOutcomes: OperationOutcomes;
  readonly duplicateRefusal: HarnessOutcome;
  readonly staleConflict: HarnessOutcome;
  readonly archiveVerification: HarnessOutcome;
  readonly cleanup: HarnessOutcome;
  readonly manualRecovery:
    | Readonly<{ required: false }>
    | Readonly<{
        required: true;
        runReference: string;
        direction: "manually-reread-the-exact-generated-run-file-then-archive-only-if-identity-and-revision-are-proved";
      }>;
  readonly redaction: "passed";
}
interface HarnessDependencies {
  readonly now?: () => Date;
  readonly uuid?: () => string;
}
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length > 0 && value.length <= max;
function metadata(value: unknown): value is Metadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    exact(v, ["relativePath", "fileId", "revision", "modifiedTime", "size"]) &&
    text(v.relativePath, 1024) &&
    text(v.fileId, 512) &&
    text(v.revision, 1024) &&
    text(v.modifiedTime, 128) &&
    Number.isSafeInteger(v.size) &&
    (v.size as number) >= 0
  );
}
function readData(value: unknown): value is ReadData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    exact(v, [
      "relativePath",
      "fileId",
      "revision",
      "modifiedTime",
      "size",
      "content",
    ]) &&
    metadata(
      Object.fromEntries(
        Object.entries(v).filter(([key]) => key !== "content"),
      ),
    ) &&
    typeof v.content === "string"
  );
}
function validData(
  operation: string,
  data: unknown,
): data is Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  if (
    ["create_markdown", "update_markdown", "archive_markdown"].includes(
      operation,
    )
  )
    return metadata(data);
  if (operation === "read_markdown") return readData(data);
  const v = data as Record<string, unknown>;
  return (
    exact(v, ["items"]) &&
    Array.isArray(v.items) &&
    v.items.length <= 100 &&
    v.items.every(metadata)
  );
}
function parseCliRecord(stdout: string, expectedOperation: string): CliRecord {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("protocol");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("protocol");
  const v = value as Record<string, unknown>;
  const successStatus = expectedOperation === "create_markdown" ? 201 : 200;
  if (
    v.ok === true &&
    exact(v, ["ok", "operation", "status", "operationId", "data"]) &&
    v.operation === expectedOperation &&
    v.status === successStatus &&
    text(v.operationId, 512) &&
    validData(expectedOperation, v.data)
  )
    return { ok: true, data: v.data as Record<string, unknown> };
  if (
    v.ok === false &&
    exact(v, ["ok", "error"]) &&
    v.error &&
    typeof v.error === "object" &&
    !Array.isArray(v.error)
  ) {
    const error = v.error as Record<string, unknown>;
    if (
      typeof error.code === "string" &&
      Object.hasOwn(clientFailures, error.code) &&
      exact(error, ["code", "message"]) &&
      error.message === clientFailures[error.code as ClientFailureCode][1]
    )
      return { ok: false, error: error.code as ClientFailureCode };
  }
  if (
    v.ok === false &&
    (exact(v, ["ok", "operation", "status", "operationId", "error"]) ||
      exact(v, [
        "ok",
        "operation",
        "status",
        "operationId",
        "error",
        "recovery",
      ])) &&
    v.operation === expectedOperation &&
    typeof v.status === "number" &&
    text(v.operationId, 512) &&
    v.error &&
    typeof v.error === "object" &&
    !Array.isArray(v.error)
  ) {
    const error = v.error as Record<string, unknown>;
    const code = error.code;
    const recovery = v.recovery;
    const recoveryRecord =
      recovery && typeof recovery === "object" && !Array.isArray(recovery)
        ? (recovery as Record<string, unknown>)
        : undefined;
    const locator = recoveryRecord?.locator;
    const locatorRecord =
      locator && typeof locator === "object" && !Array.isArray(locator)
        ? (locator as Record<string, unknown>)
        : undefined;
    const validLocator =
      Boolean(locatorRecord) &&
      ((exact(locatorRecord as Record<string, unknown>, ["fileId"]) &&
        text((locatorRecord as Record<string, unknown>).fileId, 512)) ||
        (exact(locatorRecord as Record<string, unknown>, ["path"]) &&
          text((locatorRecord as Record<string, unknown>).path, 1024)));
    const validRecovery =
      recovery === undefined ||
      ((code === "CONFLICT" || code === "OUTCOME_UNKNOWN") &&
        recoveryRecord &&
        exact(recoveryRecord, ["action", "locator"]) &&
        recoveryRecord.action === "read" &&
        validLocator);
    if (
      typeof code === "string" &&
      Object.hasOwn(gatewayFailures, code) &&
      exact(error, ["code", "message"]) &&
      v.status === gatewayFailures[code as GatewayFailureCode][0] &&
      error.message === gatewayFailures[code as GatewayFailureCode][2] &&
      validRecovery
    )
      return { ok: false, error: code as GatewayFailureCode };
  }
  throw new Error("protocol");
}
async function invoke(
  runner: CommandRunner,
  operation: string,
  args: readonly string[],
): Promise<CliRecord> {
  let result: Readonly<{ exitCode: number; stdout: string }>;
  try {
    result = await runner.run(args);
  } catch {
    return { ok: false, error: "TRANSPORT" };
  }
  let record: CliRecord;
  try {
    record = parseCliRecord(result.stdout, operation);
  } catch {
    return { ok: false, error: "PROTOCOL" };
  }
  if (record.ok && result.exitCode === 0) return record;
  if (!record.ok) {
    const expected = Object.hasOwn(gatewayFailures, record.error)
      ? gatewayFailures[record.error as GatewayFailureCode][1]
      : clientFailures[record.error as ClientFailureCode][0];
    if (result.exitCode === expected) return record;
  }
  return { ok: false, error: "PROTOCOL" };
}
const passed = (): OperationOutcome => ({ outcome: "passed", code: "OK" });
const notAttempted = (): OperationOutcome => ({
  outcome: "inconclusive",
  code: "NOT_ATTEMPTED",
});
const initialOutcomes = () =>
  Object.fromEntries(
    operationStages.map((stage) => [stage, notAttempted()]),
  ) as Record<OperationStage, OperationOutcome>;
const outcomeFor = (
  record: Exclude<CliRecord, { ok: true }>,
): OperationOutcome => ({
  outcome: ["UNSUPPORTED", "TRANSPORT", "PROTOCOL", "OUTCOME_UNKNOWN"].includes(
    record.error,
  )
    ? "inconclusive"
    : "failed",
  code: record.error,
});
const isDuplicateRefusal = (
  record: CliRecord,
): record is Readonly<{
  ok: false;
  error: "INVALID_PATH";
}> => !record.ok && record.error === "INVALID_PATH";
const manualRecovery = (
  runReference: string,
): HarnessEvidence["manualRecovery"] => ({
  required: true,
  runReference,
  direction:
    "manually-reread-the-exact-generated-run-file-then-archive-only-if-identity-and-revision-are-proved",
});
function baseEvidence(
  config: CloudHarnessConfig,
  startedAt: string,
  completedAt: string,
  runIdentifier: string,
  fields: Pick<
    HarnessEvidence,
    | "overall"
    | "operationOutcomes"
    | "duplicateRefusal"
    | "staleConflict"
    | "archiveVerification"
    | "cleanup"
    | "manualRecovery"
    | "gatewayCapabilities"
  >,
): HarnessEvidence {
  return {
    schemaVersion: 1,
    harnessVersion: "3",
    startedAt,
    completedAt,
    runIdentifier,
    gatewayImageDigest: config.gatewayImageDigest,
    runtimeConfigDigest: config.runtimeConfigDigest,
    liveCapabilityEvidenceDigest: config.liveCapabilityEvidenceDigest,
    environmentIdentifier: config.environmentIdentifier,
    gatewayHostnameIdentifier: config.gatewayHostnameIdentifier,
    allowedMethods: ["GET", "POST"],
    platformControls: config.platformControls,
    ...fields,
    redaction: "passed",
  };
}
export async function runHarness(
  configInput: unknown,
  confirmed: string,
  runner: CommandRunner,
  dependencies: HarnessDependencies = {},
): Promise<HarnessEvidence> {
  const config = cloudHarnessConfigSchema.parse(configInput);
  if (confirmed !== confirmation) throw new Error("confirmation");
  const now = dependencies.now ?? (() => new Date());
  const runIdentifier = (dependencies.uuid ?? randomUUID)();
  const startedAt = now().toISOString();
  const outcomes = initialOutcomes();
  if (
    config.platformControls.credentialInjection !== "verified" ||
    config.platformControls.exactHostnameEgress !== "verified"
  ) {
    return baseEvidence(config, startedAt, now().toISOString(), runIdentifier, {
      overall: "inconclusive",
      operationOutcomes: outcomes,
      gatewayCapabilities: {
        expected: {
          topology: "nested-tree",
          writes: "enabled",
          archive: "enabled",
        },
        observed: {
          topology: "not-observed",
          writes: "not-observed",
          archive: "not-observed",
        },
      },
      duplicateRefusal: "inconclusive",
      staleConflict: "inconclusive",
      archiveVerification: "inconclusive",
      cleanup: "passed",
      manualRecovery: { required: false },
    });
  }
  let duplicateRefusal: HarnessOutcome = "inconclusive";
  let staleConflict: HarnessOutcome = "inconclusive";
  let archiveVerification: HarnessOutcome = "inconclusive";
  let cleanup: HarnessOutcome = "inconclusive";
  let recovery: HarnessEvidence["manualRecovery"] = { required: false };
  let observedTopology: "nested-tree" | "not-observed" = "not-observed";
  let observedWrites: "enabled" | "unsupported" | "not-observed" =
    "not-observed";
  let observedArchive: "enabled" | "unsupported" | "not-observed" =
    "not-observed";
  let hasKnownFile = false;
  let uncertainMutation = false;
  const relativePath = `${config.validationFolder}/w27-codex-cloud-validation-${runIdentifier}.md`;
  const archivedPath = `${config.archiveFolder}/${basename(relativePath)}`;
  const initial = `w27 validation ${runIdentifier}\n`;
  const fresh = `w27 validation updated ${runIdentifier}\n`;
  const directory = await mkdtemp(join(tmpdir(), "w27-codex-cloud-"));
  const contentFile = join(directory, "content.md");
  const call = async (
    stage: OperationStage,
    operation: string,
    args: readonly string[],
  ) => {
    const record = await invoke(runner, operation, [
      "--timeout-ms",
      String(config.timeoutMs),
      ...args,
    ]);
    outcomes[stage] = record.ok ? passed() : outcomeFor(record);
    return record;
  };
  const stop = (): never => {
    throw new Error("stop");
  };
  try {
    await chmod(directory, 0o700);
    await writeFile(contentFile, initial, { encoding: "utf8", mode: 0o600 });
    await chmod(contentFile, 0o600);
    for (const [stage, operation, args] of [
      [
        "list",
        "list_markdown",
        ["list", "--path", config.validationFolder, "--recursive"],
      ],
      [
        "archive_preflight",
        "list_markdown",
        ["list", "--path", config.archiveFolder],
      ],
      [
        "search",
        "search_markdown",
        ["search", "w27-validation", "--path", config.validationFolder],
      ],
    ] as const)
      if (!(await call(stage, operation, args)).ok) stop();
    observedTopology = "nested-tree";
    uncertainMutation = true;
    const created = await call("create", "create_markdown", [
      "create",
      relativePath,
      "--file",
      contentFile,
    ]);
    if (!created.ok) {
      if (created.error === "UNSUPPORTED") observedWrites = "unsupported";
      if (["TRANSPORT", "PROTOCOL", "OUTCOME_UNKNOWN"].includes(created.error))
        recovery = manualRecovery(runIdentifier);
      uncertainMutation = false;
      throw new Error("stop");
    }
    const createdData = created.data;
    uncertainMutation = false;
    const createdMetadata = metadata(createdData) ? createdData : undefined;
    if (!createdMetadata || createdMetadata.relativePath !== relativePath) {
      outcomes.create = { outcome: "failed", code: "MISMATCH" };
      recovery = manualRecovery(runIdentifier);
      throw new Error("stop");
    }
    let current: Metadata = createdMetadata;
    hasKnownFile = true;
    const createdRead = await call("read", "read_markdown", [
      "read",
      "--file-id",
      current.fileId,
    ]);
    if (
      !createdRead.ok ||
      !readData(createdRead.data) ||
      createdRead.data.fileId !== current.fileId ||
      createdRead.data.relativePath !== relativePath ||
      createdRead.data.revision !== current.revision ||
      createdRead.data.content !== initial
    ) {
      if (createdRead.ok)
        outcomes.read = { outcome: "failed", code: "MISMATCH" };
      recovery = manualRecovery(runIdentifier);
      stop();
    }
    observedWrites = "enabled";
    uncertainMutation = true;
    const duplicate = await call("duplicate_create", "create_markdown", [
      "create",
      relativePath,
      "--file",
      contentFile,
    ]);
    uncertainMutation = false;
    const duplicateCode = isDuplicateRefusal(duplicate)
      ? duplicate.error
      : undefined;
    if (!duplicateCode) {
      outcomes.duplicate_create = duplicate.ok
        ? { outcome: "failed", code: "MISMATCH" }
        : outcomeFor(duplicate);
      duplicateRefusal = "failed";
      recovery = manualRecovery(runIdentifier);
      stop();
    }
    outcomes.duplicate_create = {
      outcome: "passed",
      code: duplicateCode as "INVALID_PATH",
    };
    duplicateRefusal = "passed";
    const duplicateRead = await call("read_after_duplicate", "read_markdown", [
      "read",
      "--file-id",
      current.fileId,
    ]);
    if (
      !duplicateRead.ok ||
      !readData(duplicateRead.data) ||
      duplicateRead.data.fileId !== current.fileId ||
      duplicateRead.data.relativePath !== relativePath ||
      duplicateRead.data.revision !== current.revision ||
      duplicateRead.data.content !== initial
    ) {
      if (duplicateRead.ok)
        outcomes.read_after_duplicate = { outcome: "failed", code: "MISMATCH" };
      recovery = manualRecovery(runIdentifier);
      stop();
    }
    const staleRevision = current.revision;
    await writeFile(contentFile, fresh, { encoding: "utf8", mode: 0o600 });
    uncertainMutation = true;
    const updated = await call("update", "update_markdown", [
      "update",
      "--file-id",
      current.fileId,
      "--revision",
      current.revision,
      "--file",
      contentFile,
    ]);
    if (!updated.ok) {
      if (updated.error === "UNSUPPORTED") observedWrites = "unsupported";
      if (["TRANSPORT", "PROTOCOL", "OUTCOME_UNKNOWN"].includes(updated.error))
        recovery = manualRecovery(runIdentifier);
      uncertainMutation = false;
      throw new Error("stop");
    }
    const updatedData = updated.data;
    uncertainMutation = false;
    const updatedMetadata = metadata(updatedData) ? updatedData : undefined;
    if (
      !updatedMetadata ||
      updatedMetadata.fileId !== current.fileId ||
      updatedMetadata.relativePath !== relativePath ||
      updatedMetadata.revision === staleRevision
    ) {
      outcomes.update = { outcome: "failed", code: "MISMATCH" };
      recovery = manualRecovery(runIdentifier);
      throw new Error("stop");
    }
    current = updatedMetadata;
    const updatedRead = await call("read_after_update", "read_markdown", [
      "read",
      "--file-id",
      current.fileId,
    ]);
    if (
      !updatedRead.ok ||
      !readData(updatedRead.data) ||
      updatedRead.data.fileId !== current.fileId ||
      updatedRead.data.relativePath !== relativePath ||
      updatedRead.data.revision !== current.revision ||
      updatedRead.data.content !== fresh
    ) {
      if (updatedRead.ok)
        outcomes.read_after_update = { outcome: "failed", code: "MISMATCH" };
      recovery = manualRecovery(runIdentifier);
      stop();
    }
    uncertainMutation = true;
    const stale = await call("stale_update", "update_markdown", [
      "update",
      "--file-id",
      current.fileId,
      "--revision",
      staleRevision,
      "--file",
      contentFile,
    ]);
    uncertainMutation = false;
    if (stale.ok || stale.error !== "CONFLICT") {
      outcomes.stale_update = stale.ok
        ? { outcome: "failed", code: "MISMATCH" }
        : outcomeFor(stale);
      staleConflict = "failed";
      recovery = manualRecovery(runIdentifier);
      stop();
    }
    outcomes.stale_update = { outcome: "passed", code: "CONFLICT" };
    staleConflict = "passed";
    const preserved = await call("read_after_conflict", "read_markdown", [
      "read",
      "--file-id",
      current.fileId,
    ]);
    if (
      !preserved.ok ||
      !readData(preserved.data) ||
      preserved.data.fileId !== current.fileId ||
      preserved.data.relativePath !== relativePath ||
      preserved.data.revision !== current.revision ||
      preserved.data.content !== fresh
    ) {
      if (preserved.ok)
        outcomes.read_after_conflict = { outcome: "failed", code: "MISMATCH" };
      recovery = manualRecovery(runIdentifier);
      stop();
    }
    uncertainMutation = true;
    const archived = await call("archive", "archive_markdown", [
      "archive",
      "--file-id",
      current.fileId,
      "--revision",
      current.revision,
    ]);
    if (!archived.ok) {
      if (archived.error === "UNSUPPORTED") observedArchive = "unsupported";
      if (["TRANSPORT", "PROTOCOL", "OUTCOME_UNKNOWN"].includes(archived.error))
        recovery = manualRecovery(runIdentifier);
      uncertainMutation = false;
      throw new Error("stop");
    }
    const archivedData = archived.data;
    uncertainMutation = false;
    if (
      !metadata(archivedData) ||
      archivedData.fileId !== current.fileId ||
      archivedData.relativePath !== archivedPath
    ) {
      outcomes.archive = {
        outcome: "inconclusive",
        code: "ARCHIVE_UNVERIFIED",
      };
      recovery = manualRecovery(runIdentifier);
      stop();
    }
    archiveVerification = "passed";
    observedArchive = "enabled";
    cleanup = "passed";
  } catch {
    if (uncertainMutation || hasKnownFile)
      recovery = manualRecovery(runIdentifier);
    if (recovery.required) cleanup = "inconclusive";
    else if (cleanup !== "passed") cleanup = "passed";
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {
      cleanup = "failed";
      recovery = manualRecovery(runIdentifier);
    });
  }
  const values = Object.values(outcomes);
  const finalCleanup = cleanup as HarnessOutcome;
  const overall: HarnessOutcome =
    finalCleanup === "failed" ||
    values.some(({ outcome }) => outcome === "failed")
      ? "failed"
      : finalCleanup === "inconclusive" ||
          values.some(({ outcome }) => outcome === "inconclusive") ||
          duplicateRefusal !== "passed" ||
          staleConflict !== "passed" ||
          archiveVerification !== "passed"
        ? "inconclusive"
        : "passed";
  return baseEvidence(config, startedAt, now().toISOString(), runIdentifier, {
    overall,
    operationOutcomes: outcomes,
    gatewayCapabilities: {
      expected: {
        topology: "nested-tree",
        writes: "enabled",
        archive: "enabled",
      },
      observed: {
        topology: observedTopology,
        writes: observedWrites,
        archive: observedArchive,
      },
    },
    duplicateRefusal,
    staleConflict,
    archiveVerification,
    cleanup,
    manualRecovery: recovery,
  });
}
const outcomeSchema = z
  .object({
    outcome: z.enum(["passed", "failed", "inconclusive"]),
    code: z.enum([
      "OK",
      "NOT_ATTEMPTED",
      "UNAUTHENTICATED",
      "UNSUPPORTED",
      "INVALID_PATH",
      "AMBIGUOUS_PATH",
      "CONFLICT",
      "OUTCOME_UNKNOWN",
      "USAGE",
      "CREDENTIAL",
      "TRANSPORT",
      "PROTOCOL",
      "MISMATCH",
      "ARCHIVE_UNVERIFIED",
    ]),
  })
  .strict();
const stageSchema = z
  .object(
    Object.fromEntries(
      operationStages.map((stage) => [stage, outcomeSchema]),
    ) as Record<OperationStage, typeof outcomeSchema>,
  )
  .strict();
const evidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    harnessVersion: z.literal("3"),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    runIdentifier: z.string().uuid(),
    gatewayImageDigest: digest,
    runtimeConfigDigest: digest,
    liveCapabilityEvidenceDigest: digest,
    environmentIdentifier: z.string().regex(/^example-[A-Za-z0-9-]{1,120}$/u),
    gatewayHostnameIdentifier: z
      .string()
      .regex(/^example-[A-Za-z0-9-]{1,120}$/u),
    allowedMethods: z.tuple([z.literal("GET"), z.literal("POST")]),
    platformControls: cloudHarnessConfigSchema.shape.platformControls,
    gatewayCapabilities: z
      .object({
        expected: z
          .object({
            topology: z.literal("nested-tree"),
            writes: z.literal("enabled"),
            archive: z.literal("enabled"),
          })
          .strict(),
        observed: z
          .object({
            topology: z.enum(["nested-tree", "not-observed"]),
            writes: z.enum(["enabled", "unsupported", "not-observed"]),
            archive: z.enum(["enabled", "unsupported", "not-observed"]),
          })
          .strict(),
      })
      .strict(),
    overall: z.enum(["passed", "failed", "inconclusive"]),
    operationOutcomes: stageSchema,
    duplicateRefusal: z.enum(["passed", "failed", "inconclusive"]),
    staleConflict: z.enum(["passed", "failed", "inconclusive"]),
    archiveVerification: z.enum(["passed", "failed", "inconclusive"]),
    cleanup: z.enum(["passed", "failed", "inconclusive"]),
    manualRecovery: z.union([
      z.object({ required: z.literal(false) }).strict(),
      z
        .object({
          required: z.literal(true),
          runReference: z.string().uuid(),
          direction: z.literal(
            "manually-reread-the-exact-generated-run-file-then-archive-only-if-identity-and-revision-are-proved",
          ),
        })
        .strict(),
    ]),
    redaction: z.literal("passed"),
  })
  .strict();
export type EvidenceSanitizationContext = Readonly<{
  readonly forbiddenValues?: readonly string[];
}>;

export function assertSanitizedEvidence(
  value: unknown,
  context: EvidenceSanitizationContext = {},
): HarnessEvidence {
  const forbidden =
    /authorization|bearer|secret|token|url|path|content|revision|operationid|stdout|stderr|body|fileid|endpoint|header|provider|query|excerpt/i;
  const forbiddenValues = (context.forbiddenValues ?? []).filter(
    (entry) => entry.length > 0,
  );
  const containsForbiddenValue = (entry: string, forbiddenValue: string) => {
    if (entry === forbiddenValue) return true;
    // Embedded matching is limited to structured values with clear boundaries.
    // This catches quoted paths and opaque identifiers without treating ordinary
    // words in fixed evidence vocabulary as leaked configuration.
    if (!/[/.:_=-]/u.test(forbiddenValue)) return false;
    const escaped = forbiddenValue.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(
      `(?:^|[^A-Za-z0-9._/=-])${escaped}(?:$|[^A-Za-z0-9._/=-])`,
      "u",
    ).test(entry);
  };
  const inspect = (entry: unknown): void => {
    if (
      typeof entry === "string" &&
      forbiddenValues.some((forbiddenValue) =>
        containsForbiddenValue(entry, forbiddenValue),
      )
    )
      throw new Error("redaction");
    if (Array.isArray(entry)) {
      entry.forEach(inspect);
      return;
    }
    if (entry && typeof entry === "object")
      for (const [key, nested] of Object.entries(entry)) {
        if (forbidden.test(key)) throw new Error("redaction");
        inspect(nested);
      }
  };
  inspect(value);
  return evidenceSchema.parse(value) as HarnessEvidence;
}
