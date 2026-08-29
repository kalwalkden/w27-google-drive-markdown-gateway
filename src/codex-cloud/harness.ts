import { z } from "zod";

export const confirmation = "W27_CODEX_CLOUD_TEST_ONLY";
const resultCodes = ["UNAUTHENTICATED", "UNSUPPORTED", "CONFLICT"] as const;

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
export interface CliRecord {
  readonly ok: boolean;
  readonly operation?: string;
  readonly status?: number;
  readonly error?: Readonly<{ code: (typeof resultCodes)[number] }>;
}
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

function parseCliRecord(value: string): CliRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("protocol");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("protocol");
  const record = parsed as Record<string, unknown>;
  if (
    record.ok === true &&
    typeof record.operation === "string" &&
    typeof record.status === "number"
  )
    return { ok: true, operation: record.operation, status: record.status };
  if (
    record.ok === false &&
    typeof record.operation === "string" &&
    typeof record.status === "number" &&
    record.error &&
    typeof record.error === "object"
  ) {
    const error = record.error as Record<string, unknown>;
    if (
      typeof error.code === "string" &&
      resultCodes.includes(error.code as (typeof resultCodes)[number])
    )
      return {
        ok: false,
        operation: record.operation,
        status: record.status,
        error: { code: error.code as (typeof resultCodes)[number] },
      };
  }
  throw new Error("protocol");
}

async function invoke(
  runner: CommandRunner,
  args: readonly string[],
): Promise<CliRecord> {
  const result = await runner.run(args);
  const record = parseCliRecord(result.stdout);
  if (record.ok && result.exitCode === 0) return record;
  if (
    !record.ok &&
    ((record.error?.code === "CONFLICT" && result.exitCode === 8) ||
      (record.error?.code === "UNAUTHENTICATED" && result.exitCode === 6) ||
      (record.error?.code === "UNSUPPORTED" && result.exitCode === 7))
  )
    return record;
  throw new Error("cli-result");
}

/** Operator-only state machine. It has no HTTP, Drive, secret, or shell boundary. */
export async function runHarness(
  configInput: unknown,
  confirmed: string,
  runner: CommandRunner,
): Promise<HarnessEvidence> {
  const config = cloudHarnessConfigSchema.parse(configInput);
  if (confirmed !== confirmation) throw new Error("confirmation");
  const outcomes: Record<string, HarnessOutcome> = {};
  let cleanup: HarnessOutcome = "inconclusive";
  const call = async (name: string, args: readonly string[]) => {
    const record = await invoke(runner, args);
    outcomes[name] = record.ok
      ? "passed"
      : record.error?.code === "UNSUPPORTED"
        ? "inconclusive"
        : "failed";
    if (!record.ok) throw new Error("operation");
    return record;
  };
  try {
    await call("list", ["list", "--path", config.validationFolder]);
    await call("search", [
      "search",
      "validation",
      "--path",
      config.validationFolder,
    ]);
    await call("read", ["read", "--path", config.validationFolder]);
    await call("create", ["create"]);
    await call("read_after_create", ["read"]);
    await call("update", ["update"]);
    await call("read_after_update", ["read"]);
    const stale = await invoke(runner, ["update"]);
    if (!(!stale.ok && stale.error?.code === "CONFLICT"))
      throw new Error("stale");
    outcomes.stale_update = "passed";
    await call("read_after_conflict", ["read"]);
  } catch {
    cleanup = "inconclusive";
    return evidence(config, outcomes, "failed", cleanup);
  } finally {
    try {
      const archived = await invoke(runner, ["archive"]);
      cleanup = archived.ok ? "passed" : "failed";
    } catch {
      cleanup = "failed";
    }
  }
  return evidence(config, outcomes, "passed", cleanup);
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
