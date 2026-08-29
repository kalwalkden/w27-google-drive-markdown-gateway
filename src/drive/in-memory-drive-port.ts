import {
  type FileId,
  type FolderId,
  fileId,
  folderId,
  type Revision,
  revision,
  utf8ByteSize,
} from "../domain/markdown.js";
import type {
  ConditionalWriteResult,
  CreateWriteResult,
  DriveListOptions,
  DriveNode,
  DriveRead,
  DriveReadPort,
  DriveSearchHit,
  RawDriveWritePort,
} from "./drive-port.js";

export interface InMemoryNodeFixture {
  readonly id?: string;
  readonly name: string;
  readonly kind: "folder" | "file" | "shortcut";
  readonly parentIds?: readonly string[];
  readonly content?: string;
  readonly revision?: string;
  readonly modifiedTime?: string;
  readonly mimeType?: string;
}

interface MutableNode
  extends Omit<DriveNode, "parentIds" | "revision" | "size" | "modifiedTime"> {
  parentIds: FolderId[];
  revision?: Revision;
  size?: number;
  modifiedTime: string;
  content?: string;
}

/** A fixture-focused port; malformed parent graphs are intentional test inputs. */
export class InMemoryDrivePort implements DriveReadPort, RawDriveWritePort {
  private readonly nodes = new Map<string, MutableNode>();
  private nextId = 1;
  private nextTick = 0;
  private nextRevision = 1;

  constructor(private readonly epoch = "2026-01-01T00:00:00.000Z") {}

  addFixture(fixture: InMemoryNodeFixture): DriveNode {
    const id = fixture.id ?? `node-${this.nextId++}`;
    if (this.nodes.has(id)) throw new Error(`Duplicate fixture id: ${id}`);
    const isFile = fixture.kind === "file";
    const content = isFile ? (fixture.content ?? "") : undefined;
    const node: MutableNode = {
      id: fixture.kind === "folder" ? folderId(id) : fileId(id),
      name: fixture.name,
      kind: fixture.kind,
      parentIds: (fixture.parentIds ?? []).map(folderId),
      modifiedTime: fixture.modifiedTime ?? this.timestamp(),
      revision: isFile ? revision(fixture.revision ?? "1") : undefined,
      size: isFile ? utf8ByteSize(content ?? "") : undefined,
      mimeType:
        fixture.mimeType ??
        (fixture.kind === "folder"
          ? "application/vnd.google-apps.folder"
          : fixture.kind === "shortcut"
            ? "application/vnd.google-apps.shortcut"
            : "text/markdown"),
      content,
    };
    this.nodes.set(id, node);
    return this.snapshot(node);
  }

  async getNode(id: FileId | FolderId): Promise<DriveNode | undefined> {
    const node = this.nodes.get(id);
    return node ? this.snapshot(node) : undefined;
  }

  async listChildren(
    folder: FolderId,
    options?: DriveListOptions,
  ): Promise<readonly DriveNode[]> {
    const limit = options?.limit;
    const children = [...this.nodes.values()].filter((node) =>
      node.parentIds.includes(folder),
    );
    return (limit === undefined ? children : children.slice(0, limit)).map(
      (node) => this.snapshot(node),
    );
  }

  async listDescendants(
    folder: FolderId,
    options: Readonly<{ recursive: boolean; limit: number }>,
  ): Promise<readonly DriveNode[]> {
    const result: DriveNode[] = [];
    const visit = async (
      parent: FolderId,
      seen: Set<string>,
    ): Promise<void> => {
      if (seen.has(parent) || result.length >= options.limit) return;
      seen.add(parent);
      const children = await this.listChildren(parent);
      for (const child of children) {
        if (result.length >= options.limit) return;
        result.push(child);
        if (options.recursive && child.kind === "folder")
          await visit(child.id as FolderId, seen);
      }
    };
    await visit(folder, new Set());
    return result;
  }

