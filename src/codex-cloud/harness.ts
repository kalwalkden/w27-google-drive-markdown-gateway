import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";

export const confirmation = "W27_CODEX_CLOUD_TEST_ONLY";

const gatewayFailures = {
  UNAUTHENTICATED: [401, 6, "Authentication failed."],
  UNSUPPORTED: [503, 7, "Operation is unavailable."],
  CONFLICT: [409, 8, "Markdown revision conflict."],
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
  | "BLOCKED"
  | "NOT_ATTEMPTED"
  | GatewayFailureCode
  | ClientFailureCode
  | "MISMATCH"
  | "ARCHIVE_UNVERIFIED"
  | "FAILED";

const platformControlSchema = z.enum(["verified", "unavailable"]);
export const cloudHarnessConfigSchema = z
  .object({
    cliExecutable: z.literal("md-drive"),
    validationFolder: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/u),
    archiveFolder: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/u),
    releaseDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
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
  .strict();
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
  | Readonly<{
      ok: true;
      operation: string;
      status: number;
      data: Record<string, unknown>;
    }>
  | Readonly<{
      ok: false;
      operation?: string;
      status?: number;
      error: GatewayFailureCode | ClientFailureCode;
    }>;
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
  readonly harnessVersion: "2";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly runIdentifier: string;
  readonly releaseDigest: string;
  readonly environmentIdentifier: string;
  readonly gatewayHostnameIdentifier: string;
  readonly allowedMethods: readonly ["GET", "POST"];
  readonly platformControls: CloudHarnessConfig["platformControls"];
  readonly gatewayCapabilities: Readonly<{
    topology: "direct-root-only";
    writes: "disabled";
    archive: "disabled";
  }>;
  readonly overall: "passed" | "failed" | "inconclusive" | "blocked";
  readonly operationOutcomes: OperationOutcomes;
  readonly staleConflict: HarnessOutcome;
  readonly cleanup: HarnessOutcome;
  readonly manualCleanup:
    | Readonly<{ required: false }>
    | Readonly<{
        required: true;
        runReference: string;
        direction: "locate-exact-generated-run-file-and-archive-manually";
      }>;
  readonly redaction: "passed";
}

