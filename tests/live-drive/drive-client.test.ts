import { describe, expect, it } from "vitest";

import { RawDriveClient } from "../../src/live-drive/drive-client.js";
import type { AccessTokenProvider } from "../../src/live-drive/auth.js";
import type {
  HttpTransport,
  RawHttpRequest,
  RawHttpResponse,
} from "../../src/live-drive/http.js";

class Token implements AccessTokenProvider {
  async getAccessToken(): Promise<string> {
    return "unit-test-token";
  }
}

class CaptureTransport implements HttpTransport {
  requests: RawHttpRequest[] = [];
  body = new TextEncoder().encode(
    '{"id":"f","name":"n","mimeType":"text/markdown","parents":["p"],"trashed":false}',
  );

  async send(request: RawHttpRequest): Promise<RawHttpResponse> {
    this.requests.push(request);
    return {
      status: 200,
      headers: new Headers({ ETag: 'W/"raw-etag"' }),
      body: this.body,
    };
  }
}

describe("RawDriveClient", () => {
  it("uses encoded raw requests, all-drive flags, and the exact supplied ETag", async () => {
    const transport = new CaptureTransport();
    const client = new RawDriveClient("actor-a", new Token(), transport, 1_000);
    await client.getMetadata("file / ?");
    await client.updateContent(
      "file / ?",
      new TextEncoder().encode("markdown"),
      'W/"raw-etag"',
    );
    const [metadata, update] = transport.requests;
    expect(metadata.url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(metadata.url.pathname).toContain("file%20%2F%20%3F");
    expect(update.headers.authorization).toBe("Bearer unit-test-token");
    expect(update.headers["if-match"]).toBe('W/"raw-etag"');
    expect(update.url.searchParams.get("uploadType")).toBe("media");
    expect(update.url.searchParams.get("fields")).toContain("headRevisionId");
  });

  it("rejects malformed successful metadata without parsing error bodies", async () => {
    const transport = new CaptureTransport();
    transport.body = new TextEncoder().encode('{"error":"not-a-file"}');
    const client = new RawDriveClient("actor-a", new Token(), transport, 1_000);
    await expect(client.getMetadata("file")).resolves.toMatchObject({
      status: 200,
      malformed: true,
    });
  });

  it("retains only a minimally parsed candidate ID from malformed successful create metadata", async () => {
    const transport = new CaptureTransport();
    transport.body = new TextEncoder().encode('{"id":"created-file"}');
    const client = new RawDriveClient("actor-a", new Token(), transport, 1_000);
    await expect(
      client.create("probe.md", "root", new TextEncoder().encode("probe")),
    ).resolves.toMatchObject({
      status: 200,
      candidateId: "created-file",
      malformed: true,
    });
  });
});
