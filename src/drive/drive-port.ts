import type { FileId, FolderId, Revision } from "../domain/markdown.js";

export type DriveNodeKind = "folder" | "file" | "shortcut";

export interface DriveNode {
  readonly id: FileId | FolderId;
  readonly name: string;
  readonly kind: DriveNodeKind;
  readonly parentIds: readonly FolderId[];
  readonly modifiedTime: string;
  readonly revision?: Revision;
  readonly size?: number;
  readonly mimeType?: string;
}

export interface DriveRead {
  readonly node: DriveNode;
  readonly content: string;
}

/** One bounded, non-reusable provider read scope. */
export interface DriveReadSession {
  getNode(id: FileId | FolderId): Promise<DriveNode | undefined>;
  listChildren(folderId: FolderId): Promise<readonly DriveNode[]>;
  readFile(fileId: FileId): Promise<DriveRead | undefined>;
}

export interface DriveSearchHit {
  readonly node: DriveNode;
  readonly excerpt?: string;
}

/** A bounded list found the caller-requested extra child without exposing it. */
export class DriveListOverflowError extends Error {
  constructor() {
    super("Drive child list reached its overflow sentinel.");
    this.name = "DriveListOverflowError";
  }
}

/** A request-local provider-work budget was exhausted before a complete result. */
export class DriveReadLimitError extends Error {
  constructor() {
    super("Drive read session reached a configured limit.");
    this.name = "DriveReadLimitError";
  }
}

/** A hard bound for a single child enumeration. */
export interface DriveListOptions {
  readonly limit: number;
  /**
   * Requests a completion signal at the first raw child that reaches `limit`.
   * The provider must throw DriveListOverflowError without parsing, fetching,
   * or returning that child.
   */
  readonly overflowSignal?: boolean;
}

/** Facts used by MarkdownService to resolve and verify documents. */
export interface DriveReadPort {
  /** Opens a fresh root-validated scope when the adapter supports shared bounds. */
  openReadSession?(): Promise<DriveReadSession>;
  getNode(id: FileId | FolderId): Promise<DriveNode | undefined>;
  /**
   * Providers fail closed if the bound would omit a child. With overflowSignal
   * they throw before the final raw child is consumed.
   */
  listChildren(
    folderId: FolderId,
    options?: DriveListOptions,
  ): Promise<readonly DriveNode[]>;
  listDescendants(
    folderId: FolderId,
    options: Readonly<{ recursive: boolean; limit: number }>,
  ): Promise<readonly DriveNode[]>;
  /**
   * Bounded search over direct children only. Implementations must not inspect
   * nested content before returning a hit, because ancestor topology cannot be
   * bound to a later content read.
   */
  searchDirectChildren(
    folderId: FolderId,
    query: string,
    limit: number,
  ): Promise<readonly DriveSearchHit[]>;
  /** @deprecated Diagnostics-only compatibility method; it must retain direct-child semantics. */
  searchDescendants(
    folderId: FolderId,
    query: string,
    limit: number,
  ): Promise<readonly DriveSearchHit[]>;
  readFile(fileId: FileId): Promise<DriveRead | undefined>;
}

export type ConditionalWriteResult =
  | { readonly outcome: "success"; readonly node: DriveNode }
  | { readonly outcome: "conflict"; readonly current?: DriveNode }
  /** The request may have reached Drive, but its final state cannot be proved. */
  | { readonly outcome: "unknown" }
  | { readonly outcome: "unsupported" };

export type CreateWriteResult =
  | { readonly outcome: "success"; readonly node: DriveNode }
  /** The request may have reached Drive, but its final state cannot be proved. */
  | { readonly outcome: "unknown" }
  | { readonly outcome: "unsupported" };

/** Provider-facing operations that accept only verified IDs and opaque revisions. */
export interface RawDriveWritePort {
  createFile(
    parentId: FolderId,
    name: string,
    content: string,
  ): Promise<CreateWriteResult>;
  updateFile(
    fileId: FileId,
    expectedRevision: Revision,
    content: string,
  ): Promise<ConditionalWriteResult>;
  moveFile(
    fileId: FileId,
    expectedRevision: Revision,
    sourceFolderId: FolderId,
    destinationFolderId: FolderId,
  ): Promise<ConditionalWriteResult>;
}

/** Compatibility name for code that only needs document reads. */
export type DrivePort = DriveReadPort;
