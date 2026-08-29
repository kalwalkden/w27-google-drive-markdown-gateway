import { chmod, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findRepositoryRoot,
  liveConfirmation,
  loadOAuthSecret,
  parseLiveDriveProbeArgs,
  parseLiveDriveProbeConfig,
} from "../../src/live-drive/config.js";

const valid = {
  schemaVersion: 1,
  authMode: "shared-drive-adc",
  testRootFolderId: "root",
  archiveFolderId: "archive",
  requestTimeoutMs: 30_000,
};

describe("live probe configuration", () => {
  it("accepts only a closed, explicit confirmation contract", () => {
    expect(parseLiveDriveProbeConfig(valid)).toEqual(valid);
    expect(() =>
      parseLiveDriveProbeConfig({ ...valid, unexpected: true }),
    ).toThrow();
    expect(() =>
      parseLiveDriveProbeConfig({ ...valid, archiveFolderId: "root" }),
    ).toThrow();
    expect(() =>
      parseLiveDriveProbeArgs([
        "run",
        "--config",
        "a",
        "--output",
        "b",
        "--confirm",
        "no",
      ]),
    ).toThrow();
    expect(
      parseLiveDriveProbeArgs([
        "run",
        "--config",
        "a",
        "--output",
        "b",
        "--confirm",
        liveConfirmation,
      ]),
    ).toEqual({ configPath: "a", outputPath: "b" });
  });

  it("only loads a protected regular OAuth secret outside the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "w27-drive-root-"));
    const outside = await mkdtemp(join(tmpdir(), "w27-drive-secret-"));
    const secret = join(outside, "oauth.json");
    await writeFile(
      secret,
      '{"clientId":"id","clientSecret":"secret","refreshToken":"token"}',
    );
    await chmod(secret, 0o600);
    await expect(loadOAuthSecret(secret, root)).resolves.toEqual({
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "token",
    });
    const linked = join(outside, "linked.json");
    await symlink(secret, linked);
    await expect(loadOAuthSecret(linked, root)).rejects.toThrow();
    await expect(
      loadOAuthSecret(join(root, "oauth.json"), root),
    ).rejects.toThrow();
  });

  it("finds the project root from a nested invocation directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "w27-drive-project-"));
    const nested = join(root, "nested", "deeper");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(nested, { recursive: true }),
    );
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, "AGENTS.md"), "# test\n");
    await expect(findRepositoryRoot(nested)).resolves.toBe(root);
  });
});
