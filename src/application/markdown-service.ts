import {
  type ArchiveMarkdownInput,
  type ArchiveMarkdownResult,
  type CreateMarkdownInput,
  type CreateMarkdownResult,
  canonicalRelativePath,
  type FileId,
  type FileLocator,
  type FolderId,
  isMarkdownName,
  isWellFormedUtf16,
  type ListMarkdownInput,
  type ListMarkdownResult,
  type MarkdownFileMetadata,
  MarkdownGatewayError,
  parseRelativePath,
  type ReadMarkdownInput,
  type ReadMarkdownResult,
  type Revision,
  requireContentWithinLimit,
  requireMarkdownPath,
  type SearchMarkdownInput,
  type SearchMarkdownResults,
  type UpdateMarkdownInput,
  type UpdateMarkdownResult,
  utf8ByteSize,
} from "../domain/markdown.js";
import {
  DriveListOverflowError,
  DriveReadLimitError,
} from "../drive/drive-port.js";
import type {
  ConditionalWriteResult,
  CreateWriteResult,
  DriveNode,
  DriveRead,
  DriveReadPort,
  DriveReadSession,
} from "../drive/drive-port.js";
import {
  DisabledDriveWritePort,
  type GuardedDriveWriter,
  guardedCreateFile,
  guardedUpdateFile,
  isGuardedDriveWriter,
} from "../drive/guarded-drive-write-port.js";
import type { WriteLease } from "../write-gate/gate.js";

const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const ABSOLUTE_MAX_SEARCH_LIMIT = 1_000;
const DEFAULT_MAX_LIST_RESULTS = ABSOLUTE_MAX_SEARCH_LIMIT;

export interface MarkdownServiceConfig {
  readonly rootFolderId: FolderId;
  readonly archiveFolderId: FolderId;
  readonly maxMarkdownBytes?: number;
  readonly defaultRecursive?: boolean;
  readonly defaultSearchLimit?: number;
  readonly maxSearchLimit?: number;
  /** Maximum direct-root entries returned by one list request. */
  readonly maxListResults?: number;
  readonly maxPathDepth?: number;
  readonly maxTraversalNodes?: number;
  readonly maxContentSearchFiles?: number;
  readonly maxJsonResponseBytes?: number;
}

interface ResolvedNode {
  readonly node: DriveNode;
  readonly segments: readonly string[];
}

interface ReadSnapshot {
  readonly chain: readonly DriveNode[];
  readonly segments: readonly string[];
}

