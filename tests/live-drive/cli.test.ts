import { describe, expect, it } from "vitest";

import { exitCode, main } from "../../src/live-drive/cli.js";
import { liveConfirmation } from "../../src/live-drive/config.js";

describe("live probe CLI", () => {
  it("is import-safe and rejects invalid or repository-local output before authentication", async () => {
    await expect(main(["not-run"])).resolves.toBe(13);
    await expect(
      main([
        "run",
        "--config",
        "does-not-need-to-exist.json",
        "--output",
        `${process.cwd()}/result.json`,
        "--confirm",
        liveConfirmation,
      ]),
    ).resolves.toBe(13);
  });

  it("gives cleanup failure precedence over a successful capability result", () => {
    expect(exitCode("SUPPORTED", "FAILED")).toBe(14);
    expect(exitCode("SUPPORTED", "ARCHIVED")).toBe(0);
    expect(exitCode("UNSUPPORTED", "ARCHIVED")).toBe(11);
  });
});