interface HarnessDependencies {
  readonly now?: () => Date;
  readonly uuid?: () => string;
  /** Non-production seam for exercising a capability profile not shipped by the gateway. */
  readonly testOnlyFutureCapabilities?: boolean;
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
  const expectedSuccessStatus =
    expectedOperation === "create_markdown" ? 201 : 200;
  if (
    v.ok === true &&
    exact(v, ["ok", "operation", "status", "operationId", "data"]) &&
    v.operation === expectedOperation &&
    v.status === expectedSuccessStatus &&
    text(v.operationId, 512) &&
    validData(expectedOperation, v.data)
  )
    return {
      ok: true,
      operation: expectedOperation,
      status: expectedSuccessStatus,
      data: v.data as Record<string, unknown>,
    };
  if (
    v.ok === false &&
    exact(v, ["ok", "error"]) &&
    v.error &&
    typeof v.error === "object" &&
    !Array.isArray(v.error)
  ) {
    const error = v.error as Record<string, unknown>;
    const code = error.code;
    if (
      typeof code === "string" &&
      Object.hasOwn(clientFailures, code) &&
      exact(error, ["code", "message"]) &&
      error.message === clientFailures[code as ClientFailureCode][1]
    )
      return { ok: false, error: code as ClientFailureCode };
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
      (code === "CONFLICT" &&
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
      return {
        ok: false,
        operation: expectedOperation,
        status: v.status,
        error: code as GatewayFailureCode,
      };
  }
  throw new Error("protocol");
}
async function invoke(
  runner: CommandRunner,
  operation: string,
  args: readonly string[],
): Promise<CliRecord> {
  const result = await runner.run(args);
  const record = parseCliRecord(result.stdout, operation);
  if (record.ok && result.exitCode === 0) return record;
  if (!record.ok) {
    const expectedExit = Object.hasOwn(gatewayFailures, record.error)
      ? gatewayFailures[record.error as GatewayFailureCode][1]
      : clientFailures[record.error as ClientFailureCode][0];
    if (result.exitCode === expectedExit) return record;
  }
  throw new Error("cli-result");
}

const passed = (): OperationOutcome => ({ outcome: "passed", code: "OK" });
const notAttempted = (): OperationOutcome => ({
  outcome: "inconclusive",
  code: "NOT_ATTEMPTED",
});
const blocked = (): OperationOutcome => ({
  outcome: "inconclusive",
  code: "BLOCKED",
});
const initialOutcomes = (): Record<OperationStage, OperationOutcome> =>
  Object.fromEntries(
    operationStages.map((stage) => [stage, notAttempted()]),
  ) as Record<OperationStage, OperationOutcome>;
const resultOutcome = (
  record: Exclude<CliRecord, { ok: true }>,
): OperationOutcome => ({
  outcome:
    record.error === "UNSUPPORTED" || record.error === "TRANSPORT"
      ? "inconclusive"
      : "failed",
  code: record.error,
});
const manualCleanup = (
  runReference: string,
): HarnessEvidence["manualCleanup"] => ({
  required: true,
  runReference,
  direction: "locate-exact-generated-run-file-and-archive-manually",
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
    | "staleConflict"
    | "cleanup"
    | "manualCleanup"
  >,
): HarnessEvidence {
  return {
    schemaVersion: 1,
    harnessVersion: "2",
    startedAt,
    completedAt,
    runIdentifier,
    releaseDigest: config.releaseDigest,
    environmentIdentifier: config.environmentIdentifier,
    gatewayHostnameIdentifier: config.gatewayHostnameIdentifier,
    allowedMethods: ["GET", "POST"],
    platformControls: config.platformControls,
    gatewayCapabilities: {
      topology: "direct-root-only",
      writes: "disabled",
      archive: "disabled",
    },
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

  // The shipped gateway is intentionally direct-root-only with writes and
  // archive disabled. Keep the live executable blocked unless its capability
  // profile and evidence contract both change.
  if (dependencies.testOnlyFutureCapabilities !== true) {
    return baseEvidence(config, startedAt, now().toISOString(), runIdentifier, {
      overall: "blocked",
      operationOutcomes: Object.fromEntries(
        operationStages.map((stage) => [stage, blocked()]),
      ) as OperationOutcomes,
      staleConflict: "inconclusive",
      cleanup: "passed",
      manualCleanup: { required: false },
    });
  }

  return runFutureSequence(config, runner, runIdentifier, startedAt, now);
}

async function runFutureSequence(
  config: CloudHarnessConfig,
  runner: CommandRunner,
  runIdentifier: string,
  startedAt: string,
  now: () => Date,
): Promise<HarnessEvidence> {
  const outcomes = initialOutcomes();
  let staleConflict: HarnessOutcome = "inconclusive";
  let cleanup: HarnessOutcome = "inconclusive";
  let current: Metadata | undefined;
  let cleanupDirection: HarnessEvidence["manualCleanup"] = { required: false };
  let createUncertain = false;
  let archiveRevisionVerified = false;
  const relativePath = `${config.validationFolder}/w27-codex-cloud-validation-${runIdentifier}.md`;
  const archivedPath = `${config.archiveFolder}/${basename(relativePath)}`;
  const initial = `w27 validation ${runIdentifier}\n`;
  const fresh = `w27 validation updated ${runIdentifier}\n`;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "w27-codex-cloud-"));
  const contentFile = join(temporaryDirectory, "content.md");
  const call = async (
    name: OperationStage,
    operation: string,
    args: readonly string[],
  ) => {
    try {
      const record = await invoke(runner, operation, [
        "--timeout-ms",
        String(config.timeoutMs),
        ...args,
      ]);
      outcomes[name] = record.ok ? passed() : resultOutcome(record);
      return record;
    } catch (error) {
      outcomes[name] = {
        outcome:
          error instanceof Error &&
          (error.message === "protocol" || error.message === "cli-result")
            ? "inconclusive"
            : "failed",
        code:
          error instanceof Error &&
          (error.message === "protocol" || error.message === "cli-result")
            ? "PROTOCOL"
            : "FAILED",
      };
      throw error;
    }
  };
  try {
    await chmod(temporaryDirectory, 0o700);
    await writeFile(contentFile, initial, { encoding: "utf8", mode: 0o600 });
    await chmod(contentFile, 0o600);
    for (const [name, args] of [
      ["list", ["list", "--path", config.validationFolder]],
      ["archive_preflight", ["list", "--path", config.archiveFolder]],
      [
        "search",
        ["search", "w27-validation", "--path", config.validationFolder],
      ],
    ] as const) {
      const record = await call(
        name,
        name === "search" ? "search_markdown" : "list_markdown",
        args,
      );
      if (!record.ok) throw new Error("preflight");
    }
    createUncertain = true;
    const created = await call("create", "create_markdown", [
      "create",
      relativePath,
      "--file",
      contentFile,
    ]);
    if (!created.ok) {
      if (created.error === "TRANSPORT" || created.error === "PROTOCOL") {
        cleanupDirection = manualCleanup(runIdentifier);
        outcomes.create = {
          outcome: "inconclusive",
          code: created.error,
        };
        createUncertain = false;
      } else createUncertain = false;
      throw new Error("create");
    }
    createUncertain = false;
    const createdMetadata = created.data as Metadata;
    if (createdMetadata.relativePath !== relativePath) {
      outcomes.create = { outcome: "failed", code: "MISMATCH" };
      cleanupDirection = manualCleanup(runIdentifier);
      throw new Error("create-identity");
    }
    current = createdMetadata;
    const readCreated = await call("read", "read_markdown", [
      "read",
      "--file-id",
      current.fileId,
    ]);
    if (
      !readCreated.ok ||
      !readData(readCreated.data) ||
      readCreated.data.fileId !== current.fileId ||
      readCreated.data.relativePath !== relativePath ||
      readCreated.data.content !== initial ||
      readCreated.data.revision !== current.revision
    ) {
      if (readCreated.ok)
        outcomes.read = { outcome: "failed", code: "MISMATCH" };
      throw new Error("readback");
    }
    archiveRevisionVerified = true;
    const staleRevision = current.revision;
    await writeFile(contentFile, fresh, { encoding: "utf8", mode: 0o600 });
    // A mutation may have applied even when its result cannot be verified.
    archiveRevisionVerified = false;
    const updated = await call("update", "update_markdown", [
      "update",
      "--file-id",
      current.fileId,
      "--revision",
      current.revision,
      "--file",
      contentFile,
    ]);
    if (!updated.ok) throw new Error("update");
    const updatedMetadata = updated.data as Metadata;
    if (
      updatedMetadata.fileId !== current.fileId ||
      updatedMetadata.relativePath !== relativePath ||
      updatedMetadata.revision === staleRevision
    ) {
      outcomes.update = { outcome: "failed", code: "MISMATCH" };
      throw new Error("revision");
    }
    current = updatedMetadata;
    const readUpdated = await call("read_after_update", "read_markdown", [
      "read",
      "--file-id",
      current.fileId,
    ]);
    if (
      !readUpdated.ok ||
      !readData(readUpdated.data) ||
      readUpdated.data.fileId !== current.fileId ||
      readUpdated.data.relativePath !== relativePath ||
      readUpdated.data.content !== fresh ||
      readUpdated.data.revision !== current.revision
    ) {
      if (readUpdated.ok)
        outcomes.read_after_update = { outcome: "failed", code: "MISMATCH" };
      throw new Error("readback");
    }
    archiveRevisionVerified = true;
    // Re-establish the current revision after the deliberate stale mutation.
    archiveRevisionVerified = false;
    const stale = await call("stale_update", "update_markdown", [
      "update",
      "--file-id",
      current.fileId,
      "--revision",
      staleRevision,
      "--file",
      contentFile,
    ]);
    if (stale.ok || stale.error !== "CONFLICT") {
      outcomes.stale_update = stale.ok
        ? { outcome: "failed", code: "MISMATCH" }
        : resultOutcome(stale);
      staleConflict = "failed";
      throw new Error("stale");
    }
    staleConflict = "passed";
    outcomes.stale_update = { outcome: "passed", code: "CONFLICT" };
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
      preserved.data.content !== fresh ||
      preserved.data.revision !== current.revision
    ) {
      if (preserved.ok)
        outcomes.read_after_conflict = { outcome: "failed", code: "MISMATCH" };
      throw new Error("preservation");
    }
    archiveRevisionVerified = true;
  } catch {
    if (createUncertain) {
      cleanupDirection = manualCleanup(runIdentifier);
      outcomes.create = { outcome: "inconclusive", code: "PROTOCOL" };
    }
  } finally {
    try {
      if (current && archiveRevisionVerified) {
        const archived = await call("archive", "archive_markdown", [
          "archive",
          "--file-id",
          current.fileId,
          "--revision",
          current.revision,
        ]);
        if (
          archived.ok &&
          metadata(archived.data) &&
          archived.data.fileId === current.fileId &&
          archived.data.relativePath === archivedPath
        ) {
          cleanup = "passed";
          outcomes.archive = passed();
        } else {
          cleanup = archived.ok ? "inconclusive" : outcomes.archive.outcome;
          if (archived.ok)
            outcomes.archive = {
              outcome: "inconclusive",
              code: "ARCHIVE_UNVERIFIED",
            };
          cleanupDirection = manualCleanup(runIdentifier);
        }
      } else if (current || cleanupDirection.required) {
        cleanup = "inconclusive";
        cleanupDirection = manualCleanup(runIdentifier);
      } else {
        cleanup = "passed";
      }
    } catch {
      cleanup = "failed";
      outcomes.archive = { outcome: "failed", code: "FAILED" };
      cleanupDirection = manualCleanup(runIdentifier);
    }
    try {
      await rm(temporaryDirectory, { recursive: true, force: true });
    } catch {
      cleanup = "failed";
      cleanupDirection = manualCleanup(runIdentifier);
    }
  }
  const hasFailedOperation = Object.values(outcomes).some(
    ({ outcome }) => outcome === "failed",
  );
  const hasInconclusiveOperation = Object.values(outcomes).some(
    ({ outcome }) => outcome === "inconclusive",
  );
  const overall =
    cleanup === "failed" || hasFailedOperation
      ? "failed"
      : cleanup === "inconclusive" ||
          hasInconclusiveOperation ||
          staleConflict !== "passed"
        ? "inconclusive"
        : "passed";
  return baseEvidence(config, startedAt, now().toISOString(), runIdentifier, {
    overall,
    operationOutcomes: outcomes,
    staleConflict,
    cleanup,
    manualCleanup: cleanupDirection,
  });
}

