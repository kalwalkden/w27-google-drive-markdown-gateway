import {
  type FileId,
  type FolderId,
  fileId,
  folderId,
  isMarkdownName,
  isWellFormedUtf16,
  revision,
} from "../domain/markdown.js";
import { DriveListOverflowError } from "./drive-port.js";
import type {
  DriveListOptions,
  DriveNode,
  DriveRead,
  DriveReadPort,
  DriveSearchHit,
} from "./drive-port.js";
import {
  createGoogleDriveApi,
  type GoogleDriveApi,
  type GoogleDriveAuthConfig,
} from "./google-drive-auth.js";
import {
  DriveProviderError as GoogleDriveProviderError,
  type DriveProviderOperation as ProviderOperation,
} from "./provider-error.js";

export {
  DriveProviderError as GoogleDriveProviderError,
  type DriveProviderFailure as GoogleDriveProviderFailure,
} from "./provider-error.js";

const folderMimeType = "application/vnd.google-apps.folder";
const shortcutMimeType = "application/vnd.google-apps.shortcut";
const metadataFields =
  "id,name,mimeType,parents,modifiedTime,size,trashed,driveId,shortcutDetails";
const defaultMaxReadBytes = 1_000_000;
const defaultMaxTraversalNodes = 1_000;
const defaultMaxPages = 100;
const defaultRootCacheTtlMs = 60_000;
const notFound = Symbol("google-drive-not-found");

export type GoogleDriveReadAdapterConfig = Readonly<{
  rootFolderId: FolderId;
  auth: GoogleDriveAuthConfig;
  /** The expected Shared Drive ID; forbidden for My Drive mode. */
  sharedDriveId?: string;
  maxReadBytes?: number;
  maxTraversalNodes?: number;
  maxPages?: number;
  rootCacheTtlMs?: number;
}>;

interface RootContext {
  readonly node: DriveNode;
  readonly driveId?: string;
  readonly expiresAt: number;
}

interface DriveFileResource {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly mimeType?: unknown;
  readonly parents?: unknown;
  readonly modifiedTime?: unknown;
  readonly size?: unknown;
  readonly trashed?: unknown;
  readonly driveId?: unknown;
}

export class GoogleDriveReadAdapter implements DriveReadPort {
  private readonly maxReadBytes: number;
  private readonly maxTraversalNodes: number;
  private readonly maxPages: number;
  private readonly rootCacheTtlMs: number;
  private root?: RootContext;
  private rootPromise?: Promise<RootContext>;
  private rootGeneration = 0;

  constructor(
    private readonly config: GoogleDriveReadAdapterConfig,
    private readonly api: GoogleDriveApi = createGoogleDriveApi(config.auth),
    private readonly now: () => number = Date.now,
  ) {
    this.maxReadBytes = config.maxReadBytes ?? defaultMaxReadBytes;
    this.maxTraversalNodes =
      config.maxTraversalNodes ?? defaultMaxTraversalNodes;
    this.maxPages = config.maxPages ?? defaultMaxPages;
    this.rootCacheTtlMs = config.rootCacheTtlMs ?? defaultRootCacheTtlMs;
    this.validateConfig();
  }

  invalidateRootContext(): void {
    this.root = undefined;
    this.rootGeneration += 1;
  }

  async getNode(id: FileId | FolderId): Promise<DriveNode | undefined> {
    this.assertWellFormedId(id, "get-metadata");
    const root = await this.ensureRoot();
    if (id === this.config.rootFolderId) return root.node;
    return this.fetchMetadata(id, "get-metadata");
  }

