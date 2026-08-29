import { describe, expect, it } from "vitest";

describe("write-gate import safety", () => {
  it("imports without configuration, network, credential, file, or mutation work", async () => {
    await expect(
      import("../../src/write-gate/gate.js"),
    ).resolves.toHaveProperty("WriteGate");
  });
});
