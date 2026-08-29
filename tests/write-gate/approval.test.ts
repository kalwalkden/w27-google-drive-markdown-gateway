import { describe, expect, it } from "vitest";

import { parseWriteApproval } from "../../src/write-gate/approval.js";
import { evidenceBytes, validApproval, validEvidence } from "./fixtures.js";

describe("write approval parser", () => {
  it("accepts its closed payload shape", () => {
    const bytes = evidenceBytes(validEvidence());
    expect(parseWriteApproval(validApproval(bytes)).approvalId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("rejects unknown fields, bad fingerprints, and non-UTC timestamps", () => {
    const approval = validApproval(evidenceBytes(validEvidence()));
    expect(() => parseWriteApproval({ ...approval, extra: true })).toThrow();
    expect(() =>
      parseWriteApproval({ ...approval, evidenceSha256: "sha256:bad" }),
    ).toThrow();
    expect(() =>
      parseWriteApproval({
        ...approval,
        issuedAt: "2026-01-01T00:02:00.000+01:00",
      }),
    ).toThrow();
  });
});