const outcomeSchema = z
  .object({
    outcome: z.enum(["passed", "failed", "inconclusive"]),
    code: z.enum([
      "OK",
      "BLOCKED",
      "NOT_ATTEMPTED",
      "UNAUTHENTICATED",
      "UNSUPPORTED",
      "CONFLICT",
      "USAGE",
      "CREDENTIAL",
      "TRANSPORT",
      "PROTOCOL",
      "MISMATCH",
      "ARCHIVE_UNVERIFIED",
      "FAILED",
    ]),
  })
  .strict();
const evidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    harnessVersion: z.literal("2"),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    runIdentifier: z.string().uuid(),
    releaseDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    environmentIdentifier: z.string().regex(/^example-[A-Za-z0-9-]{1,120}$/u),
    gatewayHostnameIdentifier: z
      .string()
      .regex(/^example-[A-Za-z0-9-]{1,120}$/u),
    allowedMethods: z.tuple([z.literal("GET"), z.literal("POST")]),
    platformControls: cloudHarnessConfigSchema.shape.platformControls,
    gatewayCapabilities: z
      .object({
        topology: z.literal("direct-root-only"),
        writes: z.literal("disabled"),
        archive: z.literal("disabled"),
      })
      .strict(),
    overall: z.enum(["passed", "failed", "inconclusive", "blocked"]),
    operationOutcomes: z
      .object({
        list: outcomeSchema,
        archive_preflight: outcomeSchema,
        search: outcomeSchema,
        create: outcomeSchema,
        read: outcomeSchema,
        update: outcomeSchema,
        read_after_update: outcomeSchema,
        stale_update: outcomeSchema,
        read_after_conflict: outcomeSchema,
        archive: outcomeSchema,
      })
      .strict(),
    staleConflict: z.enum(["passed", "failed", "inconclusive"]),
    cleanup: z.enum(["passed", "failed", "inconclusive"]),
    manualCleanup: z.union([
      z.object({ required: z.literal(false) }).strict(),
      z
        .object({
          required: z.literal(true),
          runReference: z.string().uuid(),
          direction: z.literal(
            "locate-exact-generated-run-file-and-archive-manually",
          ),
        })
        .strict(),
    ]),
    redaction: z.literal("passed"),
  })
  .strict();

export function assertSanitizedEvidence(value: unknown): HarnessEvidence {
  const forbidden =
    /authorization|bearer|secret|token|url|path|content|revision|operationid|stdout|stderr|body/i;
  const inspect = (entry: unknown): void => {
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
