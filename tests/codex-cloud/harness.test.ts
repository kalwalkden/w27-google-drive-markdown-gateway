import { describe, expect, it } from "vitest";

import {
  assertSanitizedEvidence,
  type CommandRunner,
  confirmation,
  runHarness,
} from "../../src/codex-cloud/harness.js";
import {
  isOutsideRepository,
  parseHarnessArgs,
} from "../../src/codex-cloud/harness-cli.js";

const config = {
  cliExecutable: "md-drive",
  validationFolder: "validation",
  archiveFolder: "archive",
  releaseDigest: `sha256:${"0".repeat(64)}`,
  environmentIdentifier: "example-environment",
  gatewayHostnameIdentifier: "example-gateway",
  timeoutMs: 1_000,
};

function runner(): CommandRunner {
  let updates = 0;
  let revision = "revision-1";
  let runId = "test";
  const metadata = () => ({
    relativePath: "validation/w27-codex-cloud-validation-test.md",
    fileId: "file-1",
    revision,
    modifiedTime: "2026-01-01T00:00:00.000Z",
    size: 1,
  });
  return {
    async run(args) {
      const command = args[2] ?? "";
      if (command === "create")
        runId = (args[args.indexOf("create") + 1] ?? "").replace(
          /^validation\/w27-codex-cloud-validation-([0-9a-f-]+)\.md$/u,
          "$1",
        );
      if (command === "update" && ++updates === 2)
        return {
          exitCode: 8,
          stdout: JSON.stringify({
            ok: false,
            operation: "update_markdown",
            status: 409,
            operationId: "operation",
            error: { code: "CONFLICT", message: "Markdown revision conflict." },
          }),
        };
      if (command === "update") revision = "revision-2";
      const data =
        command === "list" || command === "search"
          ? { items: [] }
          : command === "read"
            ? {
                ...metadata(),
                content:
                  revision === "revision-1"
                    ? `w27 validation ${runId}\n`
                    : `w27 validation updated ${runId}\n`,
              }
            : metadata();
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
  };
}

describe("Codex cloud harness", () => {
  it("requires external config and output grammar", () => {
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
  it("uses a closed fake CLI state flow and allows only GET and POST evidence", async () => {
    const result = await runHarness(config, confirmation, runner());
    expect(result).toMatchObject({
      allowedMethods: ["GET", "POST"],
      staleConflict: "passed",
      cleanup: "passed",
      redaction: "passed",
    });
    expect(result.operationOutcomes).toMatchObject({
      list: "passed",
      create: "passed",
      update: "passed",
      stale_update: "passed",
    });
  });

  it("fails closed before fake process work for confirmation/configuration errors", async () => {
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

  it("rejects evidence that contains a forbidden recursive field", () => {
    expect(() =>
      assertSanitizedEvidence({ ...config, nested: { revision: "unsafe" } }),
    ).toThrow("redaction");
  });
});
