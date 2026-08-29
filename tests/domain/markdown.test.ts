import { describe, expect, it } from "vitest";

import {
  MarkdownGatewayError,
  parseRelativePath,
  requireContentWithinLimit,
  requireMarkdownPath,
  utf8ByteSize,
} from "../../src/domain/markdown.js";

describe("Markdown domain validation", () => {
  it("canonicalizes separators and accepts case-insensitive Markdown names", () => {
    expect(parseRelativePath("drafts\\release.MD")).toEqual([
      "drafts",
      "release.MD",
    ]);
    expect(requireMarkdownPath("drafts/release.MD")).toEqual([
      "drafts",
      "release.MD",
    ]);
    expect(utf8ByteSize("é")).toBe(2);
  });

  it.each([
    "",
    "/file.md",
    "C:drive-relative.md",
    "C:\\absolute\\file.md",
    "a//file.md",
    "a/../file.md",
    "a/./file.md",
    "a/C:drive-qualified.md",
    "a/",
    "a/\u0000.md",
    "C:\\docs\\file.md",
    "\\\\server\\share\\file.md",
    "file.txt",
  ])("rejects unsafe or non-Markdown path %j", (path) => {
    expect(() => requireMarkdownPath(path)).toThrow(MarkdownGatewayError);
  });

  it("allows empty Markdown content and rejects only values beyond the byte boundary", () => {
    expect(() => requireContentWithinLimit("", 0)).not.toThrow();
    expect(() => requireContentWithinLimit("é", 2)).not.toThrow();
    expect(() => requireContentWithinLimit("é", 1)).toThrow(
      MarkdownGatewayError,
    );
    expect(() => requireContentWithinLimit(12 as unknown as string, 1)).toThrow(
      MarkdownGatewayError,
    );
  });

  it.each(["\ud800", "\udc00", "before\ud800after"])(
    "rejects unpaired UTF-16 surrogates before size measurement",
    (content) => {
      expect(() => utf8ByteSize(content)).toThrow(MarkdownGatewayError);
      expect(() => requireContentWithinLimit(content, 1_000)).toThrow(
        MarkdownGatewayError,
      );
    },
  );
});