  async listChildren(
    folder: FolderId,
    options?: DriveListOptions,
  ): Promise<readonly DriveNode[]> {
    this.assertWellFormedId(folder, "list-children");
    const limit = options?.limit ?? this.maxTraversalNodes;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new GoogleDriveProviderError("configuration", "list-children");
    const enumerationLimit = Math.min(limit, this.maxTraversalNodes);
    const overflowSignal =
      options?.overflowSignal === true && enumerationLimit === limit;
    const root = await this.ensureRoot();
    const result: DriveNode[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      if (pages >= this.maxPages)
        throw new GoogleDriveProviderError("limit", "list-children");
      const data = await this.callList({
        q: `'${escapeDriveQueryLiteral(folder)}' in parents and trashed = false`,
        fields: `nextPageToken,files(${metadataFields})`,
        pageSize: Math.min(100, enumerationLimit - result.length),
        pageToken,
        supportsAllDrives: true,
        ...(root.driveId
          ? {
              corpora: "drive",
              driveId: root.driveId,
              includeItemsFromAllDrives: true,
            }
          : { corpora: "user" }),
      });
      pages += 1;
      const page = parseListResource(data, "list-children");
      const remaining = enumerationLimit - result.length;
      if (
        overflowSignal &&
        result.length + page.files.length >= enumerationLimit
      )
        throw new DriveListOverflowError();
      if (page.files.length > remaining)
        throw new GoogleDriveProviderError("limit", "list-children");
      for (const resource of page.files) {
        const candidate = normalizeNode(resource, "list-children");
        if (candidate.kind !== "file") {
          result.push(candidate);
          continue;
        }
        const current = await this.fetchMetadata(
          candidate.id as FileId,
          "get-metadata",
        );
        if (!current)
          throw new GoogleDriveProviderError("malformed", "list-children");
        result.push(current);
      }
      pageToken = page.nextPageToken;
      if (pageToken && result.length === enumerationLimit) {
        throw new GoogleDriveProviderError("limit", "list-children");
      }
    } while (pageToken);
    return result;
  }

