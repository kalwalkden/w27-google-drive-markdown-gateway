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

export interface DriveSearchHit {
  readonly node: DriveNode;
  readonly excerpt?: string;
}

/** A hard upper bound for a single child enumeration. */
export interface DriveListOptions {
  readonly limit: number;
}

/** Facts used by MarkdownService to resolve and verify documents. */
export interface DriveReadPort {
  getNode(id: FileId | FolderId): Promise<DriveNode | undefined>;
  /**
   * Returns no more than `options.limit` children when a bound is supplied.
   * Providers must stop enumeration and metadata verification at that bound.
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
  | { readonly outcome: "unsupported" };

export type CreateWriteResult =
  | { readonly outcome: "success"; readonly node: DriveNode }
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
