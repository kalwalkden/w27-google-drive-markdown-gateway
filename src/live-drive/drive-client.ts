import type { AccessTokenProvider } from "./auth.js";
import type { HttpTransport, RawHttpResponse } from "./http.js";
import { z } from "zod";

const driveOrigin = "https://www.googleapis.com";
const metadataFields =
  "id,name,mimeType,parents,driveId,trashed,appProperties,version,headRevisionId";

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  driveId?: string;
  trashed: boolean;
  appProperties?: Record<string, string>;
  version?: string;
  headRevisionId?: string;
}

export interface DriveSnapshot {
  metadata: DriveFileMetadata;
  etag?: string;
  payload: Uint8Array;
}

export interface DriveResponse<T> {
  status: number;
  etag?: string;
  value?: T;
  /** A minimally parsed file ID from a successful response that otherwise failed strict parsing. */
  candidateId?: string;
  malformed?: boolean;
}

const fileMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string().min(1),
  parents: z.array(z.string()),
  driveId: z.string().min(1).optional(),
  trashed: z.boolean(),
  appProperties: z.record(z.string(), z.string()).optional(),
  version: z.string().optional(),
  headRevisionId: z.string().optional(),
});

function parseMetadata(
  response: RawHttpResponse,
): DriveResponse<DriveFileMetadata> {
  const etag = response.headers.get("etag") ?? undefined;
  if (response.status < 200 || response.status >= 300)
    return { status: response.status, etag };
  if (response.body.length === 0)
    return { status: response.status, etag, malformed: true };
  try {
    const decoded: unknown = JSON.parse(
      new TextDecoder().decode(response.body),
    );
    const candidateId =
      decoded &&
      typeof decoded === "object" &&
      typeof (decoded as { id?: unknown }).id === "string" &&
      (decoded as { id: string }).id.trim().length > 0
        ? (decoded as { id: string }).id
        : undefined;
    const value = fileMetadataSchema.safeParse(decoded);
    return value.success
      ? { status: response.status, etag, value: value.data }
      : { status: response.status, etag, candidateId, malformed: true };
  } catch {
    return { status: response.status, etag, malformed: true };
  }
}

function query(path: string, values: Record<string, string>): URL {
  const url = new URL(path, driveOrigin);
  for (const [key, value] of Object.entries(values))
    url.searchParams.set(key, value);
  return url;
}

export class RawDriveClient {
  constructor(
    readonly label: "actor-a" | "actor-b" | "cleanup",
    private readonly tokenProvider: AccessTokenProvider,
    private readonly transport: HttpTransport,
    private readonly timeoutMs: number,
    private readonly signal?: AbortSignal,
  ) {}

  async getMetadata(fileId: string): Promise<DriveResponse<DriveFileMetadata>> {
    return parseMetadata(
      await this.send(
        "GET",
        query(`/drive/v3/files/${encodeURIComponent(fileId)}`, {
          supportsAllDrives: "true",
          fields: metadataFields,
        }),
      ),
    );
  }

  async download(fileId: string): Promise<DriveResponse<Uint8Array>> {
    const response = await this.send(
      "GET",
      query(`/drive/v3/files/${encodeURIComponent(fileId)}`, {
        alt: "media",
        supportsAllDrives: "true",
      }),
    );
    return {
      status: response.status,
      etag: response.headers.get("etag") ?? undefined,
      value: response.body,
    };
  }

  async create(
    name: string,
    rootId: string,
    content: Uint8Array,
  ): Promise<DriveResponse<DriveFileMetadata>> {
    const boundary = "w27-drive-capability-boundary";
    const metadata = JSON.stringify({
      name,
      mimeType: "text/markdown",
      parents: [rootId],
    });
    const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: text/markdown; charset=utf-8\r\n\r\n`;
    const suffix = `\r\n--${boundary}--\r\n`;
    const body = new Uint8Array([
      ...new TextEncoder().encode(prefix),
      ...content,
      ...new TextEncoder().encode(suffix),
    ]);
    return parseMetadata(
      await this.send(
        "POST",
        query("/upload/drive/v3/files", {
          uploadType: "multipart",
          supportsAllDrives: "true",
          fields: metadataFields,
        }),
        body,
        { "content-type": `multipart/related; boundary=${boundary}` },
      ),
    );
  }

  async updateContent(
    fileId: string,
    content: Uint8Array,
    etag: string,
  ): Promise<DriveResponse<DriveFileMetadata>> {
    return parseMetadata(
      await this.send(
        "PATCH",
        query(`/upload/drive/v3/files/${encodeURIComponent(fileId)}`, {
          uploadType: "media",
          supportsAllDrives: "true",
          fields: metadataFields,
        }),
        content,
        { "content-type": "text/markdown; charset=utf-8", "if-match": etag },
      ),
    );
  }

  async move(
    fileId: string,
    addParent: string,
    removeParent: string,
    etag?: string,
  ): Promise<DriveResponse<DriveFileMetadata>> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (etag) headers["if-match"] = etag;
    return parseMetadata(
      await this.send(
        "PATCH",
        query(`/drive/v3/files/${encodeURIComponent(fileId)}`, {
          addParents: addParent,
          removeParents: removeParent,
          supportsAllDrives: "true",
          fields: metadataFields,
        }),
        new TextEncoder().encode("{}"),
        headers,
      ),
    );
  }

  private async send(
    method: "GET" | "POST" | "PATCH",
    url: URL,
    body?: Uint8Array,
    extraHeaders: Record<string, string> = {},
  ): Promise<RawHttpResponse> {
    const token = await this.tokenProvider.getAccessToken();
    return this.transport.send({
      method,
      url,
      body,
      timeoutMs: this.timeoutMs,
      signal: this.signal,
      headers: { authorization: `Bearer ${token}`, ...extraHeaders },
    });
  }
}