  async searchDirectChildren(
    folder: FolderId,
    query: string,
    limit: number,
  ): Promise<readonly DriveSearchHit[]> {
    const candidates = await this.listChildren(folder);
    const needle = query.toLowerCase();
    return candidates
      .filter((node) => {
        const content = this.nodes.get(node.id)?.content ?? "";
        return (
          node.name.toLowerCase().includes(needle) ||
          content.toLowerCase().includes(needle)
        );
      })
      .slice(0, limit)
      .map((node) => {
        const content = this.nodes.get(node.id)?.content;
        const index = content?.toLowerCase().indexOf(needle) ?? -1;
        return {
          node,
          excerpt:
            index >= 0
              ? content === undefined
                ? undefined
                : excerptAround(content, index, query.length)
              : undefined,
        };
      });
  }

  async searchDescendants(
    folder: FolderId,
    query: string,
    limit: number,
  ): Promise<readonly DriveSearchHit[]> {
    return this.searchDirectChildren(folder, query, limit);
  }

  async readFile(id: FileId): Promise<DriveRead | undefined> {
    const node = this.nodes.get(id);
    if (node?.kind !== "file") return undefined;
    return { node: this.snapshot(node), content: node.content ?? "" };
  }

  async createFile(
    parent: FolderId,
    name: string,
    content: string,
  ): Promise<CreateWriteResult> {
    return {
      outcome: "success",
      node: this.addFixture({
        id: `file-${this.nextId++}`,
        name,
        kind: "file",
        parentIds: [parent],
        content,
        revision: "1",
      }),
    };
  }

  async updateFile(
    id: FileId,
    expected: Revision,
    content: string,
  ): Promise<ConditionalWriteResult> {
    const node = this.nodes.get(id);
    if (node?.kind !== "file") return { outcome: "unsupported" };
    if (node.revision !== expected)
      return { outcome: "conflict", current: this.snapshot(node) };
    node.content = content;
    node.size = utf8ByteSize(content);
    node.revision = this.nextOpaqueRevision();
    node.modifiedTime = this.timestamp();
    return { outcome: "success", node: this.snapshot(node) };
  }

  async moveFile(
    id: FileId,
    expected: Revision,
    _source: FolderId,
    destination: FolderId,
  ): Promise<ConditionalWriteResult> {
    const node = this.nodes.get(id);
    if (node?.kind !== "file") return { outcome: "unsupported" };
    if (
      node.revision !== expected ||
      node.parentIds.length !== 1 ||
      node.parentIds[0] !== _source
    )
      return { outcome: "conflict", current: this.snapshot(node) };
    node.parentIds = [destination];
    node.revision = this.nextOpaqueRevision();
    node.modifiedTime = this.timestamp();
    return { outcome: "success", node: this.snapshot(node) };
  }

  inspect(
    id: string,
  ): Readonly<DriveNode & { readonly content?: string }> | undefined {
    const node = this.nodes.get(id);
    return node
      ? Object.freeze({ ...this.snapshot(node), content: node.content })
      : undefined;
  }

  private timestamp(): string {
    return new Date(
      new Date(this.epoch).getTime() + this.nextTick++,
    ).toISOString();
  }

  private nextOpaqueRevision(): Revision {
    const value = `fake-revision-${String(this.nextRevision).padStart(6, "0")}`;
    this.nextRevision += 1;
    return revision(value);
  }

  private snapshot(node: MutableNode): DriveNode {
    return Object.freeze({
      id: node.id,
      name: node.name,
      kind: node.kind,
      parentIds: Object.freeze([...node.parentIds]),
      modifiedTime: node.modifiedTime,
      revision: node.revision,
      size: node.size,
      mimeType: node.mimeType,
    });
  }
}

function excerptAround(
  content: string,
  index: number,
  queryLength: number,
): string {
  let start = Math.max(0, index - 20);
  let end = Math.min(content.length, index + queryLength + 20);
  if (
    start > 0 &&
    isLowSurrogate(content.charCodeAt(start)) &&
    isHighSurrogate(content.charCodeAt(start - 1))
  ) {
    start -= 1;
  }
  if (
    end < content.length &&
    isHighSurrogate(content.charCodeAt(end - 1)) &&
    isLowSurrogate(content.charCodeAt(end))
  ) {
    end += 1;
  }
  return content.slice(start, end);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
