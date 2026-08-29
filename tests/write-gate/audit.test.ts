import { describe, expect, it } from "vitest";

import { deniedAudit } from "../../src/write-gate/audit.js";

describe("write-gate audit data", () => {
  it("uses allowlisted reason codes without caller-controlled values", () => {
    const audit = deniedAudit("approval-digest-mismatch");
    expect(audit).toEqual({
      event: "write-gate-evaluated",
      decision: "denied",
      reason: "approval-digest-mismatch",
    });
    expect(JSON.stringify(audit)).not.toMatch(/token|path|content|sha256:/i);
  });
});