interface ReadContext {
  readonly session: DriveReadSession;
  traversedNodes: number;
  contentSearchFiles: number;
  resultBytes: number;
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
  private readonly maxListResults: number;
  private readonly maxPathDepth: number;
  private readonly maxTraversalNodes: number;
  private readonly maxContentSearchFiles: number;
  private readonly maxJsonResponseBytes: number;

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
      !this.isWellFormedCallerId(config.rootFolderId) ||
      !this.isWellFormedCallerId(config.archiveFolderId) ||
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
    this.maxListResults = config.maxListResults ?? DEFAULT_MAX_LIST_RESULTS;
    this.maxPathDepth = config.maxPathDepth ?? 100;
    this.maxTraversalNodes = config.maxTraversalNodes ?? 10_000;
    this.maxContentSearchFiles =
      config.maxContentSearchFiles ?? this.maxTraversalNodes;
    this.maxJsonResponseBytes = config.maxJsonResponseBytes ?? 6_295_552;
    if (
      !Number.isSafeInteger(this.maxMarkdownBytes) ||
      this.maxMarkdownBytes < 0 ||
      !Number.isSafeInteger(this.defaultSearchLimit) ||
      !Number.isSafeInteger(this.maxSearchLimit) ||
      !Number.isSafeInteger(this.maxListResults) ||
      !Number.isSafeInteger(this.maxPathDepth) ||
      !Number.isSafeInteger(this.maxTraversalNodes) ||
      !Number.isSafeInteger(this.maxContentSearchFiles) ||
      !Number.isSafeInteger(this.maxJsonResponseBytes) ||
      this.defaultSearchLimit < 1 ||
      this.maxSearchLimit < this.defaultSearchLimit ||
      this.maxSearchLimit > ABSOLUTE_MAX_SEARCH_LIMIT ||
      this.maxListResults < 1 ||
      this.maxListResults > ABSOLUTE_MAX_SEARCH_LIMIT ||
      this.maxPathDepth < 1 ||
      this.maxPathDepth > 100 ||
      this.maxTraversalNodes < 1 ||
      this.maxTraversalNodes > 10_000 ||
      this.maxContentSearchFiles < 1 ||
      this.maxContentSearchFiles > this.maxTraversalNodes ||
      this.maxJsonResponseBytes < 1 ||
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
    return this.withReadContext(async (context) => {
      const folder = await this.resolveReadFolder(context, input.path);
      const candidates = await this.collectReadCandidates(
        context,
        folder,
        recursive,
      );
      const result: MarkdownFileMetadata[] = [];
      for (const candidate of candidates) {
        const node = this.snapshotLeaf(candidate);
        if (node.size === undefined || node.size > this.maxMarkdownBytes)
          continue;
        if (result.length >= this.maxListResults) this.throwResultLimit();
        await this.assertStableSnapshot(context, candidate);
        const metadata = this.toMetadata(node, candidate.segments);
        this.chargeResult(context, metadata);
        result.push(metadata);
      }
      return result.sort((left, right) =>
        left.relativePath < right.relativePath
          ? -1
          : left.relativePath > right.relativePath
            ? 1
            : 0,
      );
    });
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
    return this.withReadContext(async (context) => {
      const folder = await this.resolveReadFolder(context, input.path);
      const candidates = await this.collectReadCandidates(
        context,
        folder,
        true,
      );
      const needle = input.query.toLowerCase();
      const matches: SearchMarkdownResults[number][] = [];
      const matchedSnapshots: ReadSnapshot[] = [];
      for (const candidate of candidates) {
        const node = this.snapshotLeaf(candidate);
        if (node.size === undefined || node.size > this.maxMarkdownBytes) {
          if (!node.name.toLowerCase().includes(needle))
            this.throwResultLimit();
          continue;
        }
        let excerpt: string | undefined;
        if (!node.name.toLowerCase().includes(needle)) {
          if (++context.contentSearchFiles > this.maxContentSearchFiles)
            this.throwResultLimit();
          let read: DriveRead | undefined;
          try {
            read = await context.session.readFile(node.id as FileId);
          } catch (error) {
            if (error instanceof DriveReadLimitError) this.throwResultLimit();
            throw error;
          }
          if (!read) {
            this.throwResultLimit();
          }
          if (!this.sameNodeFacts(read.node, node)) {
            throw new MarkdownGatewayError(
              "CONFLICT",
              "Markdown topology changed while searching.",
            );
          }
          try {
            requireContentWithinLimit(read.content, this.maxMarkdownBytes);
          } catch (error) {
            if (error instanceof MarkdownGatewayError) this.throwResultLimit();
            throw error;
          }
          if (utf8ByteSize(read.content) !== node.size) {
            this.throwResultLimit();
          }
          const index = read.content.toLowerCase().indexOf(needle);
          if (index < 0) continue;
          excerpt = this.excerptAround(read.content, index, input.query.length);
        }
        matches.push({
          ...this.toMetadata(node, candidate.segments),
          ...(excerpt === undefined ? {} : { excerpt }),
        });
        matchedSnapshots.push(candidate);
      }
      const ordered = matches
        .map((match, index) => ({ match, snapshot: matchedSnapshots[index] }))
        .sort((left, right) =>
          left.match.relativePath < right.match.relativePath
            ? -1
            : left.match.relativePath > right.match.relativePath
              ? 1
              : 0,
        )
        .slice(0, limit);
      for (const { match, snapshot } of ordered) {
        await this.assertStableSnapshot(context, snapshot);
        this.chargeResult(context, match);
      }
      return ordered.map(({ match }) => match);
    });
  }

