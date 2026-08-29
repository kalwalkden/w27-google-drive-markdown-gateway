import {
  access,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
} from "../../src/codex-cloud/harness-cli.js";

const runId = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-29T12:00:00.000Z";
const config = {
  cliExecutable: "md-drive",
  validationFolder: "validation",
  archiveFolder: "archive",
  releaseDigest: `sha256:${"0".repeat(64)}`,
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
  | "create-transport"
  | "create-mismatch"
  | "create-unauthenticated"
  | "create-unsupported"
  | "stale-success"
  | "readback-mismatch"
  | "update-transport"
  | "update-malformed"
  | "update-throw"
  | "update-readback-mismatch"
  | "stale-transport"
  | "stale-malformed"
  | "stale-throw"
  | "stale-readback-mismatch"
  | "archive-failure"
  | "archive-unverified"
  | "archive-throw"
  | "malformed"
  | "create-malformed";

const gatewayFailure = (
  operation: string,
  code: "UNAUTHENTICATED" | "UNSUPPORTED" | "CONFLICT",
) => {
  const values = {
    UNAUTHENTICATED: [401, 6, "Authentication failed."],
    UNSUPPORTED: [503, 7, "Operation is unavailable."],
    CONFLICT: [409, 8, "Markdown revision conflict."],
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
    }),
  };
};

