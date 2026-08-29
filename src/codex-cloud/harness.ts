import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const confirmation = "W27_CODEX_CLOUD_TEST_ONLY";
const failures = {
  UNAUTHENTICATED: [401, 6],
  UNSUPPORTED: [503, 7],
  CONFLICT: [409, 8],
} as const;
type FailureCode = keyof typeof failures;

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
      operation: string;
      status: number;
      error: FailureCode;
    }>;
export interface CommandRunner {
  run(
    args: readonly string[],
  ): Promise<Readonly<{ exitCode: number; stdout: string }>>;
}
export interface HarnessEvidence {
  readonly schemaVersion: 1;
  readonly harnessVersion: "1";
  readonly releaseDigest: string;
  readonly environmentIdentifier: string;
  readonly gatewayHostnameIdentifier: string;
  readonly allowedMethods: readonly ["GET", "POST"];
  readonly platformControls: "operator-must-verify";
  readonly operationOutcomes: Readonly<Record<string, HarnessOutcome>>;
  readonly staleConflict: HarnessOutcome;
  readonly cleanup: HarnessOutcome;
  readonly redaction: "passed";
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
    v.items.every(metadata) &&
    (operation !== "search_markdown" || v.items.length <= 100)
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
  if (
    v.ok === true &&
    exact(v, ["ok", "operation", "status", "operationId", "data"]) &&
    v.operation === expectedOperation &&
    typeof v.status === "number" &&
    typeof v.operationId === "string" &&
    validData(expectedOperation, v.data)
  )
    return {
      ok: true,
      operation: expectedOperation,
      status: v.status,
      data: v.data as Record<string, unknown>,
    };
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
    typeof v.operationId === "string" &&
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
      Object.hasOwn(failures, code) &&
      exact(error, ["code", "message"]) &&
      v.status === failures[code as FailureCode][0] &&
      validRecovery
    )
      return {
        ok: false,
        operation: expectedOperation,
        status: v.status,
        error: code as FailureCode,
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
  if (!record.ok && result.exitCode === failures[record.error][1])
    return record;
  throw new Error("cli-result");
}

export async function runHarness(
  configInput: unknown,
  confirmed: string,
  runner: CommandRunner,
): Promise<HarnessEvidence> {
  const config = cloudHarnessConfigSchema.parse(configInput);
  if (confirmed !== confirmation) throw new Error("confirmation");
  const outcomes: Record<string, HarnessOutcome> = {};
  let staleConflict: HarnessOutcome = "inconclusive";
  let cleanup: HarnessOutcome = "inconclusive";
  let current: Metadata | undefined;
  const runId = randomUUID();
  const relativePath = `${config.validationFolder}/w27-codex-cloud-validation-${runId}.md`;
  const initial = `w27 validation ${runId}\n`;
  const fresh = `w27 validation updated ${runId}\n`;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "w27-codex-cloud-"));
  const contentFile = join(temporaryDirectory, "content.md");
  const call = async (
    name: string,
    operation: string,
    args: readonly string[],
  ) => {
    const record = await invoke(runner, operation, [
      "--timeout-ms",
      String(config.timeoutMs),
      ...args,
    ]);
    outcomes[name] = record.ok
      ? "passed"
      : record.error === "UNSUPPORTED"
        ? "inconclusive"
        : "failed";
    return record;
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
    const created = await call("create", "create_markdown", [
      "create",
      relativePath,
      "--file",
      contentFile,
    ]);
    if (!created.ok) throw new Error("create");
    current = created.data as Metadata;
    const readCreated = await call("read", "read_markdown", [
      "read",
      "--file-id",
      current.fileId,
    ]);
    if (
      !readCreated.ok ||
      !readData(readCreated.data) ||
      readCreated.data.content !== initial
    )
      throw new Error("readback");
    const staleRevision = current.revision;
    await writeFile(contentFile, fresh, { encoding: "utf8", mode: 0o600 });
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
    current = updated.data as Metadata;
    if (current.revision === staleRevision) throw new Error("revision");
    const readUpdated = await call("read_after_update", "read_markdown", [
      "read",
      "--file-id",
      current.fileId,
    ]);
    if (
      !readUpdated.ok ||
      !readData(readUpdated.data) ||
      readUpdated.data.content !== fresh ||
      readUpdated.data.revision !== current.revision
    )
      throw new Error("readback");
    const stale = await invoke(runner, "update_markdown", [
      "--timeout-ms",
      String(config.timeoutMs),
      "update",
      "--file-id",
      current.fileId,
      "--revision",
      staleRevision,
      "--file",
      contentFile,
    ]);
    if (stale.ok || stale.error !== "CONFLICT") throw new Error("stale");
    staleConflict = "passed";
    outcomes.stale_update = "passed";
    const preserved = await call("read_after_conflict", "read_markdown", [
      "read",
      "--file-id",
      current.fileId,
    ]);
    if (
      !preserved.ok ||
      !readData(preserved.data) ||
      preserved.data.content !== fresh ||
      preserved.data.revision !== current.revision
    )
      throw new Error("preservation");
  } catch {
    if (current) outcomes.execution = "failed";
  } finally {
    try {
      if (current) {
        const archived = await invoke(runner, "archive_markdown", [
          "--timeout-ms",
          String(config.timeoutMs),
          "archive",
          "--file-id",
          current.fileId,
          "--revision",
          current.revision,
        ]);
        cleanup = archived.ok
          ? "passed"
          : archived.error === "UNSUPPORTED"
            ? "inconclusive"
            : "failed";
      }
    } catch {
      cleanup = "failed";
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  return evidence(config, outcomes, staleConflict, cleanup);
}
function evidence(
  config: CloudHarnessConfig,
  outcomes: Readonly<Record<string, HarnessOutcome>>,
  staleConflict: HarnessOutcome,
  cleanup: HarnessOutcome,
): HarnessEvidence {
  return {
    schemaVersion: 1,
    harnessVersion: "1",
    releaseDigest: config.releaseDigest,
    environmentIdentifier: config.environmentIdentifier,
    gatewayHostnameIdentifier: config.gatewayHostnameIdentifier,
    allowedMethods: ["GET", "POST"],
    platformControls: "operator-must-verify",
    operationOutcomes: outcomes,
    staleConflict,
    cleanup,
    redaction: "passed",
  };
}
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
  return value as HarnessEvidence;
}