  async readMarkdown(locator: ReadMarkdownInput): Promise<ReadMarkdownResult> {
    return this.withReadContext(async (context) => {
      const resolved = await this.resolveReadFile(context, locator);
      const node = this.snapshotLeaf(resolved);
      const read = await context.session.readFile(node.id as FileId);
      if (!read)
        throw new MarkdownGatewayError(
          "NOT_FOUND",
          "Markdown file was not found.",
        );
      if (!this.sameNodeFacts(read.node, node)) {
        throw new MarkdownGatewayError(
          "CONFLICT",
          "Markdown topology changed while reading.",
        );
      }
      requireContentWithinLimit(read.content, this.maxMarkdownBytes);
      if (utf8ByteSize(read.content) !== read.node.size) {
        throw new MarkdownGatewayError(
          "UNSUPPORTED",
          "Drive port content size does not match file metadata.",
        );
      }
      await this.assertStableSnapshot(context, resolved);
      const result = {
        ...this.toMetadata(node, resolved.segments),
        content: read.content,
      };
      this.chargeResult(context, result);
      return result;
    });
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
    if ("fileId" in input) this.assertWellFormedCallerId(input.fileId);
    this.requireExpectedRevision(input.expectedRevision);
    void input;
    void lease;
    // A file ETag cannot bind the archive folder's parent chain.
    throw new MarkdownGatewayError(
      "UNSUPPORTED",
      "Archive is unavailable without atomic destination topology proof.",
    );
  }

  private async withReadContext<T>(
    operation: (context: ReadContext) => Promise<T>,
  ): Promise<T> {
    try {
      const session = this.port.openReadSession
        ? await this.port.openReadSession()
        : this.legacyReadSession();
      return await operation({
        session,
        traversedNodes: 0,
        contentSearchFiles: 0,
        resultBytes: 0,
      });
    } catch (error) {
      if (
        error instanceof DriveListOverflowError ||
        error instanceof DriveReadLimitError
      ) {
        this.throwResultLimit();
      }
      throw error;
    }
  }

  private legacyReadSession(): DriveReadSession {
    return {
      getNode: (id) => this.port.getNode(id),
      listChildren: (folder) => this.port.listChildren(folder),
      readFile: (id) => this.port.readFile(id),
    };
  }

  private async resolveReadFolder(
    context: ReadContext,
    path: string | undefined,
  ): Promise<ReadSnapshot> {
    return path === undefined
      ? this.readRootSnapshot(context)
      : this.resolveReadSegments(context, parseRelativePath(path), "folder");
  }

  private async resolveReadFile(
    context: ReadContext,
    locator: FileLocator,
  ): Promise<ReadSnapshot> {
    const snapshot =
      "path" in locator && locator.path !== undefined
        ? await this.resolveReadSegments(
            context,
            requireMarkdownPath(locator.path),
            "file",
          )
        : await this.resolveReadId(context, locator.fileId, "file");
    const node = this.snapshotLeaf(snapshot);
    this.assertRegularMarkdown(node);
    if (node.size !== undefined && node.size > this.maxMarkdownBytes) {
      throw new MarkdownGatewayError(
        "FILE_TOO_LARGE",
        "Markdown file exceeds the configured limit.",
      );
    }
    return snapshot;
  }