  async listDescendants(
    folder: FolderId,
    options: Readonly<{ recursive: boolean; limit: number }>,
  ): Promise<readonly DriveNode[]> {
    this.assertWellFormedId(folder, "list-children");
    if (
      typeof options.recursive !== "boolean" ||
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1
    )
      throw new GoogleDriveProviderError("configuration", "list-children");
    await this.ensureRoot();
    const result: DriveNode[] = [];
    const queue: FolderId[] = [folder];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      if (visited.size >= this.maxTraversalNodes)
        throw new GoogleDriveProviderError("limit", "list-children");
      visited.add(current);
      for (const child of await this.listChildren(current)) {
        if (
          result.length >= options.limit ||
          result.length >= this.maxTraversalNodes
        )
          throw new GoogleDriveProviderError("limit", "list-children");
        result.push(child);
        if (options.recursive && child.kind === "folder") {
          if (queue.length + visited.size >= this.maxTraversalNodes)
            throw new GoogleDriveProviderError("limit", "list-children");
          queue.push(child.id as FolderId);
        }
      }
    }
    return result;
  }

  async searchDirectChildren(
    folder: FolderId,
    query: string,
    limit: number,
  ): Promise<readonly DriveSearchHit[]> {
    this.assertWellFormedId(folder, "list-children");
    if (
      typeof query !== "string" ||
      query.length === 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > this.maxTraversalNodes
    )
      throw new GoogleDriveProviderError("configuration", "list-children");
    // This legacy-shaped port method is intentionally limited to direct
    // children. An ancestor chain has no Drive precondition that can bind a
    // content download to the topology inspected before it.
    if (folder !== this.config.rootFolderId)
      throw new GoogleDriveProviderError("configuration", "list-children");
    const candidates = await this.listChildren(folder);
    const needle = query.toLocaleLowerCase();
    const result: DriveSearchHit[] = [];
    for (const candidate of candidates) {
      const nameMatch = candidate.name.toLocaleLowerCase().includes(needle);
      if (nameMatch) {
        result.push({ node: candidate });
        continue;
      }
      if (candidate.kind !== "file") {
        continue;
      }
      if (
        !isMarkdownName(candidate.name) ||
        candidate.size === undefined ||
        candidate.size > this.maxReadBytes ||
        candidate.mimeType?.startsWith("application/vnd.google-apps.")
      ) {
        continue;
      }
      const read = await this.readFile(candidate.id as FileId);
      if (!read) continue;
      const matchIndex = read.content.toLocaleLowerCase().indexOf(needle);
      if (matchIndex >= 0) {
        result.push({
          node: read.node,
          ...(matchIndex >= 0
            ? { excerpt: excerptAround(read.content, matchIndex, query.length) }
            : {}),
        });
      }
    }
    return result;
  }

  async searchDescendants(
    folder: FolderId,
    query: string,
    limit: number,
  ): Promise<readonly DriveSearchHit[]> {
    return this.searchDirectChildren(folder, query, limit);
  }

  async readFile(id: FileId): Promise<DriveRead | undefined> {
    this.assertWellFormedId(id, "read-media");
    await this.ensureRoot();
    const node = await this.fetchMetadata(id, "get-metadata");
    if (!node) return undefined;
    this.assertDirectRootChild(node);
    if (
      node.kind !== "file" ||
      node.size === undefined ||
      node.revision === undefined ||
      node.size > this.maxReadBytes ||
      node.mimeType?.startsWith("application/vnd.google-apps.")
    ) {
      throw new GoogleDriveProviderError("malformed", "read-media");
    }
    const response = await this.callGet(
      {
        fileId: id,
        alt: "media",
        responseType: "arraybuffer",
        supportsAllDrives: true,
      },
      "read-media",
    );
    if (response === notFound)
      throw new GoogleDriveProviderError("not-found", "read-media");
    const bytes = toBytes(response.data);
    if (bytes.byteLength > this.maxReadBytes || bytes.byteLength !== node.size)
      throw new GoogleDriveProviderError("malformed", "read-media");
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new GoogleDriveProviderError("malformed", "read-media");
    }
    const after = await this.fetchMetadata(id, "get-metadata");
    if (!after || !sameNodeFacts(node, after))
      throw new GoogleDriveProviderError("malformed", "read-media");
    this.assertDirectRootChild(after);
    return { node: after, content };
  }

  private assertDirectRootChild(node: DriveNode): void {
    if (
      node.parentIds.length !== 1 ||
      node.parentIds[0] !== this.config.rootFolderId
    ) {
      throw new GoogleDriveProviderError("configuration", "read-media");
    }
  }

  private validateConfig(): void {
    if (
      typeof this.config.rootFolderId !== "string" ||
      this.config.rootFolderId.trim().length === 0 ||
      !isWellFormedUtf16(this.config.rootFolderId)
    )
      throw new GoogleDriveProviderError("configuration", "root-validation");
    for (const value of [
      this.maxReadBytes,
      this.maxTraversalNodes,
      this.maxPages,
      this.rootCacheTtlMs,
    ]) {
      if (!Number.isSafeInteger(value) || value < 1)
        throw new GoogleDriveProviderError("configuration", "root-validation");
    }
    if (
      this.config.auth.mode === "shared-drive-adc" &&
      (typeof this.config.sharedDriveId !== "string" ||
        this.config.sharedDriveId.trim().length === 0 ||
        !isWellFormedUtf16(this.config.sharedDriveId))
    ) {
      throw new GoogleDriveProviderError("configuration", "root-validation");
    }
    if (
      this.config.auth.mode === "my-drive-refresh-token" &&
      this.config.sharedDriveId !== undefined
    ) {
      throw new GoogleDriveProviderError("configuration", "root-validation");
    }
    if (
      this.config.auth.mode === "my-drive-refresh-token" &&
      Object.values(this.config.auth.credentials).some(
        (credential) =>
          typeof credential !== "string" || credential.trim().length === 0,
      )
    ) {
      throw new GoogleDriveProviderError("configuration", "root-validation");
    }
  }

  private async ensureRoot(): Promise<RootContext> {
    if (this.root && this.root.expiresAt > this.sampleNow()) return this.root;
    if (this.rootPromise) return this.rootPromise;
    const generation = this.rootGeneration;
    const pending = this.validateRoot(generation);
    this.rootPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.rootPromise === pending) this.rootPromise = undefined;
    }
  }

  private async validateRoot(generation: number): Promise<RootContext> {
    const rootResource = await this.fetchMetadataWithDriveId(
      this.config.rootFolderId,
      "root-validation",
    );
    const root = rootResource?.node;
    if (!root || root.id !== this.config.rootFolderId || root.kind !== "folder")
      throw new GoogleDriveProviderError("configuration", "root-validation");
    const driveId = this.driveIdForRoot(rootResource.driveId);
    const context = {
      node: root,
      driveId,
      expiresAt: this.sampleNow() + this.rootCacheTtlMs,
    };
    if (generation === this.rootGeneration) this.root = context;
    return context;
  }

  private driveIdForRoot(rootDriveId: string | undefined): string | undefined {
    if (this.config.auth.mode === "shared-drive-adc") {
      if (rootDriveId !== this.config.sharedDriveId)
        throw new GoogleDriveProviderError("configuration", "root-validation");
      return rootDriveId;
    }
    if (rootDriveId !== undefined)
      throw new GoogleDriveProviderError("configuration", "root-validation");
    return undefined;
  }

  private async fetchMetadata(
    id: FileId | FolderId,
    operation: ProviderOperation,
  ): Promise<DriveNode | undefined> {
    return (await this.fetchMetadataWithDriveId(id, operation))?.node;
  }

  private async fetchMetadataWithDriveId(
    id: FileId | FolderId,
    operation: ProviderOperation,
  ): Promise<Readonly<{ node: DriveNode; driveId?: string }> | undefined> {
    this.assertWellFormedId(id, operation);
    const response = await this.callGet(
      { fileId: id, fields: metadataFields, supportsAllDrives: true },
      operation,
    );
    if (response === notFound) return undefined;
    const resource = response.data as DriveFileResource;
    const node = normalizeNode(
      resource,
      operation,
      headerValue(response.headers, "etag"),
    );
    if (node.id !== id) {
      throw new GoogleDriveProviderError("malformed", operation);
    }
    return {
      node,
      driveId: requiredOptionalWellFormedString(resource.driveId, operation),
    };
  }

  private assertWellFormedId(id: unknown, operation: ProviderOperation): void {
    if (typeof id !== "string" || id.length === 0 || !isWellFormedUtf16(id)) {
      throw new GoogleDriveProviderError("configuration", operation);
    }
  }

  private async callGet(
    request: Readonly<Record<string, unknown>>,
    operation: ProviderOperation,
  ): Promise<Readonly<{ data: unknown; headers?: unknown }> | typeof notFound> {
    try {
      return await this.api.files.get(request);
    } catch (error) {
      const failure = normalizeFailure(error, operation);
      if (failure.failure === "not-found" && operation === "get-metadata")
        return notFound;
      throw failure;
    }
  }

  private sampleNow(): number {
    let value: number;
    try {
      value = this.now();
    } catch {
      throw new GoogleDriveProviderError("configuration", "root-validation");
    }
    if (!Number.isFinite(value))
      throw new GoogleDriveProviderError("configuration", "root-validation");
    return value;
  }

  private async callList(
    request: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    try {
      return (await this.api.files.list(request)).data;
    } catch (error) {
      throw normalizeFailure(error, "list-children");
    }
  }
}

