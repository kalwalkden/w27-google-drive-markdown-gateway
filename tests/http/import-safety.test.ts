import { describe, expect, it, vi } from "vitest";

describe("HTTP import safety", () => {
  it("does not load Google authentication while importing HTTP composition", async () => {
    vi.resetModules();
    vi.doMock("../../src/drive/google-drive-auth.js", () => {
      throw new Error("HTTP composition must not load Google authentication");
    });
    await expect(import("../../src/http/json-api.js")).resolves.toHaveProperty(
      "createJsonApiApp",
    );
    vi.doUnmock("../../src/drive/google-drive-auth.js");
  });
});