  private async readRootSnapshot(context: ReadContext): Promise<ReadSnapshot> {
    const root = await context.session.getNode(this.config.rootFolderId);
    if (
      !root ||
      root.id !== this.config.rootFolderId ||
      root.kind !== "folder"
    ) {
      throw new MarkdownGatewayError(
        "OUTSIDE_ROOT",
        "Configured root is not a safe folder.",
      );
    }
    this.assertWellFormedNodeIds(root);
    this.assertSafeDriveName(root.name);
    if (root.parentIds.length > 1) {
      throw new MarkdownGatewayError(
        "OUTSIDE_ROOT",
        "Configured root is not a safe folder.",
      );
    }
    return { chain: [root], segments: [] };
  }

  private async resolveReadSegments(
    context: ReadContext,
    segments: readonly string[],
    expectedKind: "file" | "folder",
  ): Promise<ReadSnapshot> {
    if (segments.length > this.maxPathDepth) this.throwResultLimit();
    let snapshot = await this.readRootSnapshot(context);
    for (const [index, segment] of segments.entries()) {
      const parent = this.snapshotLeaf(snapshot);
      const children = await this.listReadChildren(
        context,
        parent.id as FolderId,
      );
      const matches = children.filter((child) => child.name === segment);
      if (matches.length === 0)
        throw new MarkdownGatewayError("NOT_FOUND", "Path was not found.");
      if (matches.length > 1)
        throw new MarkdownGatewayError(
          "AMBIGUOUS_PATH",
          "Path has duplicate names.",
        );
      const child = matches[0];
      this.assertReadChild(child, parent.id as FolderId);
      const isLast = index === segments.length - 1;
      if (!isLast && child.kind !== "folder")
        throw new MarkdownGatewayError(
          "NOT_FOUND",
          "Path segment is not a folder.",
        );
      snapshot = {
        chain: [...snapshot.chain, child],
        segments: [...snapshot.segments, segment],
      };
    }
    if (this.snapshotLeaf(snapshot).kind !== expectedKind)
      throw new MarkdownGatewayError("NOT_FOUND", "Path has the wrong kind.");
    return snapshot;
  }

  private async resolveReadId(
    context: ReadContext,
    id: FileId | FolderId,
    expectedKind: "file" | "folder",
  ): Promise<ReadSnapshot> {
    this.assertWellFormedCallerId(id);
    const root = await this.readRootSnapshot(context);
    let current = await context.session.getNode(id);
    if (!current)
      throw new MarkdownGatewayError("NOT_FOUND", "Drive node was not found.");
    if (current.id === this.config.rootFolderId)
      throw new MarkdownGatewayError(
        "OUTSIDE_ROOT",
        "The root folder is not a file target.",
      );
    const reversed: DriveNode[] = [];
    const seen = new Set<string>();
    while (current.id !== this.config.rootFolderId) {
      const child = current;
      if (reversed.length >= this.maxPathDepth) this.throwResultLimit();
      this.assertReadNode(child);
      if (seen.has(child.id))
        throw new MarkdownGatewayError(
          "OUTSIDE_ROOT",
          "Drive parent chain contains a cycle.",
        );
      seen.add(child.id);
      if (child.parentIds.length !== 1)
        throw new MarkdownGatewayError(
          "OUTSIDE_ROOT",
          "Drive node does not have one verified parent.",
        );
      const parent = await context.session.getNode(child.parentIds[0]);
      if (parent?.kind !== "folder")
        throw new MarkdownGatewayError(
          "OUTSIDE_ROOT",
          "Drive parent is missing.",
        );
      const siblings = await this.listReadChildren(
        context,
        parent.id as FolderId,
      );
      const nameMatches = siblings.filter((node) => node.name === child.name);
      const idMatches = siblings.filter((node) => node.id === child.id);
      if (nameMatches.length > 1)
        throw new MarkdownGatewayError(
          "AMBIGUOUS_PATH",
          "Path has duplicate names.",
        );
      if (
        nameMatches.length !== 1 ||
        idMatches.length !== 1 ||
        nameMatches[0].id !== child.id
      )
        throw new MarkdownGatewayError(
          "OUTSIDE_ROOT",
          "Drive parent does not contain its child.",
        );
      this.assertReadChild(nameMatches[0], parent.id as FolderId);
      if (!this.sameNodeFacts(nameMatches[0], child))
        throw new MarkdownGatewayError(
          "OUTSIDE_ROOT",
          "Drive child facts are inconsistent.",
        );
      reversed.unshift(child);
      current = parent;
    }
    if (!this.sameNodeFacts(current, this.snapshotLeaf(root)))
      throw new MarkdownGatewayError(
        "OUTSIDE_ROOT",
        "Configured root changed during resolution.",
      );
    const leaf = reversed.at(-1);
    if (!leaf || leaf.kind !== expectedKind)
      throw new MarkdownGatewayError(
        "NOT_FOUND",
        "Drive node has the wrong kind.",
      );
    return {
      chain: [...root.chain, ...reversed],
      segments: reversed.map((node) => node.name),
    };
  }

