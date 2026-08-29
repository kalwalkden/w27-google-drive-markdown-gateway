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
  guardedMoveFile,
  guardedUpdateFile,
  isGuardedDriveWriter,
} from "../drive/guarded-drive-write-port.js";

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

  openWriteSession(): MarkdownWriteSession {
    return Object.freeze({
      createMarkdown: (input: CreateMarkdownInput) =>
        this.createMarkdown(input),
      updateMarkdown: (input: UpdateMarkdownInput) =>
        this.updateMarkdown(input),
      archiveMarkdown: (input: ArchiveMarkdownInput) =>
        this.archiveMarkdown(input),
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
        const nameMatch = node.name.toLowerCase().includes(needle);
        if (node.size === undefined || node.size > this.maxMarkdownBytes) {
          if (!nameMatch) this.throwResultLimit();
          matches.push(this.toMetadata(node, candidate.segments));
          matchedSnapshots.push(candidate);
          continue;
        }
        let excerpt: string | undefined;
        if (!nameMatch) {
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
          // A media read can race any ancestor, including when it is not a
          // match or the eventual match falls beyond the caller result limit.
          await this.assertStableSnapshot(context, candidate);
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
  ): Promise<CreateMarkdownResult> {
    const segments = requireMarkdownPath(input.path);
    requireContentWithinLimit(input.content, this.maxMarkdownBytes);
    const leaf = segments.at(-1);
    if (!leaf)
      throw new MarkdownGatewayError("INVALID_PATH", "Path must name a file.");
    return this.withReadContext(async (context) => {
      const parent = await this.resolveMutationFolder(
        context,
        segments.slice(0, -1),
      );
      await this.assertDestinationVacant(context, parent, leaf);
      const recheckedParent = await this.recheckSnapshot(context, parent);
      await this.assertDestinationVacant(context, recheckedParent, leaf);
      const result = await this.dispatchCreate(
        this.snapshotLeaf(recheckedParent).id as FolderId,
        leaf,
        input.content,
      );
      this.throwCreateFailure(result);
      return this.verifyAfterDispatch(async () => {
        if (result.node.id.length === 0 || result.node.name !== leaf) {
          this.throwOutcomeUnknown();
        }
        const created = await this.resolveReadId(
          context,
          result.node.id,
          "file",
        );
        const node = this.snapshotLeaf(created);
        this.assertRegularMarkdown(node);
        if (
          node.id !== result.node.id ||
          node.name !== leaf ||
          node.size !== utf8ByteSize(input.content) ||
          !node.revision ||
          node.parentIds.length !== 1 ||
          node.parentIds[0] !== this.snapshotLeaf(parent).id ||
          canonicalRelativePath(created.segments) !==
            canonicalRelativePath(segments) ||
          !this.sameChainFacts(created.chain.slice(0, -1), parent.chain) ||
          !this.sameNodeFacts(result.node, node)
        ) {
          this.throwOutcomeUnknown();
        }
        return this.toMetadata(node, created.segments);
      });
    });
  }

  private async updateMarkdown(
    input: UpdateMarkdownInput,
  ): Promise<UpdateMarkdownResult> {
    this.requireExpectedRevision(input.expectedRevision);
    requireContentWithinLimit(input.content, this.maxMarkdownBytes);
    return this.withReadContext(async (context) => {
      const before = await this.resolveReadFile(context, input);
      const source = this.snapshotLeaf(before);
      if (source.revision !== input.expectedRevision) this.throwConflict();
      await this.recheckSnapshot(context, before);
      const rechecked = await this.resolveReadFile(context, input);
      if (
        !this.sameChainFacts(rechecked.chain, before.chain) ||
        this.snapshotLeaf(rechecked).revision !== input.expectedRevision
      )
        this.throwConflict();
      const result = await this.dispatchUpdate(
        source.id as FileId,
        input.expectedRevision,
        input.content,
      );
      this.throwConditionalFailure(result);
      return this.verifyAfterDispatch(async () => {
        if (result.node.id !== source.id) this.throwOutcomeUnknown();
        const after = await this.resolveReadId(
          context,
          source.id as FileId,
          "file",
        );
        const node = this.snapshotLeaf(after);
        if (
          !this.sameNodeIdentityAndLocation(node, source) ||
          node.size !== utf8ByteSize(input.content) ||
          !node.revision ||
          node.revision === input.expectedRevision ||
          !this.sameChainFacts(
            after.chain.slice(0, -1),
            before.chain.slice(0, -1),
          ) ||
          !this.sameNodeFacts(result.node, node)
        ) {
          this.throwOutcomeUnknown();
        }
        return this.toMetadata(node, after.segments);
      });
    });
  }

  private async archiveMarkdown(
    input: ArchiveMarkdownInput,
  ): Promise<ArchiveMarkdownResult> {
    if ("fileId" in input) this.assertWellFormedCallerId(input.fileId);
    this.requireExpectedRevision(input.expectedRevision);
    return this.withReadContext(async (context) => {
      const source = await this.resolveReadFile(context, input);
      const sourceNode = this.snapshotLeaf(source);
      if (sourceNode.revision !== input.expectedRevision) this.throwConflict();
      const archive = await this.resolveArchiveFolder(context);
      const archiveNode = this.snapshotLeaf(archive);
      const initialMatches = await this.destinationMatches(
        context,
        archiveNode.id as FolderId,
        sourceNode.name,
      );
      if (sourceNode.parentIds[0] === archiveNode.id) {
        this.assertAlreadyArchived(source, archive, initialMatches);
        const recheckedSource = await this.resolveReadFile(context, input);
        const recheckedSourceNode = this.snapshotLeaf(recheckedSource);
        const recheckedArchive = await this.resolveArchiveFolder(context);
        if (
          !this.sameChainFacts(recheckedSource.chain, source.chain) ||
          recheckedSourceNode.revision !== input.expectedRevision ||
          !this.sameChainFacts(recheckedArchive.chain, archive.chain)
        ) {
          this.throwConflict();
        }
        const recheckedMatches = await this.destinationMatches(
          context,
          this.snapshotLeaf(recheckedArchive).id as FolderId,
          recheckedSourceNode.name,
        );
        const finalSource = await this.resolveReadFile(context, input);
        const finalSourceNode = this.snapshotLeaf(finalSource);
        const finalArchive = await this.resolveArchiveFolder(context);
        if (
          !this.sameChainFacts(finalSource.chain, recheckedSource.chain) ||
          finalSourceNode.revision !== input.expectedRevision ||
          !this.sameChainFacts(finalArchive.chain, recheckedArchive.chain)
        ) {
          this.throwConflict();
        }
        this.assertAlreadyArchived(finalSource, finalArchive, recheckedMatches);
        return this.toMetadata(finalSourceNode, finalSource.segments);
      }
      this.throwDestinationCollision(initialMatches);
      const sourceParent = source.chain.at(-2);
      if (sourceParent?.kind !== "folder") {
        throw new MarkdownGatewayError(
          "OUTSIDE_ROOT",
          "Drive source parent is missing.",
        );
      }
      await this.recheckSnapshot(context, source);
      await this.recheckSnapshot(context, archive);
      const recheckedSource = await this.resolveReadFile(context, input);
      if (
        !this.sameChainFacts(recheckedSource.chain, source.chain) ||
        this.snapshotLeaf(recheckedSource).revision !== input.expectedRevision
      )
        this.throwConflict();
      const recheckedArchive = await this.resolveArchiveFolder(context);
      if (!this.sameChainFacts(recheckedArchive.chain, archive.chain))
        this.throwConflict();
      await this.assertDestinationVacant(
        context,
        recheckedArchive,
        sourceNode.name,
      );
      const result = await this.dispatchMove(
        sourceNode.id as FileId,
        input.expectedRevision,
        sourceParent.id as FolderId,
        archiveNode.id as FolderId,
      );
      this.throwConditionalFailure(result);
      return this.verifyAfterDispatch(async () => {
        if (result.node.id !== sourceNode.id) this.throwOutcomeUnknown();
        const moved = await this.resolveReadId(
          context,
          sourceNode.id as FileId,
          "file",
        );
        const movedNode = this.snapshotLeaf(moved);
        const postArchive = await this.resolveArchiveFolder(context);
        const postArchiveNode = this.snapshotLeaf(postArchive);
        const matches = await this.destinationMatches(
          context,
          postArchiveNode.id as FolderId,
          sourceNode.name,
        );
        const oldParent = await this.resolveFolderByIdAllowingRoot(
          context,
          sourceParent.id as FolderId,
        );
        const oldChildren = await this.validatedChildren(
          context,
          sourceParent.id as FolderId,
        );
        if (
          !this.sameNodeFacts(result.node, movedNode) ||
          movedNode.name !== sourceNode.name ||
          !movedNode.revision ||
          movedNode.revision === input.expectedRevision ||
          movedNode.parentIds.length !== 1 ||
          movedNode.parentIds[0] !== archiveNode.id ||
          matches.length !== 1 ||
          matches[0].id !== movedNode.id ||
          oldChildren.some((node) => node.id === movedNode.id) ||
          !this.sameChainFacts(postArchive.chain, archive.chain) ||
          !this.sameChainFacts(oldParent.chain, source.chain.slice(0, -1))
        ) {
          this.throwOutcomeUnknown();
        }
        return this.toMetadata(movedNode, moved.segments);
      });
    });
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

  private async resolveMutationFolder(
    context: ReadContext,
    segments: readonly string[],
  ): Promise<ReadSnapshot> {
    return segments.length === 0
      ? this.readRootSnapshot(context)
      : this.resolveReadSegments(context, segments, "folder");
  }

  private async resolveArchiveFolder(
    context: ReadContext,
  ): Promise<ReadSnapshot> {
    const archive = await this.resolveReadId(
      context,
      this.config.archiveFolderId,
      "folder",
    );
    if (this.snapshotLeaf(archive).id === this.config.rootFolderId) {
      throw new MarkdownGatewayError(
        "INVALID_ARCHIVE",
        "Archive folder must be a descendant of the root.",
      );
    }
    return archive;
  }

  private async resolveFolderByIdAllowingRoot(
    context: ReadContext,
    id: FolderId,
  ): Promise<ReadSnapshot> {
    return id === this.config.rootFolderId
      ? this.readRootSnapshot(context)
      : this.resolveReadId(context, id, "folder");
  }

  private async validatedChildren(
    context: ReadContext,
    parentId: FolderId,
  ): Promise<readonly DriveNode[]> {
    const children = await this.listReadChildren(context, parentId);
    for (const child of children) this.assertReadChild(child, parentId);
    return children;
  }

  private async destinationMatches(
    context: ReadContext,
    parentId: FolderId,
    name: string,
  ): Promise<readonly DriveNode[]> {
    return (await this.validatedChildren(context, parentId)).filter(
      (node) => node.name === name,
    );
  }

  private async assertDestinationVacant(
    context: ReadContext,
    parent: ReadSnapshot,
    name: string,
  ): Promise<void> {
    this.throwDestinationCollision(
      await this.destinationMatches(
        context,
        this.snapshotLeaf(parent).id as FolderId,
        name,
      ),
    );
  }

  private throwDestinationCollision(matches: readonly DriveNode[]): void {
    if (matches.length === 0) return;
    throw new MarkdownGatewayError(
      matches.length > 1 ? "AMBIGUOUS_PATH" : "INVALID_PATH",
      "A file or folder already exists at this path.",
    );
  }

  private assertAlreadyArchived(
    source: ReadSnapshot,
    archive: ReadSnapshot,
    matches: readonly DriveNode[],
  ): void {
    const sourceNode = this.snapshotLeaf(source);
    const archiveNode = this.snapshotLeaf(archive);
    if (
      sourceNode.parentIds.length !== 1 ||
      sourceNode.parentIds[0] !== archiveNode.id ||
      matches.length !== 1 ||
      matches[0].id !== sourceNode.id ||
      !this.sameNodeFacts(matches[0], sourceNode)
    ) {
      this.throwDestinationCollision(matches);
      this.throwConflict();
    }
  }

  private async recheckSnapshot(
    context: ReadContext,
    before: ReadSnapshot,
  ): Promise<ReadSnapshot> {
    try {
      const after =
        before.segments.length === 0
          ? await this.readRootSnapshot(context)
          : await this.resolveReadSegments(
              context,
              before.segments,
              this.snapshotLeaf(before).kind === "folder" ? "folder" : "file",
            );
      if (!this.sameChainFacts(after.chain, before.chain)) this.throwConflict();
      return after;
    } catch (error) {
      if (error instanceof MarkdownGatewayError) {
        if (
          error.code === "AMBIGUOUS_PATH" ||
          error.code === "OUTSIDE_ROOT" ||
          error.code === "UNSUPPORTED" ||
          error.code === "RESULT_LIMIT"
        ) {
          throw error;
        }
      }
      this.throwConflict();
    }
  }

  private sameChainFacts(
    left: readonly DriveNode[],
    right: readonly DriveNode[],
  ): boolean {
    return (
      left.length === right.length &&
      left.every((node, index) => this.sameNodeFacts(node, right[index]))
    );
  }

  private async dispatchCreate(
    parentId: FolderId,
    name: string,
    content: string,
  ): Promise<CreateWriteResult> {
    try {
      return await guardedCreateFile(this.writer, parentId, name, content);
    } catch {
      // A writer exception after invocation cannot establish that Drive did
      // not receive the create request, so callers must reconcile by reading.
      this.throwOutcomeUnknown();
    }
  }

  private async dispatchUpdate(
    fileId: FileId,
    expectedRevision: Revision,
    content: string,
  ): Promise<ConditionalWriteResult> {
    try {
      return await guardedUpdateFile(
        this.writer,
        fileId,
        expectedRevision,
        content,
      );
    } catch {
      // A writer exception after invocation cannot establish that Drive did
      // not receive the conditional update request.
      this.throwOutcomeUnknown();
    }
  }

  private async dispatchMove(
    fileId: FileId,
    expectedRevision: Revision,
    sourceFolderId: FolderId,
    destinationFolderId: FolderId,
  ): Promise<ConditionalWriteResult> {
    try {
      return await guardedMoveFile(
        this.writer,
        fileId,
        expectedRevision,
        sourceFolderId,
        destinationFolderId,
      );
    } catch {
      // A writer exception after invocation cannot establish that Drive did
      // not receive the conditional parent move request.
      this.throwOutcomeUnknown();
    }
  }

  private async verifyAfterDispatch<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof MarkdownGatewayError &&
        error.code === "OUTCOME_UNKNOWN"
      ) {
        throw error;
      }
      this.throwOutcomeUnknown();
    }
  }

  private throwConflict(): never {
    throw new MarkdownGatewayError(
      "CONFLICT",
      "The Markdown file changed before this operation.",
    );
  }

  private throwOutcomeUnknown(): never {
    throw new MarkdownGatewayError(
      "OUTCOME_UNKNOWN",
      "Mutation outcome is unknown. Read the document again before any further mutation.",
    );
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

  private throwConditionalFailure(
    result: ConditionalWriteResult,
  ): asserts result is Extract<
    ConditionalWriteResult,
    { readonly outcome: "success" }
  > {
    if (result.outcome === "unknown") this.throwOutcomeUnknown();
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
    if (result.outcome === "unknown") this.throwOutcomeUnknown();
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
