import { describe, expect, it } from "vitest";

describe("configuration and authentication import safety", () => {
  it("imports without configuration, credential, network, file, Drive, or verification work", async () => {
    await expect(
      import("../../src/config/service-config.js"),
    ).resolves.toHaveProperty("parseServiceConfig");
    await expect(import("../../src/auth/principal.js")).resolves.toHaveProperty(
      "AuthenticationError",
    );
    await expect(
      import("../../src/auth/principal-verifier.js"),
    ).resolves.toHaveProperty("createPrincipalVerifier");
  });
});