  private async listReadChildren(
    context: ReadContext,
    folder: FolderId,
  ): Promise<readonly DriveNode[]> {
    const children = await context.session.listChildren(folder);
    context.traversedNodes += children.length;
    if (context.traversedNodes > this.maxTraversalNodes)
      this.throwResultLimit();
    return children;
  }

  private async collectReadCandidates(
    context: ReadContext,
    folder: ReadSnapshot,
    recursive: boolean,
  ): Promise<readonly ReadSnapshot[]> {
    const candidates: ReadSnapshot[] = [];
    const paths = new Set<string>();
    const queue: ReadSnapshot[] = [folder];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const parent = this.snapshotLeaf(current);
      if (visited.has(parent.id)) continue;
      visited.add(parent.id);
      const children = await this.listReadChildren(
        context,
        parent.id as FolderId,
      );
      const names = new Map<string, DriveNode>();
      for (const child of children) {
        this.assertReadChild(child, parent.id as FolderId);
        const prior = names.get(child.name);
        if (
          prior &&
          (prior.kind === "folder" ||
            child.kind === "folder" ||
            (isMarkdownName(prior.name) && isMarkdownName(child.name)))
        ) {
          throw new MarkdownGatewayError(
            "AMBIGUOUS_PATH",
            "Drive returned duplicate canonical paths.",
          );
        }
        names.set(child.name, child);
        const snapshot = {
          chain: [...current.chain, child],
          segments: [...current.segments, child.name],
        };
        if (snapshot.segments.length > this.maxPathDepth) {
          this.throwResultLimit();
        }
        if (child.kind === "folder") {
          if (
            snapshot.chain.slice(0, -1).some((node) => node.id === child.id)
          ) {
            throw new MarkdownGatewayError(
              "OUTSIDE_ROOT",
              "Drive folder traversal contains a cycle.",
            );
          }
          if (recursive) queue.push(snapshot);
          continue;
        }
        if (child.kind === "shortcut")
          throw new MarkdownGatewayError(
            "UNSUPPORTED",
            "Shortcuts are not supported.",
          );
        if (!isMarkdownName(child.name)) continue;
        this.assertRegularMarkdown(child);
        const path = canonicalRelativePath(snapshot.segments);
        this.assertUniquePath(paths, path);
        candidates.push(snapshot);
      }
    }
    return candidates;
  }

  private async assertStableSnapshot(
    context: ReadContext,
    before: ReadSnapshot,
  ): Promise<void> {
    try {
      const after = await this.resolveReadSegments(
        context,
        before.segments,
        this.snapshotLeaf(before).kind === "folder" ? "folder" : "file",
      );
      if (
        after.chain.length !== before.chain.length ||
        !after.chain.every((node, index) =>
          this.sameNodeFacts(node, before.chain[index]),
        )
      ) {
        throw new Error("topology changed");
      }
    } catch (error) {
      if (
        error instanceof DriveReadLimitError ||
        error instanceof DriveListOverflowError
      ) {
        this.throwResultLimit();
      }
      if (error instanceof MarkdownGatewayError) {
        if (error.code === "RESULT_LIMIT") throw error;
        throw new MarkdownGatewayError(
          "CONFLICT",
          "Markdown topology changed while reading.",
        );
      }
      if (error instanceof Error && error.message === "topology changed") {
        throw new MarkdownGatewayError(
          "CONFLICT",
          "Markdown topology changed while reading.",
        );
      }
      throw error;
    }
  }

  private snapshotLeaf(snapshot: ReadSnapshot): DriveNode {
    const node = snapshot.chain.at(-1);
    if (!node)
      throw new MarkdownGatewayError("UNSUPPORTED", "Drive snapshot is empty.");
    return node;
  }

  private assertReadNode(node: DriveNode): void {
    this.assertWellFormedNodeIds(node);
    this.assertSafeDriveName(node.name);
    if (node.kind === "shortcut")
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Shortcuts are not supported.",
      );
  }

  private assertReadChild(node: DriveNode, parent: FolderId): void {
    this.assertReadNode(node);
    this.assertDirectChild(node, parent);
  }

  private chargeResult(context: ReadContext, value: unknown): void {
    context.resultBytes += utf8ByteSize(JSON.stringify(value));
    if (context.resultBytes > this.maxJsonResponseBytes)
      this.throwResultLimit();
  }

  private excerptAround(
    content: string,
    index: number,
    length: number,
  ): string {
    let start = Math.max(0, index - 20);
    let end = Math.min(content.length, index + length + 20);
    if (
      start > 0 &&
      this.isLowSurrogate(content.charCodeAt(start)) &&
      this.isHighSurrogate(content.charCodeAt(start - 1))
    )
      start -= 1;
    if (
      end < content.length &&
      this.isHighSurrogate(content.charCodeAt(end - 1)) &&
      this.isLowSurrogate(content.charCodeAt(end))
    )
      end += 1;
    return content.slice(start, end);
  }

  private isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
  }

  private isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
  }

  private throwResultLimit(): never {
    throw new MarkdownGatewayError(
      "RESULT_LIMIT",
      "Markdown list exceeds the configured result limit.",
      { maxResults: this.maxListResults },
    );
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
    this.assertWellFormedCallerId(id);
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
      this.assertWellFormedNodeIds(current);
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
    this.assertWellFormedNodeIds(current);
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
    this.assertWellFormedNodeIds(root);
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

  private assertDirectChild(node: DriveNode, parent: FolderId): void {
    if (node.parentIds.length !== 1 || node.parentIds[0] !== parent) {
      throw new MarkdownGatewayError(
        "OUTSIDE_ROOT",
        "Drive node escapes its expected parent.",
      );
    }
  }

  private assertRegularMarkdown(node: DriveNode): void {
    this.assertWellFormedNodeIds(node);
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
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      !isWellFormedUtf16(value)
    ) {
      throw new MarkdownGatewayError(
        "CONFLICT",
        "An expected revision is required.",
      );
    }
  }

  private isWellFormedCallerId(value: unknown): value is string {
    return (
      typeof value === "string" && value.length > 0 && isWellFormedUtf16(value)
    );
  }

  private assertWellFormedCallerId(value: unknown): asserts value is string {
    if (!this.isWellFormedCallerId(value)) {
      throw new MarkdownGatewayError(
        "INVALID_CONTENT",
        "Drive identifiers must be well-formed UTF-8 text.",
      );
    }
  }

  private assertWellFormedNodeIds(node: DriveNode): void {
    if (
      !this.isWellFormedCallerId(node.id) ||
      !node.parentIds.every((parent) => this.isWellFormedCallerId(parent))
    ) {
      throw new MarkdownGatewayError(
        "UNSUPPORTED",
        "Drive node has malformed identifiers.",
      );
    }
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
