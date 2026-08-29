import {
  canonicalRelativePath,
  type ArchiveMarkdownInput,
  type ArchiveMarkdownResult,
  type CreateMarkdownInput,
  type CreateMarkdownResult,
  type FileId,
  type FileLocator,
  type FolderId,
  isMarkdownName,
  MarkdownGatewayError,
  type MarkdownFileMetadata,
  type ListMarkdownInput,
  type ListMarkdownResult,
  parseRelativePath,
  requireContentWithinLimit,
  requireMarkdownPath,
  type Revision,
  type SearchMarkdownInput,
  type SearchMarkdownResults,
  type ReadMarkdownInput,
  type ReadMarkdownResult,
  type UpdateMarkdownInput,
  type UpdateMarkdownResult,
  utf8ByteSize,
} from "../domain/markdown.js";
import type {
  ConditionalWriteResult,
  CreateWriteResult,
  DriveNode,
  DriveReadPort,
} from "../drive/drive-port.js";
import {
  DisabledDriveWritePort,
  guardedCreateFile,
  guardedUpdateFile,
  isGuardedDriveWriter,
  type GuardedDriveWriter,
} from "../drive/guarded-drive-write-port.js";
import type { WriteLease } from "../write-gate/gate.js";

const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const ABSOLUTE_MAX_SEARCH_LIMIT = 1_000;

export interface MarkdownServiceConfig {
  readonly rootFolderId: FolderId;
  readonly archiveFolderId: FolderId;
  readonly maxMarkdownBytes?: number;
  readonly defaultRecursive?: boolean;
  readonly defaultSearchLimit?: number;
  readonly maxSearchLimit?: number;
}

interface ResolvedNode {
  readonly node: DriveNode;
  readonly segments: readonly string[];
}

export interface MarkdownWriteSession {
  createMarkdown(input: CreateMarkdownInput): Promise<CreateMarkdownResult>;
  updateMarkdown(input: UpdateMarkdownInput): Promise<UpdateMarkdownResult>;
  archiveMarkdown(input: ArchiveMarkdownInput): Promise<ArchiveMarkdownResult>;
}

export class MarkdownService {
  private readonly maxMarkdownBytes: number;
  private readonly defaultRecursive: boolean;
  private readonly defaultSearchLimit: number;
  private readonly maxSearchLimit: number;