function fakeRunner(
  mode: Mode = "success",
): { runner: CommandRunner; calls: string[][] } | never {
  const calls: string[][] = [];
  let updates = 0;
  let reads = 0;
  let revision = "revision-1";
  const generatedPath = `validation/w27-codex-cloud-validation-${runId}.md`;
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
        if (mode === "malformed") return { exitCode: 0, stdout: "not-json" };
        if (mode === "create-malformed" && command === "create")
          return { exitCode: 0, stdout: "not-json" };
        if (command === "create" && mode === "create-transport")
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
        if (command === "create" && mode === "create-unauthenticated")
          return gatewayFailure("create_markdown", "UNAUTHENTICATED");
        if (command === "create" && mode === "create-unsupported")
          return gatewayFailure("create_markdown", "UNSUPPORTED");
        if (command === "update") {
          updates += 1;
          if (updates === 1 && mode === "update-malformed")
            return { exitCode: 0, stdout: "not-json" };
          if (updates === 2 && mode === "stale-malformed")
            return { exitCode: 0, stdout: "not-json" };
          if (updates === 1 && mode === "update-throw")
            throw new Error("runner failure");
          if (updates === 2 && mode === "stale-throw")
            throw new Error("runner failure");
          if (
            (updates === 1 && mode === "update-transport") ||
            (updates === 2 && mode === "stale-transport")
          )
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
          if (updates === 2 && mode !== "stale-success")
            return gatewayFailure("update_markdown", "CONFLICT");
          revision = updates === 1 ? "revision-2" : "revision-3";
        }
        if (command === "archive") {
          if (mode === "archive-throw") throw new Error("private detail");
          if (mode === "archive-failure")
            return gatewayFailure("archive_markdown", "UNSUPPORTED");
        }
        if (command === "read") reads += 1;
        const data =
          command === "list" || command === "search"
            ? { items: [] }
            : command === "read"
              ? {
                  ...metadata(),
                  content:
                    mode === "readback-mismatch" && reads === 1
                      ? "wrong"
                      : mode === "update-readback-mismatch" && reads === 2
                        ? "wrong"
                        : mode === "stale-readback-mismatch" && reads === 3
                          ? "wrong"
                          : revision === "revision-1"
                            ? `w27 validation ${runId}\n`
                            : `w27 validation updated ${runId}\n`,
                }
              : command === "archive"
                ? metadata(
                    mode === "archive-unverified"
                      ? generatedPath
                      : `archive/w27-codex-cloud-validation-${runId}.md`,
                  )
                : metadata(
                    command === "create" && mode === "create-mismatch"
                      ? "other.md"
                      : generatedPath,
                  );
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

const future = {
  testOnlyFutureCapabilities: true,
  uuid: () => runId,
  now: () => new Date(timestamp),
} as const;
const operationOutcomeKeys = [
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

describe("Codex cloud harness", () => {
  it("requires a closed external config and output grammar", () => {
    expect(isOutsideRepository("/tmp/config.json", "/workspace/repo")).toBe(
      true,
    );
    expect(
      isOutsideRepository("/workspace/repo/config.json", "/workspace/repo"),
    ).toBe(false);
    expect(() => parseHarnessArgs(["run", "--config", "/tmp/a"])).toThrow();
    expect(() =>
      parseHarnessArgs([
        "run",
        "--config",
        "/tmp/a",
        "--config",
        "/tmp/b",
        "--confirm",
        confirmation,
      ]),
    ).toThrow();
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

  it("reports the current gateway profile as blocked without invoking the CLI", async () => {
    let calls = 0;
    const result = await runHarness(
      config,
      confirmation,
      {
        async run() {
          calls += 1;
          throw new Error("must not run");
        },
      },
      futureWithoutCapability(),
    );
    expect(calls).toBe(0);
    expect(result).toMatchObject({
      overall: "blocked",
      gatewayCapabilities: {
        topology: "direct-root-only",
        writes: "disabled",
        archive: "disabled",
      },
      platformControls: config.platformControls,
      startedAt: timestamp,
      completedAt: timestamp,
      cleanup: "passed",
      manualCleanup: { required: false },
    });
    expect(result.operationOutcomes.create).toEqual({
      outcome: "inconclusive",
      code: "BLOCKED",
    });
    expect(Object.keys(result.operationOutcomes)).toEqual(operationOutcomeKeys);
    expect(Object.values(result.operationOutcomes)).toEqual(
      operationOutcomeKeys.map(() => ({
        outcome: "inconclusive",
        code: "BLOCKED",
      })),
    );
  });

  it("exercises the future state flow only through the test seam", async () => {
    const fake = fakeRunner();
    const result = await runHarness(config, confirmation, fake.runner, future);
    expect(result).toMatchObject({
      overall: "passed",
      allowedMethods: ["GET", "POST"],
      staleConflict: "passed",
      cleanup: "passed",
      manualCleanup: { required: false },
      redaction: "passed",
    });
    expect(result.operationOutcomes).toMatchObject({
      list: { outcome: "passed", code: "OK" },
      create: { outcome: "passed", code: "OK" },
      update: { outcome: "passed", code: "OK" },
      stale_update: { outcome: "passed", code: "CONFLICT" },
      archive: { outcome: "passed", code: "OK" },
    });
    expect(fake.calls.filter((args) => args[2] === "create")).toHaveLength(1);
    expect(fake.calls.filter((args) => args[2] === "update")).toHaveLength(2);
    expect(fake.calls.filter((args) => args[2] === "archive")).toHaveLength(1);
  });

  it.each([
    ["create-unauthenticated", "failed", "UNAUTHENTICATED", "failed"],
    ["create-unsupported", "inconclusive", "UNSUPPORTED", "inconclusive"],
  ] as const)(
    "keeps auth and write-gate failures closed: %s",
    async (mode, outcome, code, overall) => {
      const fake = fakeRunner(mode);
      const result = await runHarness(
        config,
        confirmation,
        fake.runner,
        future,
      );
      expect(result.operationOutcomes.create).toEqual({ outcome, code });
      expect(result.overall).toBe(overall);
      expect(fake.calls.some((args) => args[2] === "update")).toBe(false);
    },
  );

  it("preserves an opaque run reference after uncertain create", async () => {
    const fake = fakeRunner("create-transport");
    const result = await runHarness(config, confirmation, fake.runner, future);
    expect(result.operationOutcomes.create).toEqual({
      outcome: "inconclusive",
      code: "TRANSPORT",
    });
    expect(result.cleanup).toBe("inconclusive");
    expect(result.manualCleanup).toEqual({
      required: true,
      runReference: runId,
      direction: "locate-exact-generated-run-file-and-archive-manually",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /file-1|revision-1|validation\//u,
    );
    expect(fake.calls.filter((args) => args[2] === "create")).toHaveLength(1);
  });

  it("does not archive an identity returned for the wrong create location", async () => {
    const fake = fakeRunner("create-mismatch");
    const result = await runHarness(config, confirmation, fake.runner, future);
    expect(result.operationOutcomes.create).toEqual({
      outcome: "failed",
      code: "MISMATCH",
    });
    expect(fake.calls.some((args) => args[2] === "archive")).toBe(false);
    expect(result.cleanup).toBe("inconclusive");
    expect(result.manualCleanup).toMatchObject({
      required: true,
      runReference: runId,
    });
  });

  it.each([
    ["stale-success", "stale_update", "MISMATCH", "failed"],
    ["readback-mismatch", "read", "MISMATCH", "failed"],
  ] as const)(
    "does not archive after stale/readback verification failure: %s",
    async (mode, field, code, overall) => {
      const fake = fakeRunner(mode);
      const result = await runHarness(
        config,
        confirmation,
        fake.runner,
        future,
      );
      expect(result.overall).toBe(overall);
      expect(result.operationOutcomes[field]).toMatchObject({ code });
      expect(fake.calls.filter((args) => args[2] === "archive")).toHaveLength(
        0,
      );
      expect(result.operationOutcomes.archive).toEqual({
        outcome: "inconclusive",
        code: "NOT_ATTEMPTED",
      });
      expect(result.manualCleanup).toMatchObject({
        required: true,
        runReference: runId,
      });
    },
  );

  it.each([
    ["update-transport", "update", "inconclusive", "TRANSPORT"],
    ["update-malformed", "update", "inconclusive", "PROTOCOL"],
    ["update-throw", "update", "failed", "FAILED"],
    ["update-readback-mismatch", "read_after_update", "failed", "MISMATCH"],
    ["stale-transport", "stale_update", "inconclusive", "TRANSPORT"],
    ["stale-malformed", "stale_update", "inconclusive", "PROTOCOL"],
    ["stale-throw", "stale_update", "failed", "FAILED"],
    ["stale-readback-mismatch", "read_after_conflict", "failed", "MISMATCH"],
  ] as const)(
    "never archives after an unsafe update or stale-update path: %s",
    async (mode, field, outcome, code) => {
      const fake = fakeRunner(mode);
      const result = await runHarness(
        config,
        confirmation,
        fake.runner,
        future,
      );
      expect(result.operationOutcomes[field]).toEqual({ outcome, code });
      expect(fake.calls.filter((args) => args[2] === "archive")).toHaveLength(
        0,
      );
      expect(result.operationOutcomes.archive).toEqual({
        outcome: "inconclusive",
        code: "NOT_ATTEMPTED",
      });
      expect(result.cleanup).toBe("inconclusive");
      expect(result.manualCleanup).toEqual({
        required: true,
        runReference: runId,
        direction: "locate-exact-generated-run-file-and-archive-manually",
      });
    },
  );

  it.each([
    ["archive-failure", "inconclusive", "UNSUPPORTED"],
    ["archive-unverified", "inconclusive", "ARCHIVE_UNVERIFIED"],
    ["archive-throw", "failed", "FAILED"],
  ] as const)(
    "requires verified archive identity and prioritizes cleanup: %s",
    async (mode, cleanup, code) => {
      const fake = fakeRunner(mode);
      const result = await runHarness(
        config,
        confirmation,
        fake.runner,
        future,
      );
      expect(result.cleanup).toBe(cleanup);
      expect(result.operationOutcomes.archive).toMatchObject({ code });
      expect(result.manualCleanup).toMatchObject({
        required: true,
        runReference: runId,
      });
      expect(result.overall).not.toBe("passed");
    },
  );

  it("rejects malformed CLI output and still avoids a mutation retry", async () => {
    const fake = fakeRunner("malformed");
    const result = await runHarness(config, confirmation, fake.runner, future);
    expect(result.overall).toBe("inconclusive");
    expect(fake.calls).toHaveLength(1);
    expect(result.operationOutcomes.list).toEqual({
      outcome: "inconclusive",
      code: "PROTOCOL",
    });
    for (const stage of operationOutcomeKeys.slice(1))
      expect(result.operationOutcomes[stage]).toEqual({
        outcome: "inconclusive",
        code: "NOT_ATTEMPTED",
      });
  });

  it("treats malformed create output as uncertain and preserves cleanup direction", async () => {
    const fake = fakeRunner("create-malformed");
    const result = await runHarness(config, confirmation, fake.runner, future);
    expect(result.overall).toBe("inconclusive");
    expect(result.operationOutcomes.create).toEqual({
      outcome: "inconclusive",
      code: "PROTOCOL",
    });
    expect(result.cleanup).toBe("inconclusive");
    expect(result.manualCleanup).toMatchObject({
      required: true,
      runReference: runId,
    });
    expect(fake.calls.filter((args) => args[2] === "create")).toHaveLength(1);
  });

  it("fails closed before process work for confirmation/configuration errors", async () => {
    let calls = 0;
    const fake: CommandRunner = {
      async run() {
        calls += 1;
        throw new Error("unexpected");
      },
    };
    await expect(runHarness(config, "wrong", fake)).rejects.toThrow(
      "confirmation",
    );
    await expect(
      runHarness({ ...config, cliExecutable: "shell" }, confirmation, fake),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("validates complete evidence and rejects forbidden recursive fields", async () => {
    const fake = fakeRunner();
    const result = await runHarness(config, confirmation, fake.runner, future);
    expect(assertSanitizedEvidence(result)).toEqual(result);
    expect(Object.keys(result.operationOutcomes)).toEqual(operationOutcomeKeys);
    expect(() =>
      assertSanitizedEvidence({ ...result, nested: { revision: "unsafe" } }),
    ).toThrow();
    const { archive: _archive, ...missingArchive } = result.operationOutcomes;
    expect(() =>
      assertSanitizedEvidence({
        ...result,
        operationOutcomes: missingArchive,
      }),
    ).toThrow();
    expect(() =>
      assertSanitizedEvidence({
        ...result,
        operationOutcomes: {
          ...result.operationOutcomes,
          execution: { outcome: "passed", code: "OK" },
        },
      }),
    ).toThrow();
    expect(() =>
      assertSanitizedEvidence({ ...result, completedAt: "not-a-time" }),
    ).toThrow();
  });
});

describe("Codex cloud harness output safety", () => {
  it("resolves physical config ancestry and rejects a symlink into the repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-cloud-path-"));
    const link = join(directory, "repo-link");
    const root = resolve(".");
    await symlink(root, link);
    try {
      await expect(
        externalRegularFile(join(link, "package.json"), root),
      ).rejects.toThrow("repository-path");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an output parent symlinked into the repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-cloud-output-"));
    const link = join(directory, "repo-link");
    const root = resolve(".");
    await symlink(root, link);
    try {
      await expect(
        publishExternalEvidence(join(link, "evidence.json"), root, "safe\n"),
      ).rejects.toThrow("repository-path");
      await expect(access(join(root, "evidence.json"))).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("publishes atomically with restrictive permissions and never overwrites", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-cloud-publish-"));
    const output = join(directory, "evidence.json");
    try {
      await publishExternalEvidence(output, resolve("."), "complete\n");
      expect(await readFile(output, "utf8")).toBe("complete\n");
      expect((await lstat(output)).mode & 0o777).toBe(0o600);
      await expect(
        publishExternalEvidence(output, resolve("."), "replace\n"),
      ).rejects.toThrow("output-exists");
      expect(await readFile(output, "utf8")).toBe("complete\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("leaves no empty destination when evidence generation fails", async () => {
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
});

function futureWithoutCapability() {
  return { uuid: () => runId, now: () => new Date(timestamp) };
}
