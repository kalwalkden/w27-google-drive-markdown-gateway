import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Codex cloud client guidance", () => {
  it("keeps setup narrow, blocked until operator verification, and secret-free", async () => {
    const [setup, skill] = await Promise.all([
      readFile(
        new URL("../../docs/codex-cloud-client-setup.md", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../../.agents/skills/codex-cloud-markdown-gateway/SKILL.md",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
    expect(setup).toContain("**BLOCKED**");
    expect(setup).toContain("MD_DRIVE_BEARER_TOKEN");
    expect(setup).toContain("MD_DRIVE_BEARER_SECRET_FILE");
    expect(setup).toMatch(/`GET`[\s\S]*`POST`/u);
    expect(setup).toContain("Do not allow `PATCH`");
    expect(setup).toMatch(/broad\s+Internet access/u);
    expect(skill).toContain("md-drive");
    expect(skill).toContain("Never silently retry or overwrite");
    expect(`${setup}\n${skill}`).not.toMatch(
      /Bearer [A-Za-z0-9._-]{16,}|refresh_token[=:][^\s]+|BEGIN (?:RSA |EC )?PRIVATE KEY/iu,
    );
  });
});
