import { describe, expect, it } from "vitest";
import { createApp } from "../src/index.js";

describe("application foundation", () => {
  it("constructs a fresh Express application without external configuration", () => {
    const app = createApp();

    expect(typeof app).toBe("function");
    expect(app).not.toBe(createApp());
  });
});
