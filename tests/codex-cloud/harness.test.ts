import { describe, expect, it } from "vitest";

import {
  assertSanitizedEvidence,
  type CommandRunner,
  confirmation,
  runHarness,
} from "../../src/codex-cloud/harness.js";

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
  return {
    async run(args) {
      const command = args[0];
      if (command === "update" && ++updates === 2)
        return {
          exitCode: 8,
          stdout: JSON.stringify({
            ok: false,
            operation: "update_markdown",
            status: 409,
            error: { code: "CONFLICT" },
          }),
        };
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ok: true,
          operation: `${command}_markdown`,
          status: command === "create" ? 201 : 200,
        }),
      };
    },
  };
}

describe("Codex cloud harness", () => {
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
