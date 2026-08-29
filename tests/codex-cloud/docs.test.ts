import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Codex cloud client guidance", () => {
  it("keeps setup narrow, default-off, nested, and secret-free", async () => {
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
    expect(setup).toContain("write.enabled");
    expect(setup).toContain("MD_DRIVE_BEARER_TOKEN");
    expect(setup).toContain("MD_DRIVE_BEARER_SECRET_FILE");
    expect(setup).toMatch(/`GET`[\s\S]*`POST`/u);
    expect(setup).toContain("Do not allow `PATCH`");
    expect(setup).toMatch(/broad\s+Internet access/u);
    expect(skill).toContain("md-drive");
    expect(skill).toContain("Never silently retry or overwrite");
    expect(`${setup}\n${skill}`).toContain("OUTCOME_UNKNOWN");
    expect(`${setup}\n${skill}`).toContain("nested");
    expect(`${setup}\n${skill}`).not.toMatch(
      /Bearer [A-Za-z0-9._-]{16,}|refresh_token[=:][^\s]+|BEGIN (?:RSA |EC )?PRIVATE KEY/iu,
    );
  });

  it("keeps client release records digest-bound, default-off, and sanitized", async () => {
    const [record, deployment, threat, observability, probe] =
      await Promise.all([
        readFile(
          new URL(
            "../../docs/client-validation-record.example.json",
            import.meta.url,
          ),
          "utf8",
        ),
        readFile(
          new URL("../../docs/cloud-run-deployment.md", import.meta.url),
          "utf8",
        ),
        readFile(
          new URL("../../docs/threat-model.md", import.meta.url),
          "utf8",
        ),
        readFile(
          new URL("../../docs/observability-contract.md", import.meta.url),
          "utf8",
        ),
        readFile(
          new URL(
            "../../docs/live-drive-capability-harness.md",
            import.meta.url,
          ),
          "utf8",
        ),
      ]);
    const parsed = JSON.parse(record);
    expect(parsed).toMatchObject({
      gatewayImageDigest: `sha256:${"0".repeat(64)}`,
      runtimeConfigDigest: `sha256:${"1".repeat(64)}`,
      liveCapabilityEvidenceDigest: `sha256:${"2".repeat(64)}`,
      deploymentWriteMode: { expected: "default-off", observed: "not-run" },
      releaseEvidenceRuntimeAuthority: false,
    });
    expect(record).not.toMatch(/https?:|writeWithoutLease|\bPATCH\b/iu);
    expect(deployment).toContain("enable_write=true");
    expect(deployment).toContain("acknowledge_write_risk=true");
    expect(`${threat}\n${observability}`).toContain("outcome_unknown");
    expect(threat).toContain("OUTCOME_UNKNOWN");
    expect(probe).toContain(
      "pre-provisions a distinct nested validation folder",
    );
  });
});
