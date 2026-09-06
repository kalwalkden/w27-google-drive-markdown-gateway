import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertSanitizedEvidence,
  opaqueReference,
  parseLiveDriveEvidence,
  writeEvidenceExclusively,
} from "../../src/live-drive/evidence.js";

const example = {
  schemaVersion: 2 as const,
  probeVersion: "2" as const,
  runId: "00000000-0000-4000-8000-000000000000",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:01.000Z",
  authMode: "shared-drive-adc" as const,
  topology: "shared-drive" as const,
  outcome: "INCONCLUSIVE" as const,
  checks: [],
  cleanup: { status: "NOT_CREATED" as const, reason: "not-created" as const },
  redaction: {
    rawIdentifiersStored: false as const,
    contentStored: false as const,
    credentialsStored: false as const,
  },
};

describe("evidence redaction", () => {
  it("rejects forbidden keys and stores only one-way identifiers", async () => {
    expect(
      opaqueReference(new Uint8Array(32).fill(1), "real-file-id"),
    ).not.toContain("real-file-id");
    expect(() =>
      assertSanitizedEvidence({ ...example, accessToken: "never" }),
    ).toThrow();
    expect(() =>
      assertSanitizedEvidence({ ...example, unexpected: "never" }),
    ).toThrow();
    expect(() =>
      assertSanitizedEvidence({
        ...example,
        schemaVersion: 1,
        probeVersion: "1",
      }),
    ).toThrow();
    expect(() =>
      parseLiveDriveEvidence({
        ...example,
        checks: [
          {
            id: "probe-exception",
            actor: "system",
            endpoint: "metadata",
            method: "GET",
            ifMatchSent: false,
            supportsAllDrivesSent: true,
            expected: "not-allowlisted",
            passed: false,
            reason: "transport-or-auth-failure",
          },
        ],
      }),
    ).toThrow();
    const directory = await mkdtemp(join(tmpdir(), "w27-evidence-"));
    const output = join(directory, "result.json");
    await writeEvidenceExclusively(output, example);
    await expect(readFile(output, "utf8")).resolves.toContain(
      '"outcome": "INCONCLUSIVE"',
    );
    await expect(writeEvidenceExclusively(output, example)).rejects.toThrow();
  });
});
