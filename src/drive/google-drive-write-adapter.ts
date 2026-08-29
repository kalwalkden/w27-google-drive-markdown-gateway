import { randomBytes } from "node:crypto";

import {
  fileId,
  folderId,
  revision,
  type FileId,
  type FolderId,
  type Revision,
} from "../domain/markdown.js";
import type {
  ConditionalWriteResult,
  CreateWriteResult,
  DriveNode,
  RawDriveWritePort,
} from "./drive-port.js";

const driveOrigin = "https://www.googleapis.com";
const metadataFields = "id,name,mimeType,parents,modifiedTime,size,trashed";

export interface GoogleDriveRawHttpRequest {
  readonly method: "POST" | "PATCH";
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface GoogleDriveRawHttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

/** Injected composition seam; it intentionally performs no token or credential work. */
export interface GoogleDriveRawHttp {
  send(request: GoogleDriveRawHttpRequest): Promise<GoogleDriveRawHttpResponse>;
}

export type MultipartBoundaryFactory = () => string;

/** Raw Google mutations using the conditional forms proved by the capability harness. */
export class GoogleDriveWriteAdapter implements RawDriveWritePort {
  constructor(
    private readonly http: GoogleDriveRawHttp,
    private readonly createBoundary: MultipartBoundaryFactory = () =>
      `w27-drive-${randomBytes(24).toString("hex")}`,
  ) {}

  async createFile(
    parentId: FolderId,
    name: string,
    content: string,
  ): Promise<CreateWriteResult> {
    const metadata = JSON.stringify({
      name,
      mimeType: "text/markdown",
      parents: [parentId],
    });
    const boundary = this.safeBoundary(metadata, content);
    if (!boundary) return { outcome: "unsupported" };
    const body = multipartBody(boundary, metadata, content);
    const response = await this.send({
      method: "POST",
      url: driveUrl("/upload/drive/v3/files", {
        uploadType: "multipart",
        supportsAllDrives: "true",
        fields: metadataFields,
      }),
      headers: {
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    return createResult(response);
  }

  async updateFile(
    id: FileId,
    expectedRevision: Revision,
    content: string,
  ): Promise<ConditionalWriteResult> {
    if (!isEntityTag(expectedRevision)) return { outcome: "unsupported" };
    const response = await this.send({
      method: "PATCH",
      url: driveUrl(`/upload/drive/v3/files/${encodeURIComponent(id)}`, {
        uploadType: "media",
        supportsAllDrives: "true",
        fields: metadataFields,
      }),
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "if-match": expectedRevision,
      },
      body: new TextEncoder().encode(content),
    });
    return conditionalResult(response);
  }

  async moveFile(
    id: FileId,
    expectedRevision: Revision,
    sourceFolderId: FolderId,
    destinationFolderId: FolderId,
  ): Promise<ConditionalWriteResult> {
    if (!isEntityTag(expectedRevision)) return { outcome: "unsupported" };
    const response = await this.send({
      method: "PATCH",
      url: driveUrl(`/drive/v3/files/${encodeURIComponent(id)}`, {
        addParents: destinationFolderId,
        removeParents: sourceFolderId,
        supportsAllDrives: "true",
        fields: metadataFields,
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
        "if-match": expectedRevision,
      },
      body: new TextEncoder().encode("{}"),
    });
    return conditionalResult(response);
  }

  private async send(
    request: GoogleDriveRawHttpRequest,
  ): Promise<GoogleDriveRawHttpResponse> {
    try {
      return await this.http.send(request);
    } catch {
      return { status: 0, headers: new Headers(), body: new Uint8Array() };
    }
  }

  private safeBoundary(metadata: string, content: string): string | undefined {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let boundary: string;
      try {
        boundary = this.createBoundary();
      } catch {
        return undefined;
      }
      if (
        /^[A-Za-z0-9'()+_,./:=?-]{16,70}$/u.test(boundary) &&
        !metadata.includes(boundary) &&
        !content.includes(boundary)
      )
        return boundary;
    }
    return undefined;
  }
}

function driveUrl(path: string, values: Record<string, string>): URL {
  const url = new URL(path, driveOrigin);
  for (const [name, value] of Object.entries(values))
    url.searchParams.set(name, value);
  return url;
}

function multipartBody(
  boundary: string,
  metadata: string,
  content: string,
): Uint8Array {
  const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=utf-8\r\n\r\n`;
  const suffix = `\r\n--${boundary}--\r\n`;
  return new Uint8Array([
    ...new TextEncoder().encode(prefix),
    ...new TextEncoder().encode(content),
    ...new TextEncoder().encode(suffix),
  ]);
}

function createResult(response: GoogleDriveRawHttpResponse): CreateWriteResult {
  if (response.status < 200 || response.status >= 300)
    return { outcome: "unsupported" };
  const node = responseNode(response);
  return node ? { outcome: "success", node } : { outcome: "unsupported" };
}

function conditionalResult(
  response: GoogleDriveRawHttpResponse,
): ConditionalWriteResult {
  if (response.status === 412) return { outcome: "conflict" };
  if (response.status < 200 || response.status >= 300)
    return { outcome: "unsupported" };
  const node = responseNode(response);
  return node ? { outcome: "success", node } : { outcome: "unsupported" };
}

function responseNode(
  response: GoogleDriveRawHttpResponse,
): DriveNode | undefined {
  const etag = response.headers.get("etag");
  if (!isEntityTag(etag)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(response.body),
    );
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.trashed !== false) return undefined;
  const id = nonempty(value.id);
  const name = nonempty(value.name);
  const mimeType = nonempty(value.mimeType);
  const modifiedTime = nonempty(value.modifiedTime);
  const size = value.size;
  if (
    !id ||
    !name ||
    !mimeType ||
    !modifiedTime ||
    Number.isNaN(Date.parse(modifiedTime)) ||
    !Array.isArray(value.parents) ||
    !value.parents.every((parent) => nonempty(parent)) ||
    typeof size !== "string" ||
    !/^\d+$/u.test(size) ||
    !Number.isSafeInteger(Number(size))
  )
    return undefined;
  return {
    id: fileId(id),
    name,
    kind: "file",
    parentIds: value.parents.map((parent) => folderId(parent as string)),
    modifiedTime,
    revision: revision(etag),
    size: Number(size),
    mimeType,
  };
}

function nonempty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEntityTag(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:W\/)?"[\x21\x23-\x7E\x80-\xFF]*"$/u.test(value)
  );
}