export function createGoogleDriveReadAdapter(
  config: GoogleDriveReadAdapterConfig,
): GoogleDriveReadAdapter {
  return new GoogleDriveReadAdapter(config);
}

function parseListResource(
  value: unknown,
  operation: ProviderOperation,
): { files: readonly DriveFileResource[]; nextPageToken?: string } {
  if (!isRecord(value) || !Array.isArray(value.files))
    throw new GoogleDriveProviderError("malformed", operation);
  if (
    value.nextPageToken !== undefined &&
    (typeof value.nextPageToken !== "string" ||
      value.nextPageToken.length === 0)
  ) {
    throw new GoogleDriveProviderError("malformed", operation);
  }
  return {
    files: value.files as DriveFileResource[],
    nextPageToken: value.nextPageToken,
  };
}

function normalizeNode(
  value: DriveFileResource,
  operation: ProviderOperation,
  rawEtag?: string,
): DriveNode {
  if (!isRecord(value))
    throw new GoogleDriveProviderError("malformed", operation);
  const id = requiredWellFormedString(value.id, operation);
  const name = requiredWellFormedString(value.name, operation);
  const mimeType = requiredWellFormedString(value.mimeType, operation);
  const modifiedTime = requiredTimestamp(value.modifiedTime, operation);
  if (value.trashed !== false)
    throw new GoogleDriveProviderError("malformed", operation);
  if (
    !Array.isArray(value.parents) ||
    !value.parents.every(
      (parent) =>
        typeof parent === "string" &&
        parent.length > 0 &&
        isWellFormedUtf16(parent),
    )
  )
    throw new GoogleDriveProviderError("malformed", operation);
  const parentIds = value.parents.map(folderId);
  if (mimeType === folderMimeType) {
    return {
      id: folderId(id),
      name,
      kind: "folder",
      parentIds,
      modifiedTime,
      mimeType,
    };
  }
  if (mimeType === shortcutMimeType) {
    return {
      id: fileId(id),
      name,
      kind: "shortcut",
      parentIds,
      modifiedTime,
      mimeType,
    };
  }
  const size = parseSize(value.size, operation);
  return {
    id: fileId(id),
    name,
    kind: "file",
    parentIds,
    modifiedTime,
    // A file never receives a synthetic revision; list results are refreshed via
    // metadata GET so every visible mutable document carries its raw HTTP ETag.
    revision: isEntityTag(rawEtag) ? revision(rawEtag) : undefined,
    size,
    mimeType,
  };
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (!isRecord(headers)) return undefined;
  if (typeof headers.get === "function") {
    try {
      const value = headers.get(name);
      if (typeof value === "string" && value.length > 0) return value;
    } catch {
      return undefined;
    }
  }
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isEntityTag(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:W\/)?"[\x21\x23-\x7E\x80-\xFF]*"$/u.test(value)
  );
}

