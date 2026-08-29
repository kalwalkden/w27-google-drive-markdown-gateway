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

export type ConditionalWriteResult =
  | { readonly outcome: "success"; readonly node: DriveNode }
  | { readonly outcome: "conflict"; readonly current?: DriveNode }
  | { readonly outcome: "unsupported" };

export interface DrivePort {
  getNode(id: FileId | FolderId): Promise<DriveNode | undefined>;
  listChildren(folderId: FolderId): Promise<readonly DriveNode[]>;
  listDescendants(
    folderId: FolderId,
    options: Readonly<{ recursive: boolean; limit: number }>,
  ): Promise<readonly DriveNode[]>;
  searchDescendants(
    folderId: FolderId,
    query: string,
    limit: number,
  ): Promise<readonly DriveSearchHit[]>;
  readFile(fileId: FileId): Promise<DriveRead | undefined>;
  createFile(
    parentId: FolderId,
    name: string,
    content: string,
  ): Promise<DriveNode>;
  updateFile(
    fileId: FileId,
    expectedRevision: Revision,
    content: string,
  ): Promise<ConditionalWriteResult>;
  moveFile(
    fileId: FileId,
    expectedRevision: Revision,
    destinationFolderId: FolderId,
  ): Promise<ConditionalWriteResult>;
}
