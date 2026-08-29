export type FileId = string & { readonly __brand: "FileId" };
export type FolderId = string & { readonly __brand: "FolderId" };
export type Revision = string & { readonly __brand: "Revision" };

export const fileId = (value: string): FileId => value as FileId;
export const folderId = (value: string): FolderId => value as FolderId;
export const revision = (value: string): Revision => value as Revision;

export type ErrorCode =
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "AMBIGUOUS_PATH"
  | "OUTSIDE_ROOT"
  | "NOT_MARKDOWN"
  | "INVALID_CONTENT"
  | "FILE_TOO_LARGE"
  | "CONFLICT"
  | "INVALID_ARCHIVE"
  | "UNSUPPORTED";

export class MarkdownGatewayError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly context: Readonly<Record<string, string | number | boolean>> = {},
  ) {
    super(message);
    this.name = "MarkdownGatewayError";
  }
}

export interface MarkdownFileMetadata {
  readonly relativePath: string;
  readonly fileId: FileId;
  readonly revision: Revision;
  readonly modifiedTime: string;
  readonly size: number;
}

export interface MarkdownDocument extends MarkdownFileMetadata {
  readonly content: string;
}

export interface FileLocatorByPath {
  readonly path: string;
  readonly fileId?: never;
}

export interface FileLocatorById {
  readonly fileId: FileId;
  readonly path?: never;
}

export type FileLocator = FileLocatorByPath | FileLocatorById;

export interface ListMarkdownInput {
  readonly path?: string;
  readonly recursive?: boolean;
}

export type ListMarkdownResult = readonly MarkdownFileMetadata[];

export interface SearchMarkdownInput {
  readonly query: string;
  readonly path?: string;
  readonly limit?: number;
}

export interface SearchMarkdownResult extends MarkdownFileMetadata {
  readonly excerpt?: string;
}

export type SearchMarkdownResults = readonly SearchMarkdownResult[];

export type ReadMarkdownInput = FileLocator;
export type ReadMarkdownResult = MarkdownDocument;

export interface CreateMarkdownInput {
  readonly path: string;
  readonly content: string;
}

export type CreateMarkdownResult = MarkdownFileMetadata;

export type UpdateMarkdownInput = FileLocator & {
  readonly expectedRevision: Revision;
  readonly content: string;
};

export type UpdateMarkdownResult = MarkdownFileMetadata;

export type ArchiveMarkdownInput = FileLocator & {
  readonly expectedRevision: Revision;
};

export type ArchiveMarkdownResult = MarkdownFileMetadata;

export function isMarkdownName(name: string): boolean {
  return name.toLowerCase().endsWith(".md") && name.length > 3;
}

export function utf8ByteSize(content: string): number {
  assertWellFormedUtf16(content);
  return new TextEncoder().encode(content).byteLength;
}

/** JavaScript strings may contain lone UTF-16 surrogates, which are not valid text. */
export function assertWellFormedUtf16(value: string): void {
  if (typeof value !== "string") {
    throw new MarkdownGatewayError(
      "INVALID_CONTENT",
      "Markdown content must be UTF-8 text.",
    );
  }
  if (!isWellFormedUtf16(value)) {
    throw new MarkdownGatewayError(
      "INVALID_CONTENT",
      "Markdown content contains an unpaired UTF-16 surrogate.",
    );
  }
}

/** Converts a caller path to a canonical Drive-name segment sequence. */
export function parseRelativePath(path: string): readonly string[] {
  if (
    typeof path !== "string" ||
    !isWellFormedUtf16(path) ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[a-zA-Z]:/u.test(path) ||
    [...path].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    throw new MarkdownGatewayError(
      "INVALID_PATH",
      "Path must be a non-empty relative path.",
    );
  }

  const normalized = path.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized.includes("//")
  ) {
    throw new MarkdownGatewayError(
      "INVALID_PATH",
      "Path contains an empty segment.",
    );
  }

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "." || segment === ".." || /^[a-zA-Z]:/u.test(segment),
    )
  ) {
    throw new MarkdownGatewayError(
      "INVALID_PATH",
      "Path contains an unsafe segment.",
    );
  }
  return segments;
}

/** True only for strings that can be represented as well-formed Unicode text. */
export function isWellFormedUtf16(value: unknown): value is string {
  if (typeof value !== "string") return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (!(following >= 0xdc00 && following <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function canonicalRelativePath(segments: readonly string[]): string {
  return segments.join("/");
}

export function requireMarkdownPath(path: string): readonly string[] {
  const segments = parseRelativePath(path);
  const leaf = segments.at(-1);
  if (!leaf || !isMarkdownName(leaf)) {
    throw new MarkdownGatewayError(
      "NOT_MARKDOWN",
      "Only Markdown files are supported.",
    );
  }
  return segments;
}

export function requireContentWithinLimit(
  content: string,
  maxBytes: number,
): void {
  assertWellFormedUtf16(content);
  const size = utf8ByteSize(content);
  if (size > maxBytes) {
    throw new MarkdownGatewayError(
      "FILE_TOO_LARGE",
      "Markdown content exceeds the configured limit.",
      {
        maxBytes,
        size,
      },
    );
  }
}
