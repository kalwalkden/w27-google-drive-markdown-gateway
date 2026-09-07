import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("mise toolchain", () => {
  it("is the single version and task authority", async () => {
    const [configuration, packageManifest, lockfile, pnpmConfiguration] =
      await Promise.all([
        readFile("mise.toml", "utf8"),
        readFile("package.json", "utf8"),
        readFile("mise.lock", "utf8"),
        readFile("pnpm-workspace.yaml", "utf8"),
      ]);
    const packageJson = JSON.parse(packageManifest) as Record<string, unknown>;

    expect(configuration).toContain('min_version = "2026.9.1"');
    expect(configuration).toContain('node = "24"');
    expect(configuration).toContain('"npm:pnpm" = "11.19.0"');
    expect(configuration).toContain("[tool_config]\nlocked = true");
    expect(packageJson).not.toHaveProperty("packageManager");
    expect(packageJson).not.toHaveProperty("scripts");
    expect(lockfile).toContain('version = "24.');
    expect(lockfile).toContain('version = "11.19.0"');
    expect(pnpmConfiguration).toContain("storeDir: .pnpm-store");
  });

  it("resolves the mise-managed pnpm launcher on Node 24", async () => {
    const [{ stdout: nodeVersion }, { stdout: pnpmPath }] = await Promise.all([
      execFileAsync("node", ["--version"]),
      execFileAsync("mise", ["which", "pnpm"]),
    ]);

    expect(nodeVersion.trim()).toMatch(/^v24\./u);
    expect(pnpmPath).toContain("npm-pnpm/11.19.0");
  });

  it("publishes the required task surface without running tasks", async () => {
    const { stdout } = await execFileAsync("mise", ["tasks", "ls", "--json"], {
      env: { ...process.env, MISE_TASK_RUN_AUTO_INSTALL: "false" },
    });
    const tasks = JSON.parse(stdout) as ReadonlyArray<{
      readonly name: string;
      readonly run: ReadonlyArray<string | { readonly task: string }>;
    }>;
    const names = tasks.map(({ name }) => name);

    expect(names).toEqual(
      expect.arrayContaining([
        "build",
        "check",
        "codex-cloud:harness",
        "drive:probe",
        "format",
        "format:check",
        "install",
        "lint",
        "migration:cutover-preflight",
        "migration:plan",
        "test",
        "typecheck",
        "verify:vendored-skills",
      ]),
    );
    expect(tasks.find(({ name }) => name === "check")?.run).toEqual([
      { task: "lint" },
      { task: "format:check" },
      { task: "typecheck" },
      { task: "test" },
      { task: "build" },
      { task: "verify:vendored-skills" },
    ]);
  });
});