  constructor(
    private readonly port: DriveReadPort,
    private readonly config: MarkdownServiceConfig,
    private readonly writer: GuardedDriveWriter = new DisabledDriveWritePort(),
  ) {
    if (!isGuardedDriveWriter(writer)) {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "MarkdownService requires a guarded write capability.",
      );
    }
    if (
      !config.rootFolderId ||
      !config.archiveFolderId ||
      config.rootFolderId === config.archiveFolderId
    ) {
      throw new MarkdownGatewayError(
        "INVALID_ARCHIVE",
        "Archive folder must be a descendant of the root.",
      );
    }
    this.maxMarkdownBytes = config.maxMarkdownBytes ?? DEFAULT_MAX_BYTES;
    this.defaultRecursive = config.defaultRecursive ?? false;
    this.defaultSearchLimit = config.defaultSearchLimit ?? DEFAULT_SEARCH_LIMIT;
    this.maxSearchLimit = config.maxSearchLimit ?? MAX_SEARCH_LIMIT;
    if (
      !Number.isSafeInteger(this.maxMarkdownBytes) ||
      this.maxMarkdownBytes < 0 ||
      !Number.isSafeInteger(this.defaultSearchLimit) ||
      !Number.isSafeInteger(this.maxSearchLimit) ||
      this.defaultSearchLimit < 1 ||
      this.maxSearchLimit < this.defaultSearchLimit ||
      this.maxSearchLimit > ABSOLUTE_MAX_SEARCH_LIMIT ||
      typeof this.defaultRecursive !== "boolean"
    ) {
      throw new MarkdownGatewayError(
        "INVALID_CONTENT",
        "Service limits must be valid positive integers.",
      );
    }
  }

  openWriteSession(lease: WriteLease): MarkdownWriteSession {
    return Object.freeze({
      createMarkdown: (input: CreateMarkdownInput) =>
        this.createMarkdown(input, lease),
      updateMarkdown: (input: UpdateMarkdownInput) =>
        this.updateMarkdown(input, lease),
      archiveMarkdown: (input: ArchiveMarkdownInput) =>
        this.archiveMarkdown(input, lease),
    });
  }

  async listMarkdown(
    input: ListMarkdownInput = {},
  ): Promise<ListMarkdownResult> {
    const recursive = input.recursive ?? this.defaultRecursive;
    if (typeof recursive !== "boolean") {
      throw new MarkdownGatewayError(
        "INVALID_CONTENT",
        "Recursive listing must be a boolean.",
      );
    }
    this.requireDirectRootRead(input.path, recursive);
    const candidates = await this.port.listChildren(this.config.rootFolderId);
    const result: MarkdownFileMetadata[] = [];
    const paths = new Set<string>();
    for (const candidate of candidates) {
      const metadata = await this.safeMetadata(candidate);
      if (metadata && this.isDirectlyBelow(metadata.relativePath, [])) {
        this.assertUniquePath(paths, metadata.relativePath);
        result.push(metadata);
      }
    }
    return result;
  }

  async searchMarkdown(
    input: SearchMarkdownInput,
  ): Promise<SearchMarkdownResults> {
    if (typeof input.query !== "string" || input.query.trim().length === 0) {
      throw new MarkdownGatewayError(
        "INVALID_CONTENT",
        "Search query must not be empty.",
      );
    }
    const limit = input.limit ?? this.defaultSearchLimit;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > this.maxSearchLimit
    ) {
      throw new MarkdownGatewayError(
        "INVALID_CONTENT",
        "Search limit is outside the configured bound.",
      );
    }
    this.requireDirectRootRead(input.path, false);
    const hits = await this.port.searchDirectChildren(
      this.config.rootFolderId,
      input.query,
      limit,
    );
    const result: SearchMarkdownResults[number][] = [];
    const paths = new Set<string>();
    for (const hit of hits) {
      const metadata = await this.safeMetadata(hit.node);
      if (metadata && this.isDirectlyBelow(metadata.relativePath, [])) {
        this.assertUniquePath(paths, metadata.relativePath);
        result.push({
          ...metadata,
          ...(hit.excerpt === undefined ? {} : { excerpt: hit.excerpt }),
        });
      }
    }
    return result.slice(0, limit);
  }

  async readMarkdown(locator: ReadMarkdownInput): Promise<ReadMarkdownResult> {
    if ("path" in locator && locator.path !== undefined) {
      const segments = requireMarkdownPath(locator.path);
      if (segments.length !== 1) this.throwNestedReadUnavailable();
    }
    const resolved = await this.resolveFile(locator);
    this.assertDirectRootFile(resolved);
    const read = await this.port.readFile(resolved.node.id as FileId);
    if (!read)
      throw new MarkdownGatewayError(
        "NOT_FOUND",
        "Markdown file was not found.",
      );
    const current = await this.resolveVerifiedNode(
      resolved.node.id as FileId,
      "file",
    );
    this.assertDirectRootFile(current);
    if (
      !this.sameNodeFacts(read.node, resolved.node) ||
      !this.sameNodeFacts(read.node, current.node)
    ) {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Drive port returned a different file than requested.",
      );
    }
    this.assertRegularMarkdown(read.node);
    requireContentWithinLimit(read.content, this.maxMarkdownBytes);
    if (utf8ByteSize(read.content) !== read.node.size) {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Drive port content size does not match file metadata.",
      );
    }
    return {
      ...this.toMetadata(read.node, current.segments),
      content: read.content,
    };
  }

  private async createMarkdown(
    input: CreateMarkdownInput,
    lease: WriteLease,
  ): Promise<CreateMarkdownResult> {
    const segments = requireMarkdownPath(input.path);
    requireContentWithinLimit(input.content, this.maxMarkdownBytes);
    const leaf = segments.at(-1);
    if (!leaf)
      throw new MarkdownGatewayError("INVALID_PATH", "Path must name a file.");
    const parent = await this.resolveSegments(segments.slice(0, -1), true);
    this.assertCreateTopology(parent);
    const matches = (
      await this.port.listChildren(parent.node.id as FolderId)
    ).filter((node) => node.name === leaf);
    if (matches.length > 0) {
      throw new MarkdownGatewayError(
        matches.length > 1 ? "AMBIGUOUS_PATH" : "INVALID_PATH",
        "A file or folder already exists at this path.",
      );
    }
    const result = await guardedCreateFile(
      this.writer,
      lease,
      parent.node.id as FolderId,
      leaf,
      input.content,
    );
    this.throwCreateFailure(result);
    const created = result.node;
    this.assertDirectChild(created, parent.node.id as FolderId);
    this.assertRegularMarkdown(created);
    if (
      created.name !== leaf ||
      created.size !== utf8ByteSize(input.content) ||
      !created.revision
    ) {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Drive port returned inconsistent create metadata.",
      );
    }
    return this.toMetadata(created, segments);
  }

  private async updateMarkdown(
    input: UpdateMarkdownInput,
    lease: WriteLease,
  ): Promise<UpdateMarkdownResult> {
    this.requireExpectedRevision(input.expectedRevision);
    requireContentWithinLimit(input.content, this.maxMarkdownBytes);
    const resolved = await this.resolveFile(input);
    this.assertClosedMutationTopology(resolved);
    const result = await guardedUpdateFile(
      this.writer,
      lease,
      resolved.node.id as FileId,
      input.expectedRevision,
      input.content,
    );
    return this.handleUpdateResult(result, resolved, input);
  }

  private async archiveMarkdown(
    input: ArchiveMarkdownInput,
    lease: WriteLease,
  ): Promise<ArchiveMarkdownResult> {
    void input;
    void lease;
    // A file ETag cannot bind the archive folder's parent chain.
    throw new MarkdownGatewayError(
      "UNSUPPORTED",
      "Archive is unavailable without atomic destination topology proof.",
    );
  }

  /**
   * Drive exposes no conditional assertion over a mutable ancestor chain.
   * Read APIs therefore expose only direct root children, whose parent fact is
   * bound by the file revision checked around content transfer by the adapter.
   */
  private requireDirectRootRead(
    path: string | undefined,
    recursive: boolean,
  ): void {
    if (path !== undefined || recursive) this.throwNestedReadUnavailable();
  }

  private throwNestedReadUnavailable(): never {
    throw new MarkdownGatewayError(
      "UNSUPPORTED",
      "Nested or recursive reads are unavailable without atomic topology proof.",
    );
  }

  private assertDirectRootFile(resolved: ResolvedNode): void {
    if (
      resolved.segments.length !== 1 ||
      resolved.node.parentIds.length !== 1 ||
      resolved.node.parentIds[0] !== this.config.rootFolderId
    ) {
      this.throwNestedReadUnavailable();
    }
  }

  private async resolveFile(locator: FileLocator): Promise<ResolvedNode> {
    const resolved =
      "path" in locator && locator.path !== undefined
        ? await this.resolveSegments(requireMarkdownPath(locator.path), false)
        : await this.resolveVerifiedNode(locator.fileId, "file");
    this.assertRegularMarkdown(resolved.node);
    if (
      resolved.node.size !== undefined &&
      resolved.node.size > this.maxMarkdownBytes
    ) {
      throw new MarkdownGatewayError(
        "FILE_TOO_LARGE",
        "Markdown file exceeds the configured limit.",
      );
    }
    return resolved;
  }

  private async resolveSegments(
    segments: readonly string[],
    expectFolder: boolean,
  ): Promise<ResolvedNode> {
    const root = await this.getRoot();
    let current = root;
    const traversed: string[] = [];
    for (const [index, segment] of segments.entries()) {
      const candidates = (
        await this.port.listChildren(current.id as FolderId)
      ).filter((node) => node.name === segment);
      if (candidates.length === 0)
        throw new MarkdownGatewayError("NOT_FOUND", "Path was not found.");
      if (candidates.length > 1)
        throw new MarkdownGatewayError(
          "AMBIGUOUS_PATH",
          "Path has duplicate names.",
        );
      const child = candidates[0];
      this.assertDirectChild(child, current.id as FolderId);
      this.assertSafeDriveName(child.name);
      if (child.kind === "shortcut")
        throw new MarkdownGatewayError(
          "UNSUPPORTED",
          "Shortcuts are not supported.",
        );
      const last = index === segments.length - 1;
      if (!last && child.kind !== "folder")
        throw new MarkdownGatewayError(
          "NOT_FOUND",
          "Path segment is not a folder.",
        );
      current = child;
      traversed.push(segment);
    }
    if (expectFolder && current.kind !== "folder")
      throw new MarkdownGatewayError("NOT_FOUND", "Path is not a folder.");
    return { node: current, segments: traversed };
  }

  private async resolveVerifiedNode(
    id: FileId | FolderId,
    expectedKind: "file" | "folder",
  ): Promise<ResolvedNode> {
    const seen = new Set<string>();
    const segments: string[] = [];
    let current = await this.port.getNode(id);
    if (!current)
      throw new MarkdownGatewayError("NOT_FOUND", "Drive node was not found.");
    if (current.id === this.config.rootFolderId) {
      throw new MarkdownGatewayError(
        "OUTSIDE_ROOT",
        "The root folder is not a file target.",
      );
    }
    const leaf = current;
    while (current.id !== this.config.rootFolderId) {
      if (seen.has(current.id))
        throw new MarkdownGatewayError(
          "OUTSIDE_ROOT",
          "Drive parent chain contains a cycle.",
        );
      seen.add(current.id);
      if (current.kind === "shortcut")
        throw new MarkdownGatewayError(
          "UNSUPPORTED",
          "Shortcuts are not supported.",
        );
      if (current.parentIds.length !== 1)
        throw new MarkdownGatewayError(
          "OUTSIDE_ROOT",
          "Drive node does not have one verified parent.",
        );
      this.assertSafeDriveName(current.name);
      segments.unshift(current.name);
      const parent = await this.port.getNode(current.parentIds[0]);
      if (!parent)
        throw new MarkdownGatewayError(
          "OUTSIDE_ROOT",
          "Drive parent is missing.",
        );
      if (parent.kind !== "folder")
        throw new MarkdownGatewayError(
          "OUTSIDE_ROOT",
          "Drive parent is not a folder.",
        );
      current = parent;
    }
    if (current.kind !== "folder" || current.parentIds.length > 1) {
      throw new MarkdownGatewayError(
        "OUTSIDE_ROOT",
        "Configured root is not a safe folder.",
      );
    }
    this.assertSafeDriveName(current.name);
    if (leaf.kind !== expectedKind)
      throw new MarkdownGatewayError(
        "NOT_FOUND",
        "Drive node has the wrong kind.",
      );
    return { node: leaf, segments };
  }

  private async getRoot(): Promise<DriveNode> {
    const root = await this.port.getNode(this.config.rootFolderId);
    if (root?.kind !== "folder" || root.parentIds.length > 1) {
      throw new MarkdownGatewayError(
        "OUTSIDE_ROOT",
        "Configured root is not a safe folder.",
      );
    }
    this.assertSafeDriveName(root.name);
    return root;
  }

  /**
   * The provider offers no conditional precondition for an arbitrary ancestor
   * chain. Mutations therefore stay at depth one, where the configured root is
   * the immutable boundary and no mutable ancestor can race resolution.
   */
  private assertCreateTopology(parent: ResolvedNode): void {
    if (
      parent.segments.length !== 0 ||
      parent.node.id !== this.config.rootFolderId
    ) {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Nested Markdown mutations are unavailable without atomic topology proof.",
      );
    }
  }

  private assertClosedMutationTopology(resolved: ResolvedNode): void {
    if (
      resolved.segments.length !== 1 ||
      resolved.node.parentIds.length !== 1 ||
      resolved.node.parentIds[0] !== this.config.rootFolderId
    ) {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Nested Markdown mutations are unavailable without atomic topology proof.",
      );
    }
  }

  private async safeMetadata(
    node: DriveNode,
  ): Promise<MarkdownFileMetadata | undefined> {
    try {
      const resolved = await this.resolveVerifiedNode(node.id, "file");
      if (!this.sameNodeFacts(node, resolved.node)) return undefined;
      this.assertRegularMarkdown(resolved.node);
      if (
        resolved.node.size === undefined ||
        resolved.node.size > this.maxMarkdownBytes
      )
        return undefined;
      return this.toMetadata(resolved.node, resolved.segments);
    } catch (error) {
      if (error instanceof MarkdownGatewayError) return undefined;
      throw error;
    }
  }

  private assertDirectChild(node: DriveNode, parent: FolderId): void {
    if (node.parentIds.length !== 1 || node.parentIds[0] !== parent) {
      throw new MarkdownGatewayError(
        "OUTSIDE_ROOT",
        "Drive node escapes its expected parent.",
      );
    }
  }

  private assertRegularMarkdown(node: DriveNode): void {
    if (
      typeof node.id !== "string" ||
      node.id.length === 0 ||
      typeof node.name !== "string" ||
      node.name.length === 0 ||
      typeof node.modifiedTime !== "string" ||
      Number.isNaN(Date.parse(node.modifiedTime)) ||
      new Date(node.modifiedTime).toISOString() !== node.modifiedTime
    ) {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Drive file has malformed metadata.",
      );
    }
    if (node.kind === "shortcut")
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Shortcuts are not supported.",
      );
    this.assertSafeDriveName(node.name);
    if (node.kind !== "file")
      throw new MarkdownGatewayError("NOT_FOUND", "Path is not a file.");
    if (!isMarkdownName(node.name))
      throw new MarkdownGatewayError(
        "NOT_MARKDOWN",
        "Only Markdown files are supported.",
      );
    if (
      !node.revision ||
      node.size === undefined ||
      !Number.isSafeInteger(node.size) ||
      node.size < 0
    ) {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Drive file lacks required metadata.",
      );
    }
  }

  /** Drive names become gateway paths only after they pass the caller-path grammar. */
  private assertSafeDriveName(name: string): void {
    try {
      const segments = parseRelativePath(name);
      if (segments.length !== 1 || canonicalRelativePath(segments) !== name) {
        throw new Error("not a single segment");
      }
    } catch {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Drive node has an unsafe name.",
      );
    }
  }

  private toMetadata(
    node: DriveNode,
    segments: readonly string[],
  ): MarkdownFileMetadata {
    this.assertRegularMarkdown(node);
    return {
      relativePath: canonicalRelativePath(segments),
      fileId: node.id as FileId,
      revision: node.revision as Revision,
      modifiedTime: node.modifiedTime,
      size: node.size as number,
    };
  }

  private handleUpdateResult(
    result: ConditionalWriteResult,
    resolved: ResolvedNode,
    input: UpdateMarkdownInput,
  ): MarkdownFileMetadata {
    this.throwConditionalFailure(result);
    const node = result.node;
    if (
      !this.sameNodeIdentityAndLocation(node, resolved.node) ||
      node.size !== utf8ByteSize(input.content) ||
      node.revision === input.expectedRevision
    ) {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Drive port returned inconsistent update metadata.",
      );
    }
    return this.toMetadata(node, resolved.segments);
  }

  private throwConditionalFailure(
    result: ConditionalWriteResult,
  ): asserts result is Extract<
    ConditionalWriteResult,
    { readonly outcome: "success" }
  > {
    if (result.outcome === "unsupported") {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Drive port cannot safely perform this operation.",
      );
    }
    if (result.outcome === "conflict") {
      throw new MarkdownGatewayError(
        "CONFLICT",
        "The Markdown file changed before this operation.",
        {
          ...(result.current
            ? { currentRevision: result.current.revision ?? "unknown" }
            : {}),
        },
      );
    }
  }

  private throwCreateFailure(
    result: CreateWriteResult,
  ): asserts result is Extract<
    CreateWriteResult,
    { readonly outcome: "success" }
  > {
    if (result.outcome === "unsupported") {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Drive port cannot safely perform this operation.",
      );
    }
  }

  private requireExpectedRevision(value: Revision): void {
    if (typeof value !== "string" || value.length === 0) {
      throw new MarkdownGatewayError(
        "CONFLICT",
        "An expected revision is required.",
      );
    }
  }

  private isBelow(path: string, folderSegments: readonly string[]): boolean {
    const candidate = parseRelativePath(path);
    return folderSegments.every(
      (segment, index) => candidate[index] === segment,
    );
  }

  private isDirectlyBelow(
    path: string,
    folderSegments: readonly string[],
  ): boolean {
    return (
      this.isBelow(path, folderSegments) &&
      parseRelativePath(path).length === folderSegments.length + 1
    );
  }

  private assertUniquePath(paths: Set<string>, path: string): void {
    if (paths.has(path)) {
      throw new MarkdownGatewayError(
        "AMBIGUOUS_PATH",
        "Drive returned duplicate canonical file paths.",
      );
    }
    paths.add(path);
  }

  private sameNodeFacts(left: DriveNode, right: DriveNode): boolean {
    return (
      this.sameNodeFactsExceptRevision(left, right) &&
      left.revision === right.revision
    );
  }

  private sameNodeFactsExceptRevision(
    left: DriveNode,
    right: DriveNode,
  ): boolean {
    return (
      this.sameNodeIdentityAndLocation(left, right) &&
      left.size === right.size &&
      left.modifiedTime === right.modifiedTime
    );
  }

  private sameNodeIdentityAndLocation(
    left: DriveNode,
    right: DriveNode,
  ): boolean {
    return (
      left.id === right.id &&
      left.name === right.name &&
      left.kind === right.kind &&
      left.mimeType === right.mimeType &&
      left.parentIds.length === right.parentIds.length &&
      left.parentIds.every((parent, index) => parent === right.parentIds[index])
    );
  }
}