function normalizeFailure(
  error: unknown,
  operation: ProviderOperation,
): GoogleDriveProviderError {
  if (error instanceof GoogleDriveProviderError) return error;
  const status = statusFromError(error);
  if (status === 401 || status === 403)
    return new GoogleDriveProviderError("authentication", operation, status);
  if (status === 404)
    return new GoogleDriveProviderError("not-found", operation, status);
  if (status === 429)
    return new GoogleDriveProviderError("throttled", operation, status);
  if (status !== undefined && status >= 500)
    return new GoogleDriveProviderError("transient", operation, status);
  return new GoogleDriveProviderError("transient", operation, status);
}

function statusFromError(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const response = error.response;
  if (isRecord(response) && typeof response.status === "number")
    return response.status;
  return typeof error.status === "number" ? error.status : undefined;
}

function requiredString(value: unknown, operation: ProviderOperation): string {
  if (!isNonemptyString(value))
    throw new GoogleDriveProviderError("malformed", operation);
  return value;
}

function requiredWellFormedString(
  value: unknown,
  operation: ProviderOperation,
): string {
  const result = requiredString(value, operation);
  if (!isWellFormedUtf16(result))
    throw new GoogleDriveProviderError("malformed", operation);
  return result;
}

function requiredOptionalWellFormedString(
  value: unknown,
  operation: ProviderOperation,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredWellFormedString(value, operation);
}

function requiredTimestamp(
  value: unknown,
  operation: ProviderOperation,
): string {
  const timestamp = requiredString(value, operation);
  if (Number.isNaN(Date.parse(timestamp)))
    throw new GoogleDriveProviderError("malformed", operation);
  return timestamp;
}

function parseSize(value: unknown, operation: ProviderOperation): number {
  if (typeof value !== "string" || !/^\d+$/u.test(value))
    throw new GoogleDriveProviderError("malformed", operation);
  const size = Number(value);
  if (!Number.isSafeInteger(size))
    throw new GoogleDriveProviderError("malformed", operation);
  return size;
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function excerptAround(
  content: string,
  index: number,
  queryLength: number,
): string {
  return sliceWellFormedUtf16(
    content,
    Math.max(0, index - 20),
    index + queryLength + 20,
  );
}

function sliceWellFormedUtf16(
  value: string,
  start: number,
  end: number,
): string {
  let safeStart = Math.max(0, Math.min(start, value.length));
  let safeEnd = Math.max(safeStart, Math.min(end, value.length));
  if (
    safeStart > 0 &&
    isLowSurrogate(value.charCodeAt(safeStart)) &&
    isHighSurrogate(value.charCodeAt(safeStart - 1))
  ) {
    safeStart -= 1;
  }
  if (
    safeEnd < value.length &&
    isHighSurrogate(value.charCodeAt(safeEnd - 1)) &&
    isLowSurrogate(value.charCodeAt(safeEnd))
  ) {
    safeEnd += 1;
  }
  return value.slice(safeStart, safeEnd);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function sameNodeFacts(left: DriveNode, right: DriveNode): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.kind === right.kind &&
    left.mimeType === right.mimeType &&
    left.revision === right.revision &&
    left.size === right.size &&
    left.modifiedTime === right.modifiedTime &&
    left.parentIds.length === right.parentIds.length &&
    left.parentIds.every((parent, index) => parent === right.parentIds[index])
  );
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new GoogleDriveProviderError("malformed", "read-media");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
