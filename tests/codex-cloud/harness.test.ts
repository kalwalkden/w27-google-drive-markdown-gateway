import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";
import {
  assertSanitizedEvidence,
  type CommandRunner,
  confirmation,
  runHarness,
} from "../../src/codex-cloud/harness.js";
import {
  externalRegularFile,
  isOutsideRepository,
  main,
  parseHarnessArgs,
  publishExternalEvidence,
  resolveInstallationBoundary,
} from "../../src/codex-cloud/harness-cli.js";

const runId = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-29T12:00:00.000Z";
async function invokeEntrypoint(
  entrypoint: string,
  args: readonly string[],
): Promise<Readonly<{ exitCode: number | null; stderr: string }>> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolveResult({ exitCode, stderr }));
  });
}

function compileHarness(source: string): string {
  return transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.ESNext,
      target: ScriptTarget.ES2023,
    },
  }).outputText;
}
const config = {
  cliExecutable: "md-drive",
  validationFolder: "nested/validation",
  archiveFolder: "archive",
  gatewayImageDigest: `sha256:${"0".repeat(64)}`,
  runtimeConfigDigest: `sha256:${"1".repeat(64)}`,
  liveCapabilityEvidenceDigest: `sha256:${"2".repeat(64)}`,
  environmentIdentifier: "example-environment",
  gatewayHostnameIdentifier: "example-gateway",
  timeoutMs: 1_000,
  platformControls: {
    checkedAt: timestamp,
    credentialInjection: "verified",
    exactHostnameEgress: "verified",
    methodEgress: "not-supported",
  },
} as const;
type Mode =
  | "success"
  | "duplicate-invalid-path"
  | "duplicate-ambiguous-path"
  | "create-unsupported"
  | "create-unknown"
  | "create-transport"
  | "create-protocol"
  | "create-mismatch"
  | "duplicate-unknown"
  | "duplicate-transport"
  | "duplicate-protocol"
  | "duplicate-read-moved"
  | "update-unknown"
  | "update-transport"
  | "update-protocol"
  | "update-mismatch"
  | "update-read-moved"
  | "stale-transport"
  | "stale-unknown"
  | "stale-protocol"
  | "stale-read-moved"
  | "archive-mismatch"
  | "archive-unknown"
  | "archive-transport"
  | "archive-protocol";
