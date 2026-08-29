import { describe, expect, it } from "vitest";

import { fileId, folderId, revision } from "../../src/domain/markdown.js";
import {
  GoogleDriveWriteAdapter,
  type GoogleDriveRawHttp,
  type GoogleDriveRawHttpRequest,
} from "../../src/drive/google-drive-write-adapter.js";

const metadata = {
  id: "file",
  name: "new.md",
  mimeType: "text/markdown",
  parents: ["docs"],
  modifiedTime: "2026-08-29T12:00:00.000Z",
  size: "3",
  trashed: false,
};

class CapturingHttp implements GoogleDriveRawHttp {
  readonly requests: GoogleDriveRawHttpRequest[] = [];
  response = {
    status: 200,
    headers: new Headers({ etag: 'W/"next"' }),
    body: new TextEncoder().encode(JSON.stringify(metadata)),
  };

  async send(request: GoogleDriveRawHttpRequest) {
    this.requests.push(request);
    return this.response;
  }
}

describe("GoogleDriveWriteAdapter", () => {
  it("sends multipart creation with a verified parent and preserves response ETag", async () => {
    const http = new CapturingHttp();
    const result = await new GoogleDriveWriteAdapter(http).createFile(
      folderId("docs"),
      "new.md",
      "hey",
    );
    expect(result).toMatchObject({
      outcome: "success",
      node: { revision: revision('W/"next"') },
    });
    const request = http.requests[0];
    expect(request).toMatchObject({ method: "POST" });
    expect(request.url.pathname).toBe("/upload/drive/v3/files");
    expect(request.url.searchParams.get("uploadType")).toBe("multipart");
    expect(request.url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(new TextDecoder().decode(request.body)).toContain(
      '"parents":["docs"]',
    );
  });

  it("replaces a boundary that appears in Markdown content", async () => {
    const http = new CapturingHttp();
    const boundaries = [
      "w27-drive-markdown-boundary",
      "w27-drive-fresh-boundary",
    ];
    const adapter = new GoogleDriveWriteAdapter(
      http,
      () => boundaries.shift() ?? "w27-drive-final-boundary",
    );
    await adapter.createFile(
      folderId("docs"),
      "new.md",
      "w27-drive-markdown-boundary",
    );
    const request = http.requests[0];
    expect(request.headers["content-type"]).toContain(
      "w27-drive-fresh-boundary",
    );
    expect(new TextDecoder().decode(request.body)).toContain(
      "w27-drive-markdown-boundary",
    );
  });

  it("sends an exact quoted ETag once for update and a verified parent move", async () => {
    const http = new CapturingHttp();
    const adapter = new GoogleDriveWriteAdapter(http);
    const etag = revision('W/"opaque-etag"');
    await adapter.updateFile(fileId("a/b"), etag, "hey");
    await adapter.moveFile(
      fileId("file"),
      etag,
      folderId("docs"),
      folderId("archive"),
    );
    expect(http.requests).toHaveLength(2);
    expect(http.requests[0].headers["if-match"]).toBe(etag);
    expect(http.requests[0].url.pathname).toBe("/upload/drive/v3/files/a%2Fb");
    expect(http.requests[0].url.searchParams.get("uploadType")).toBe("media");
    expect(http.requests[1].headers["if-match"]).toBe(etag);
    expect(http.requests[1].url.searchParams.get("addParents")).toBe("archive");
    expect(http.requests[1].url.searchParams.get("removeParents")).toBe("docs");
  });

  it("maps only 412 to conflict and never retries malformed or failed mutations", async () => {
    const http = new CapturingHttp();
    const adapter = new GoogleDriveWriteAdapter(http);
    http.response = {
      status: 412,
      headers: new Headers(),
      body: new Uint8Array(),
    };
    await expect(
      adapter.updateFile(fileId("file"), revision('"old"'), "hey"),
    ).resolves.toEqual({ outcome: "conflict" });
    http.response = {
      status: 503,
      headers: new Headers(),
      body: new Uint8Array(),
    };
    await expect(
      adapter.updateFile(fileId("file"), revision('"old"'), "hey"),
    ).resolves.toEqual({ outcome: "unsupported" });
    expect(http.requests).toHaveLength(2);
  });

  it("fails closed when a successful response lacks a raw ETag", async () => {
    const http = new CapturingHttp();
    http.response = {
      status: 200,
      headers: new Headers(),
      body: new TextEncoder().encode(JSON.stringify(metadata)),
    };
    await expect(
      new GoogleDriveWriteAdapter(http).createFile(
        folderId("docs"),
        "new.md",
        "hey",
      ),
    ).resolves.toEqual({ outcome: "unsupported" });
  });

  it("rejects malformed request or response ETags without a mutation", async () => {
    const http = new CapturingHttp();
    const adapter = new GoogleDriveWriteAdapter(http);
    await expect(
      adapter.updateFile(fileId("file"), revision("not-an-etag"), "hey"),
    ).resolves.toEqual({ outcome: "unsupported" });
    expect(http.requests).toHaveLength(0);
    http.response = {
      status: 200,
      headers: new Headers({ etag: "not-an-etag" }),
      body: new TextEncoder().encode(JSON.stringify(metadata)),
    };
    await expect(
      adapter.createFile(folderId("docs"), "new.md", "hey"),
    ).resolves.toEqual({ outcome: "unsupported" });
  });

  it("refuses unpaired UTF-16 content before constructing an upload", async () => {
    const http = new CapturingHttp();
    const adapter = new GoogleDriveWriteAdapter(http);
    await expect(
      adapter.createFile(folderId("docs"), "new.md", "\ud800"),
    ).resolves.toEqual({ outcome: "unsupported" });
    await expect(
      adapter.updateFile(fileId("file"), revision('"old"'), "\udc00"),
    ).resolves.toEqual({ outcome: "unsupported" });
    expect(http.requests).toHaveLength(0);
  });
});