const gatewayFailure = (
  operation: string,
  code:
    | "UNAUTHENTICATED"
    | "UNSUPPORTED"
    | "INVALID_PATH"
    | "AMBIGUOUS_PATH"
    | "CONFLICT"
    | "OUTCOME_UNKNOWN",
) => {
  const values = {
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
  const [status, exitCode, message] = values[code];
  return {
    exitCode,
    stdout: JSON.stringify({
      ok: false,
      operation,
      status,
      operationId: "operation",
      error: { code, message },
      ...(code === "OUTCOME_UNKNOWN"
        ? { recovery: { action: "read", locator: { fileId: "file-1" } } }
        : {}),
    }),
  };
};
function fakeRunner(mode: Mode = "success"): {
  runner: CommandRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  let creates = 0;
  let updates = 0;
  let reads = 0;
  let revision = "revision-1";
  const generatedPath = `nested/validation/w27-codex-cloud-validation-${runId}.md`;
  const metadata = (relativePath = generatedPath) => ({
    relativePath,
    fileId: "file-1",
    revision,
    modifiedTime: timestamp,
    size: 1,
  });
  return {
    calls,
    runner: {
      async run(args) {
        calls.push([...args]);
        const command = args[2] ?? "";
        if (command === "create") {
          creates += 1;
          if (creates === 1 && mode === "create-unsupported")
            return gatewayFailure("create_markdown", "UNSUPPORTED");
          if (creates === 1 && mode === "create-unknown")
            return gatewayFailure("create_markdown", "OUTCOME_UNKNOWN");
          if (creates === 1 && mode === "create-transport")
            return {
              exitCode: 4,
              stdout: JSON.stringify({
                ok: false,
                error: {
                  code: "TRANSPORT",
                  message: "Gateway request failed.",
                },
              }),
            };
          if (creates === 1 && mode === "create-protocol")
            return { exitCode: 0, stdout: "not-json" };
          if (creates === 2) {
            if (mode === "duplicate-invalid-path")
              return gatewayFailure("create_markdown", "INVALID_PATH");
            if (mode === "duplicate-ambiguous-path")
              return gatewayFailure("create_markdown", "AMBIGUOUS_PATH");
            if (mode === "duplicate-unknown")
              return gatewayFailure("create_markdown", "OUTCOME_UNKNOWN");
            if (mode === "duplicate-transport")
              return {
                exitCode: 4,
                stdout: JSON.stringify({
                  ok: false,
                  error: {
                    code: "TRANSPORT",
                    message: "Gateway request failed.",
                  },
                }),
              };
            if (mode === "duplicate-protocol")
              return { exitCode: 0, stdout: "not-json" };
            return gatewayFailure("create_markdown", "INVALID_PATH");
          }
        }
        if (command === "update") {
          updates += 1;
          if (updates === 1 && mode === "update-unknown")
            return gatewayFailure("update_markdown", "OUTCOME_UNKNOWN");
          if (updates === 1 && mode === "update-transport")
            return {
              exitCode: 4,
              stdout: JSON.stringify({
                ok: false,
                error: {
                  code: "TRANSPORT",
                  message: "Gateway request failed.",
                },
              }),
            };
          if (updates === 1 && mode === "update-protocol")
            return { exitCode: 0, stdout: "not-json" };
          if (updates === 2) {
            if (mode === "stale-transport")
              return {
                exitCode: 4,
                stdout: JSON.stringify({
                  ok: false,
                  error: {
                    code: "TRANSPORT",
                    message: "Gateway request failed.",
                  },
                }),
              };
            if (mode === "stale-unknown")
              return gatewayFailure("update_markdown", "OUTCOME_UNKNOWN");
            if (mode === "stale-protocol")
              return { exitCode: 0, stdout: "not-json" };
            return gatewayFailure("update_markdown", "CONFLICT");
          }
          revision = "revision-2";
        }
        if (command === "read") reads += 1;
        if (command === "archive" && mode === "archive-unknown")
          return gatewayFailure("archive_markdown", "OUTCOME_UNKNOWN");
        if (command === "archive" && mode === "archive-transport")
          return {
            exitCode: 4,
            stdout: JSON.stringify({
              ok: false,
              error: { code: "TRANSPORT", message: "Gateway request failed." },
            }),
          };
        if (command === "archive" && mode === "archive-protocol")
          return { exitCode: 0, stdout: "not-json" };
        const data =
          command === "list" || command === "search"
            ? { items: [] }
            : command === "read"
              ? {
                  ...metadata(
                    (mode === "duplicate-read-moved" && reads === 2) ||
                      (mode === "update-read-moved" && reads === 3) ||
                      (mode === "stale-read-moved" && reads === 4)
                      ? `moved/w27-codex-cloud-validation-${runId}.md`
                      : generatedPath,
                  ),
                  content:
                    revision === "revision-1"
                      ? `w27 validation ${runId}\n`
                      : `w27 validation updated ${runId}\n`,
                }
              : command === "archive"
                ? metadata(
                    mode === "archive-mismatch"
                      ? generatedPath
                      : `archive/w27-codex-cloud-validation-${runId}.md`,
                  )
                : metadata();
        if (command === "create" && creates === 1 && mode === "create-mismatch")
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ok: true,
              operation: "create_markdown",
              status: 201,
              operationId: "operation",
              data: metadata("moved/created.md"),
            }),
          };
        if (command === "update" && updates === 1 && mode === "update-mismatch")
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ok: true,
              operation: "update_markdown",
              status: 200,
              operationId: "operation",
              data: metadata("moved/updated.md"),
            }),
          };
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            ok: true,
            operation: `${command}_markdown`,
            status: command === "create" ? 201 : 200,
            operationId: "operation",
            data,
          }),
        };
      },
    },
  };
}
const dependencies = {
  uuid: () => runId,
  now: () => new Date(timestamp),
} as const;
const stages = [
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

describe("Codex cloud harness", () => {
  it("requires strict external nested configuration and all three release digests", async () => {
    const fake = fakeRunner();
    for (const invalid of [
      { validationFolder: "root" },
      { validationFolder: "./validation" },
      { validationFolder: "nested/../validation" },
      { validationFolder: "nested//validation" },
      { validationFolder: "/nested/validation" },
      { validationFolder: "nested/validation/" },
      { archiveFolder: "." },
      { archiveFolder: "../archive" },
      { archiveFolder: "nested/validation/archive" },
      { archiveFolder: "nested" },
    ])
      await expect(
        runHarness(
          { ...config, ...invalid },
          confirmation,
          fake.runner,
          dependencies,
        ),
      ).rejects.toThrow();
    await expect(
      runHarness(
        { ...config, gatewayImageDigest: "sha256:UPPER" },
        confirmation,
        fake.runner,
        dependencies,
      ),
    ).rejects.toThrow();
    await expect(
      runHarness(
        { ...config, extra: true },
        confirmation,
        fake.runner,
        dependencies,
      ),
    ).rejects.toThrow();
    await expect(
      runHarness(config, "wrong", fake.runner, dependencies),
    ).rejects.toThrow("confirmation");
    expect(fake.calls).toHaveLength(0);
  });
  it("runs the nested six-operation release sequence once and archives only the verified identity", async () => {
    const fake = fakeRunner();
    const result = await runHarness(
      config,
      confirmation,
      fake.runner,
      dependencies,
    );
    expect(result).toMatchObject({
      overall: "passed",
      gatewayCapabilities: {
        expected: {
          topology: "nested-tree",
          writes: "enabled",
          archive: "enabled",
        },
        observed: {
          topology: "nested-tree",
          writes: "enabled",
          archive: "enabled",
        },
      },
      allowedMethods: ["GET", "POST"],
      duplicateRefusal: "passed",
      staleConflict: "passed",
      archiveVerification: "passed",
      cleanup: "passed",
      manualRecovery: { required: false },
      redaction: "passed",
    });
    expect(Object.keys(result.operationOutcomes)).toEqual(stages);
    expect(fake.calls.map((args) => args[2])).toEqual([
      "list",
      "list",
      "search",
      "create",
      "read",
      "create",
      "read",
      "update",
      "read",
      "update",
      "read",
      "archive",
    ]);
    expect(fake.calls[0]).toContain("--recursive");
    expect(fake.calls.filter((args) => args[2] === "create")).toHaveLength(2);
    expect(fake.calls.filter((args) => args[2] === "update")).toHaveLength(2);
    expect(fake.calls.filter((args) => args[2] === "archive")).toHaveLength(1);
  });
  it("reports default-disabled UNSUPPORTED as inconclusive without a later mutation", async () => {
    const fake = fakeRunner("create-unsupported");
    const result = await runHarness(
      config,
      confirmation,
      fake.runner,
      dependencies,
    );
    expect(result).toMatchObject({
      overall: "inconclusive",
      cleanup: "passed",
      manualRecovery: { required: false },
      gatewayCapabilities: {
        expected: { writes: "enabled" },
        observed: { writes: "unsupported", archive: "not-observed" },
      },
    });
    expect(result.operationOutcomes.create).toEqual({
      outcome: "inconclusive",
      code: "UNSUPPORTED",
    });
    expect(fake.calls.map((args) => args[2])).toEqual([
      "list",
      "list",
      "search",
      "create",
    ]);
  });
  it.each([
    ["credentialInjection", "unavailable"],
    ["exactHostnameEgress", "unavailable"],
  ] as const)(
    "blocks before temporary content or commands when %s is %s",
    async (control, status) => {
      const fake = fakeRunner();
      const result = await runHarness(
        {
          ...config,
          platformControls: { ...config.platformControls, [control]: status },
        },
        confirmation,
        fake.runner,
        dependencies,
      );
      expect(result).toMatchObject({
        overall: "inconclusive",
        cleanup: "passed",
        manualRecovery: { required: false },
        gatewayCapabilities: {
          observed: {
            topology: "not-observed",
            writes: "not-observed",
            archive: "not-observed",
          },
        },
      });
      expect(Object.values(result.operationOutcomes)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            outcome: "inconclusive",
            code: "NOT_ATTEMPTED",
          }),
        ]),
      );
      expect(fake.calls).toHaveLength(0);
    },
  );
  it("accepts the single-destination duplicate refusal after proving the original file is unchanged", async () => {
    const fake = fakeRunner("duplicate-invalid-path");
    const result = await runHarness(
      config,
      confirmation,
      fake.runner,
      dependencies,
    );
    expect(result.overall).toBe("passed");
    expect(result.operationOutcomes.duplicate_create).toEqual({
      outcome: "passed",
      code: "INVALID_PATH",
    });
    expect(fake.calls.map((args) => args[2])).toContain("read");
  });

  it("stops for manual recovery when duplicate refusal reveals ambiguous topology", async () => {
    const fake = fakeRunner("duplicate-ambiguous-path");
    const result = await runHarness(
      config,
      confirmation,
      fake.runner,
      dependencies,
    );
    expect(result.overall).toBe("failed");
    expect(result.operationOutcomes.duplicate_create).toEqual({
      outcome: "failed",
      code: "AMBIGUOUS_PATH",
    });
    expect(result.manualRecovery).toMatchObject({ required: true });
  });
  it.each([
    ["create-transport", "create"],
    ["create-unknown", "create"],
    ["create-protocol", "create"],
    ["create-mismatch", "create"],
    ["duplicate-unknown", "duplicate_create"],
    ["duplicate-transport", "duplicate_create"],
    ["duplicate-protocol", "duplicate_create"],
    ["duplicate-read-moved", "read_after_duplicate"],
    ["update-unknown", "update"],
    ["update-transport", "update"],
    ["update-protocol", "update"],
    ["update-mismatch", "update"],
    ["update-read-moved", "read_after_update"],
    ["stale-transport", "stale_update"],
    ["stale-unknown", "stale_update"],
    ["stale-protocol", "stale_update"],
    ["stale-read-moved", "read_after_conflict"],
    ["archive-mismatch", "archive"],
    ["archive-unknown", "archive"],
    ["archive-transport", "archive"],
    ["archive-protocol", "archive"],
  ] as const)("stops automatic cleanup after %s", async (mode, stage) => {
    const fake = fakeRunner(mode);
    const result = await runHarness(
      config,
      confirmation,
      fake.runner,
      dependencies,
    );
    expect(result.overall).not.toBe("passed");
    expect(result.manualRecovery).toEqual({
      required: true,
      runReference: runId,
      direction:
        "manually-reread-the-exact-generated-run-file-then-archive-only-if-identity-and-revision-are-proved",
    });
    expect(result.cleanup).toBe("inconclusive");
    if (!stage.startsWith("archive"))
      expect(fake.calls.filter((args) => args[2] === "archive")).toHaveLength(
        0,
      );
    expect(result.operationOutcomes[stage].outcome).not.toBe("passed");
  });
  it("keeps evidence closed and content-free", async () => {
    const result = await runHarness(
      config,
      confirmation,
      fakeRunner().runner,
      dependencies,
    );
    expect(assertSanitizedEvidence(result)).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(
      /nested\/validation|file-1|revision-1|w27 validation/u,
    );
    expect(() =>
      assertSanitizedEvidence({ ...result, nested: { path: "sentinel-path" } }),
    ).toThrow("redaction");
    expect(() =>
      assertSanitizedEvidence(
        { ...result, nested: { safe: "prefix [sentinel-content] suffix" } },
        { forbiddenValues: ["sentinel-content", "nested/validation"] },
      ),
    ).toThrow("redaction");
    for (const [field, forbiddenValue] of [
      ["environmentIdentifier", config.validationFolder],
      ["environmentIdentifier", "example-file-identifier"],
      ["gatewayHostnameIdentifier", "example-revision-identifier"],
    ] as const)
      expect(() =>
        assertSanitizedEvidence(
          { ...result, [field]: forbiddenValue },
          { forbiddenValues: [forbiddenValue] },
        ),
      ).toThrow("redaction");
    expect(
      assertSanitizedEvidence(result, {
        forbiddenValues: ["nested/validation", "archive", "revision-1"],
      }),
    ).toEqual(result);
    expect(() =>
      assertSanitizedEvidence({
        ...result,
        gatewayImageDigest: "sha256:UPPER",
      }),
    ).toThrow();
  });
});
describe("Codex cloud harness output safety", () => {
  it("requires a closed external config and output grammar", () => {
    expect(isOutsideRepository("/tmp/config.json", "/workspace/repo")).toBe(
      true,
    );
    expect(
      isOutsideRepository("/workspace/repo/config.json", "/workspace/repo"),
    ).toBe(false);
    expect(() => parseHarnessArgs(["run", "--config", "/tmp/a"])).toThrow();
    expect(
      parseHarnessArgs([
        "run",
        "--config",
        "/tmp/a",
        "--output",
        "/tmp/b",
        "--confirm",
        confirmation,
      ]),
    ).toEqual({ configPath: "/tmp/a", outputPath: "/tmp/b" });
  });
  it("rejects config and output paths that resolve inside the repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-cloud-path-"));
    const link = join(directory, "repo-link");
    const sourceAnchor = fileURLToPath(
      new URL("../../src/codex-cloud/harness-cli.ts", import.meta.url),
    );
    const { repositoryRoot: root, cliPath } =
      await resolveInstallationBoundary(sourceAnchor);
    await symlink(root, link);
    try {
      expect(cliPath).toBe(join(root, "dist", "codex-cli", "cli.js"));
      await expect(
        externalRegularFile(join(link, "package.json"), root),
      ).rejects.toThrow("repository-path");
      await expect(
        publishExternalEvidence(join(link, "evidence.json"), root, "safe\n"),
      ).rejects.toThrow("repository-path");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("uses an installation-relative boundary when its module anchor is symlinked", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-cloud-anchor-"));
    const sourceAnchor = fileURLToPath(
      new URL("../../src/codex-cloud/harness-cli.ts", import.meta.url),
    );
    const anchorLink = join(directory, "harness-cli-link.ts");
    await symlink(sourceAnchor, anchorLink);
    try {
      const direct = await resolveInstallationBoundary(sourceAnchor);
      const linked = await resolveInstallationBoundary(anchorLink);
      expect(linked).toEqual(direct);
      expect(linked.cliPath).toBe(
        join(linked.repositoryRoot, "dist", "codex-cli", "cli.js"),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("runs a compiled symlink entrypoint with blocked diagnostics and inconclusive evidence", async () => {
    const root = await mkdtemp(join(process.cwd(), ".codex-cloud-entrypoint-"));
    const external = await mkdtemp(join(tmpdir(), "codex-cloud-entrypoint-"));
    const dist = join(root, "dist", "codex-cloud");
    const entrypoint = join(root, "harness-cli-link.js");
    const sourceCli = fileURLToPath(
      new URL("../../src/codex-cloud/harness-cli.ts", import.meta.url),
    );
    const sourceHarness = fileURLToPath(
      new URL("../../src/codex-cloud/harness.ts", import.meta.url),
    );
    const invalidConfig = join(external, "invalid-config.json");
    const configPath = join(external, "config.json");
    const output = join(external, "evidence.json");
    try {
      await mkdir(dist, { recursive: true });
      const [cli, harness] = await Promise.all([
        readFile(sourceCli, "utf8"),
        readFile(sourceHarness, "utf8"),
      ]);
      await Promise.all([
        writeFile(join(dist, "harness-cli.js"), compileHarness(cli), "utf8"),
        writeFile(join(dist, "harness.js"), compileHarness(harness), "utf8"),
      ]);
      await symlink(join(dist, "harness-cli.js"), entrypoint);
      await writeFile(invalidConfig, "not-json", "utf8");
      const blocked = await invokeEntrypoint(entrypoint, [
        "run",
        "--config",
        invalidConfig,
        "--output",
        output,
        "--confirm",
        confirmation,
      ]);
      expect(blocked).toEqual({
        exitCode: 2,
        stderr: "codex-cloud harness: BLOCKED\n",
      });
      await expect(access(output)).rejects.toThrow();

      await writeFile(
        configPath,
        JSON.stringify({
          ...config,
          platformControls: {
            ...config.platformControls,
            credentialInjection: "unavailable",
          },
        }),
        "utf8",
      );
      const inconclusive = await invokeEntrypoint(entrypoint, [
        "run",
        "--config",
        configPath,
        "--output",
        output,
        "--confirm",
        confirmation,
      ]);
      expect(inconclusive).toEqual({ exitCode: 12, stderr: "" });
      expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
        overall: "inconclusive",
        cleanup: "passed",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });
  it("publishes 0600 evidence atomically without overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-cloud-publish-"));
    const output = join(directory, "evidence.json");
    try {
      await publishExternalEvidence(output, resolve("."), "complete\n");
      expect(await readFile(output, "utf8")).toBe("complete\n");
      expect((await lstat(output)).mode & 0o777).toBe(0o600);
      await expect(
        publishExternalEvidence(output, resolve("."), "replace\n"),
      ).rejects.toThrow("output-exists");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("leaves no output when external configuration is invalid", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-cloud-failure-"));
    const configPath = join(directory, "config.json");
    const output = join(directory, "evidence.json");
    await writeFile(configPath, "not-json", "utf8");
    try {
      await expect(
        main([
          "run",
          "--config",
          configPath,
          "--output",
          output,
          "--confirm",
          confirmation,
        ]),
      ).resolves.toBe(2);
      await expect(access(output)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("publishes sanitized manual-recovery evidence after OUTCOME_UNKNOWN", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-cloud-unknown-"));
    const configPath = join(directory, "config.json");
    const output = join(directory, "evidence.json");
    await writeFile(configPath, JSON.stringify(config), {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await expect(
        main(
          [
            "run",
            "--config",
            configPath,
            "--output",
            output,
            "--confirm",
            confirmation,
          ],
          fakeRunner("create-unknown").runner,
        ),
      ).resolves.toBe(12);
      const evidence = JSON.parse(await readFile(output, "utf8")) as Record<
        string,
        unknown
      >;
      expect(evidence).toMatchObject({
        overall: "inconclusive",
        cleanup: "inconclusive",
        manualRecovery: {
          required: true,
          direction:
            "manually-reread-the-exact-generated-run-file-then-archive-only-if-identity-and-revision-are-proved",
        },
      });
      expect(JSON.stringify(evidence)).not.toContain(config.validationFolder);
      expect((await lstat(output)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
