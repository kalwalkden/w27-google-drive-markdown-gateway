import { describe, expect, it } from "vitest";

import { MarkdownService } from "../../src/application/markdown-service.js";
import { fileId, folderId, revision } from "../../src/domain/markdown.js";
import type { GoogleDriveApi } from "../../src/drive/google-drive-auth.js";
import {
  GoogleDriveProviderError,
  GoogleDriveReadAdapter,
} from "../../src/drive/google-drive-read-adapter.js";

type Resource = Readonly<{
  id: string;
  name: string;
  mimeType: string;
  parents: readonly string[];
  modifiedTime?: string;
  size?: string;
  trashed?: boolean;
  driveId?: string;
}>;

const timestamp = "2026-08-29T12:00:00.000Z";

function folder(
  id: string,
  name: string,
  parents: readonly string[] = [],
  driveId?: string,
): Resource {
  return {
    id,
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents,
    modifiedTime: timestamp,
    trashed: false,
    ...(driveId === undefined ? {} : { driveId }),
  };
}

function file(
  id: string,
  name: string,
  parents: readonly string[],
  content: string,
): Resource {
  return {
    id,
    name,
    mimeType: "text/markdown",
    parents,
    modifiedTime: timestamp,
    size: String(new TextEncoder().encode(content).byteLength),
    trashed: false,
  };
}

class FakeDriveApi implements GoogleDriveApi {
  readonly gets: Readonly<Record<string, unknown>>[] = [];
  readonly lists: Readonly<Record<string, unknown>>[] = [];
  readonly resources = new Map<string, Resource>();
  readonly media = new Map<string, Uint8Array>();
  readonly etags = new Map<string, string>();
  nextPages = new Map<string, readonly Resource[][]>();
  error?: unknown;
  beforeGet?: (request: Readonly<Record<string, unknown>>) => void;

  readonly files = {
    get: async (request: Readonly<Record<string, unknown>>) => {
      this.gets.push(request);
      this.beforeGet?.(request);
      if (this.error) throw this.error;
      const id = request.fileId as string;
      if (request.alt === "media") return { data: this.media.get(id) };
      const resource = this.resources.get(id);
      if (!resource) throw { response: { status: 404, data: "hidden" } };
      return {
        data: resource,
        headers: new Headers({ etag: this.etags.get(id) ?? `"${id}-etag"` }),
      };
    },
    list: async (request: Readonly<Record<string, unknown>>) => {
      this.lists.push(request);
      if (this.error) throw this.error;
      const query = request.q as string;
      const parent = /'(.+)' in parents/u.exec(query)?.[1];
      const pages = this.nextPages.get(parent ?? "") ?? [
        [...this.resources.values()].filter(
          (resource) =>
            resource.parents.length === 1 && resource.parents[0] === parent,
        ),
      ];
      const index =
        request.pageToken === undefined ? 0 : Number(request.pageToken);
      return {
        data: {
          files: pages[index] ?? [],
          ...(index + 1 < pages.length
            ? { nextPageToken: String(index + 1) }
            : {}),
        },
      };
    },
  };
}

function adapter(api: FakeDriveApi, overrides = {}) {
  return new GoogleDriveReadAdapter(
    {
      rootFolderId: folderId("root"),
      auth: {
        mode: "my-drive-refresh-token",
        credentials: { clientId: "c", clientSecret: "s", refreshToken: "r" },
      },
      maxReadBytes: 64,
      maxTraversalNodes: 10,
      maxPages: 4,
      rootCacheTtlMs: 60_000,
      ...overrides,
    },
    api,
  );
}

describe("GoogleDriveReadAdapter", () => {
  it("validates and coalesces the configured root before narrow, paginated child lists", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("one", file("one", "one.md", ["root"], "one"));
    api.resources.set("two", file("two", "two.md", ["root"], "two"));
    api.nextPages.set("root", [
      [api.resources.get("one") as Resource],
      [api.resources.get("two") as Resource],
    ]);
    const drive = adapter(api);

    const [first, second] = await Promise.all([
      drive.listChildren(folderId("root")),
      drive.listChildren(folderId("root")),
    ]);

    expect(first.map((node) => node.name)).toEqual(["one.md", "two.md"]);
    expect(second.map((node) => node.name)).toEqual(["one.md", "two.md"]);
    expect(api.gets.length).toBeGreaterThanOrEqual(1);
    expect(
      api.lists.every(
        (request) => request.q === "'root' in parents and trashed = false",
      ),
    ).toBe(true);
    expect(api.lists[0]).toMatchObject({
      supportsAllDrives: true,
      corpora: "user",
      fields: expect.stringContaining("files(id,name,mimeType,parents"),
    });
    for (const request of [...api.gets, ...api.lists])
      expect(String(request.fields ?? "")).not.toMatch(
        /(?:^|,)etag(?:,|$|\))/u,
      );
    expect(api.lists.some((request) => request.pageToken === "1")).toBe(true);
    drive.invalidateRootContext();
    await drive.listChildren(folderId("root"));
    expect(api.gets.length).toBeGreaterThanOrEqual(2);
  });

  it("expires root validation without authorizing a stale root after a failed refresh", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("one", file("one", "one.md", ["root"], "one"));
    let now = 0;
    const clocked = new GoogleDriveReadAdapter(
      {
        rootFolderId: folderId("root"),
        auth: {
          mode: "my-drive-refresh-token",
          credentials: { clientId: "c", clientSecret: "s", refreshToken: "r" },
        },
        rootCacheTtlMs: 10,
      },
      api,
      () => now,
    );

    await expect(clocked.listChildren(folderId("root"))).resolves.toHaveLength(
      1,
    );
    const initialGetCount = api.gets.length;
    now = 11;
    api.error = { response: { status: 503, data: "provider-private" } };
    await expect(clocked.listChildren(folderId("root"))).rejects.toMatchObject({
      failure: "transient",
      operation: "root-validation",
    });
    expect(api.gets).toHaveLength(initialGetCount + 1);
    expect(api.lists).toHaveLength(1);

    api.error = undefined;
    await expect(clocked.listChildren(folderId("root"))).resolves.toHaveLength(
      1,
    );
    expect(api.gets).toHaveLength(initialGetCount + 3);
  });

  it("signals an opaque overflow before parsing or fetching the final raw child", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("one", file("one", "one.md", ["root"], "one"));
    api.resources.set("two", file("two", "two.md", ["root"], "two"));
    api.resources.set("three", file("three", "three.md", ["root"], "three"));
    api.nextPages.set("root", [
      [
        api.resources.get("one") as Resource,
        api.resources.get("two") as Resource,
      ],
      [{ ...(api.resources.get("three") as Resource), id: "\ud800" }],
    ]);

    await expect(
      adapter(api).listChildren(folderId("root"), {
        limit: 3,
        overflowSignal: true,
      }),
    ).rejects.toMatchObject({ name: "DriveListOverflowError" });
    expect(api.lists).toHaveLength(2);
    expect(api.lists[0]).toMatchObject({ pageSize: 3 });
    expect(api.gets.map((request) => request.fileId)).toEqual([
      "root",
      "one",
      "two",
    ]);

    const service = new MarkdownService(
      adapter(api, { maxTraversalNodes: 2 }),
      {
        rootFolderId: folderId("root"),
        archiveFolderId: folderId("archive"),
        maxListResults: 2,
      },
    );
    await expect(service.listMarkdown()).rejects.toMatchObject({
      code: "RESULT_LIMIT",
    });
    expect(api.gets.map((request) => request.fileId)).not.toContain("\ud800");
  });

  it("accepts an exact complete page at the enumeration limit", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("one", file("one", "one.md", ["root"], "one"));
    api.resources.set("two", file("two", "two.md", ["root"], "two"));
    api.nextPages.set("root", [
      [
        api.resources.get("one") as Resource,
        api.resources.get("two") as Resource,
      ],
    ]);

    await expect(
      adapter(api).listChildren(folderId("root"), { limit: 2 }),
    ).resolves.toMatchObject([{ id: fileId("one") }, { id: fileId("two") }]);
    expect(api.lists).toHaveLength(1);
  });

  it("rejects a list overflow before metadata or output exposure", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("one", file("one", "one.md", ["root"], "one"));
    api.resources.set("two", file("two", "two.md", ["root"], "two"));
    api.nextPages.set("root", [
      [api.resources.get("one") as Resource],
      [api.resources.get("two") as Resource],
    ]);
    const service = new MarkdownService(adapter(api), {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("archive"),
      maxListResults: 1,
    });

    await expect(service.listMarkdown()).rejects.toMatchObject({
      code: "RESULT_LIMIT",
    });
    expect(api.lists).toHaveLength(4);
    expect(api.gets.map((request) => request.fileId)).toContain("one");
  });

  it("fails closed when the enumeration cap has a next page or an oversized page", async () => {
    const nextPageApi = new FakeDriveApi();
    nextPageApi.resources.set("root", folder("root", "root"));
    nextPageApi.resources.set("one", file("one", "one.md", ["root"], "one"));
    nextPageApi.resources.set("two", file("two", "two.md", ["root"], "two"));
    nextPageApi.nextPages.set("root", [
      [nextPageApi.resources.get("one") as Resource],
      [nextPageApi.resources.get("two") as Resource],
    ]);
    await expect(
      adapter(nextPageApi).listChildren(folderId("root"), { limit: 1 }),
    ).rejects.toMatchObject({ failure: "limit", operation: "list-children" });
    expect(nextPageApi.lists).toHaveLength(1);

    const overflowApi = new FakeDriveApi();
    overflowApi.resources.set("root", folder("root", "root"));
    overflowApi.resources.set("one", file("one", "one.md", ["root"], "one"));
    overflowApi.resources.set("two", file("two", "two.md", ["root"], "two"));
    overflowApi.nextPages.set("root", [
      [
        overflowApi.resources.get("one") as Resource,
        overflowApi.resources.get("two") as Resource,
      ],
    ]);
    await expect(
      adapter(overflowApi).listChildren(folderId("root"), { limit: 1 }),
    ).rejects.toMatchObject({ failure: "limit", operation: "list-children" });
    expect(overflowApi.gets.map((request) => request.fileId)).toEqual(["root"]);
  });

  it("never lets later-page duplicates reach path resolution, search, or create checks", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("one", file("one", "same.md", ["root"], "one"));
    api.resources.set("two", file("two", "same.md", ["root"], "two"));
    api.nextPages.set("root", [
      [api.resources.get("one") as Resource],
      [api.resources.get("two") as Resource],
    ]);
    const drive = adapter(api, { maxTraversalNodes: 1 });
    const service = new MarkdownService(drive, {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("archive"),
    });

    await expect(
      service.readMarkdown({ path: "same.md" }),
    ).rejects.toMatchObject({ code: "RESULT_LIMIT" });
    await expect(
      drive.searchDirectChildren(folderId("root"), "same", 1),
    ).rejects.toMatchObject({ failure: "limit", operation: "list-children" });
    await expect(
      service
        .openWriteSession()
        .createMarkdown({ path: "new.md", content: "new" }),
    ).rejects.toMatchObject({ code: "RESULT_LIMIT" });
  });

  it("uses the validated Shared Drive corpus and rejects a root topology mismatch", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root", [], "shared"));
    const shared = new GoogleDriveReadAdapter(
      {
        rootFolderId: folderId("root"),
        sharedDriveId: "shared",
        auth: { mode: "shared-drive-adc" },
      },
      api,
    );
    await shared.listChildren(folderId("root"));
    expect(api.lists[0]).toMatchObject({
      corpora: "drive",
      driveId: "shared",
      includeItemsFromAllDrives: true,
    });

    const wrong = adapter(api);
    await expect(wrong.listChildren(folderId("root"))).rejects.toMatchObject({
      failure: "configuration",
      operation: "root-validation",
    });
  });

  it("retains duplicate names, does not traverse shortcuts, and fails at traversal bounds", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("folder", folder("folder", "folder", ["root"]));
    api.resources.set("shortcut", {
      id: "shortcut",
      name: "jump.md",
      mimeType: "application/vnd.google-apps.shortcut",
      parents: ["root"],
      modifiedTime: timestamp,
      trashed: false,
    });
    api.resources.set("left", file("left", "same.md", ["root"], "left"));
    api.resources.set("right", file("right", "same.md", ["root"], "right"));
    api.resources.set(
      "nested",
      file("nested", "nested.md", ["folder"], "nested"),
    );
    const drive = adapter(api);

    const listed = await drive.listDescendants(folderId("root"), {
      recursive: true,
      limit: 10,
    });
    expect(listed.filter((node) => node.name === "same.md")).toHaveLength(2);
    expect(listed.map((node) => node.id)).toContain(fileId("nested"));
    expect(listed.map((node) => node.kind)).toContain("shortcut");
    await expect(
      drive.listDescendants(folderId("root"), { recursive: true, limit: 1 }),
    ).rejects.toMatchObject({ failure: "limit" });
  });

  it("shares traversal work across folders in one fresh read session", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("docs", folder("docs", "docs", ["root"]));
    api.resources.set("guide", file("guide", "guide.md", ["docs"], "body"));
    const session = await adapter(api, {
      maxTraversalNodes: 1,
    }).openReadSession();

    await expect(session.listChildren(folderId("root"))).resolves.toHaveLength(
      1,
    );
    await expect(session.listChildren(folderId("docs"))).rejects.toMatchObject({
      name: "DriveReadLimitError",
    });
  });

  it("enforces one cumulative content-byte budget for a read session", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("one", file("one", "one.md", ["root"], "four"));
    api.resources.set("two", file("two", "two.md", ["root"], "four"));
    api.media.set("one", new TextEncoder().encode("four"));
    api.media.set("two", new TextEncoder().encode("four"));
    const session = await adapter(api, { maxReadBytes: 7 }).openReadSession();

    await expect(session.readFile(fileId("one"))).resolves.toMatchObject({
      content: "four",
    });
    await expect(session.readFile(fileId("two"))).rejects.toMatchObject({
      name: "DriveReadLimitError",
    });
    expect(
      api.gets
        .filter((request) => request.alt === "media")
        .map((request) => request.fileId),
    ).toEqual(["one"]);
  });

  it("counts fresh scoped root validation against the metadata budget", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    const session = await adapter(api, {
      maxMetadataChecks: 1,
    }).openReadSession();

    await expect(session.getNode(folderId("root"))).rejects.toMatchObject({
      name: "DriveReadLimitError",
    });
    expect(api.gets).toHaveLength(1);
  });

  it("revalidates the root during scoped postchecks", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("guide", file("guide", "guide.md", ["root"], "body"));
    api.media.set("guide", new TextEncoder().encode("body"));
    let rootGets = 0;
    api.beforeGet = (request) => {
      if (request.fileId !== "root" || request.alt === "media") return;
      rootGets += 1;
      if (rootGets === 3) {
        api.resources.set("root", folder("root", "renamed-root"));
      }
    };
    const service = new MarkdownService(adapter(api), {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("archive"),
    });

    await expect(
      service.readMarkdown({ path: "guide.md" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(rootGets).toBe(3);
  });

  it("searches only already-enumerated descendant names", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set(
      "match",
      file("match", "Release.MD", ["root"], "not searched"),
    );
    api.resources.set(
      "miss",
      file("miss", "other.md", ["root"], "release body"),
    );
    api.media.set("miss", new TextEncoder().encode("release body"));
    const results = await adapter(api).searchDirectChildren(
      folderId("root"),
      "release",
      10,
    );
    expect(results).toMatchObject([
      { node: { id: fileId("match") } },
      { node: { id: fileId("miss") }, excerpt: "release body" },
    ]);
    expect(api.gets.length).toBeGreaterThanOrEqual(3);
    expect(
      api.lists.every((request) => !String(request.q).includes("fullText")),
    ).toBe(true);
  });

  it("returns every matching direct child before the service applies its caller limit", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("left", file("left", "same.md", ["root"], "left"));
    api.resources.set("right", file("right", "same.md", ["root"], "right"));
    const drive = adapter(api);

    await expect(
      drive.searchDirectChildren(folderId("root"), "same", 1),
    ).resolves.toHaveLength(2);
    const service = new MarkdownService(drive, {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("archive"),
    });
    await expect(
      service.searchMarkdown({ query: "same", limit: 1 }),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_PATH" });
  });

  it("gets metadata before bounded fatal-UTF-8 media and never exposes provider payloads", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("read", file("read", "read.md", ["root"], "hello"));
    api.media.set("read", new TextEncoder().encode("hello"));
    const drive = adapter(api);

    await expect(drive.getNode(fileId("missing"))).resolves.toBeUndefined();
    await expect(drive.readFile(fileId("read"))).resolves.toMatchObject({
      content: "hello",
      node: { revision: revision('"read-etag"'), size: 5 },
    });
    expect(api.gets.slice(-2).map((request) => request.alt)).toEqual([
      "media",
      undefined,
    ]);

    api.media.set("read", new Uint8Array([0xc3, 0x28]));
    await expect(drive.readFile(fileId("read"))).rejects.toMatchObject({
      failure: "malformed",
      operation: "read-media",
    });
    api.error = { response: { status: 429, data: "token=do-not-leak" } };
    await expect(drive.getNode(fileId("read"))).rejects.toThrow(
      "Google Drive get-metadata failed: throttled.",
    );
  });

  it("rejects a file moved out and back during media transfer", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("read", file("read", "read.md", ["root"], "hello"));
    api.media.set("read", new TextEncoder().encode("hello"));
    api.etags.set("read", '"before"');
    const originalGet = api.files.get;
    api.files.get = async (request) => {
      const response = await originalGet(request);
      if (request.alt === "media") api.etags.set("read", '"after"');
      return response;
    };

    await expect(adapter(api).readFile(fileId("read"))).rejects.toMatchObject({
      failure: "malformed",
      operation: "read-media",
    });
  });

  it("rejects a file renamed during media transfer without exposing stale content", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("read", file("read", "read.md", ["root"], "hello"));
    api.media.set("read", new TextEncoder().encode("hello"));
    const originalGet = api.files.get;
    api.files.get = async (request) => {
      const response = await originalGet(request);
      if (request.alt === "media") {
        api.resources.set(
          "read",
          file("read", "renamed.md", ["root"], "hello"),
        );
      }
      return response;
    };

    await expect(adapter(api).readFile(fileId("read"))).rejects.toMatchObject({
      failure: "malformed",
      operation: "read-media",
    });
  });

  it("keeps bounded excerpts well-formed when their boundary meets a surrogate pair", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    const content = `${"x".repeat(20)}😀${"x".repeat(19)}needle`;
    api.resources.set("read", file("read", "read.md", ["root"], content));
    api.media.set("read", new TextEncoder().encode(content));

    const [hit] = await adapter(api).searchDirectChildren(
      folderId("root"),
      "needle",
      1,
    );
    expect(hit?.excerpt?.startsWith("😀")).toBe(true);
    expect(() => new TextEncoder().encode(hit?.excerpt)).not.toThrow();
  });

  it("uses safe failures for malformed root and upstream responses", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", { ...folder("root", "root"), trashed: true });
    await expect(
      adapter(api).listChildren(folderId("root")),
    ).rejects.toBeInstanceOf(GoogleDriveProviderError);
    api.resources.set("root", folder("root", "root"));
    api.error = { response: { status: 503, data: "root-and-token" } };
    await expect(
      adapter(api).listChildren(folderId("root")),
    ).rejects.toMatchObject({
      failure: "transient",
      status: 503,
    });
  });

  it("does not treat malformed successful metadata as not found", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    const originalGet = api.files.get;
    api.files.get = async (request) =>
      request.fileId === "malformed"
        ? { data: undefined }
        : originalGet(request);

    await expect(
      adapter(api).getNode(fileId("malformed")),
    ).rejects.toMatchObject({
      failure: "malformed",
      operation: "get-metadata",
    });
  });

  it("rejects malformed provider Unicode before returning metadata", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set(
      "malformed",
      file("malformed", "\ud800.md", ["root"], "x"),
    );

    await expect(
      adapter(api).getNode(fileId("malformed")),
    ).rejects.toMatchObject({
      failure: "malformed",
      operation: "get-metadata",
    });
  });

  it("rejects malformed caller and provider IDs before requests or exposure", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    const drive = adapter(api);

    await expect(drive.getNode(fileId("\ud800"))).rejects.toMatchObject({
      failure: "configuration",
      operation: "get-metadata",
    });
    await expect(drive.readFile(fileId("\udc00"))).rejects.toMatchObject({
      failure: "configuration",
      operation: "read-media",
    });
    expect(api.gets).toHaveLength(0);

    api.resources.set(
      "malformed-parent",
      file("malformed-parent", "read.md", ["\ud800"], "x"),
    );
    await expect(
      drive.getNode(fileId("malformed-parent")),
    ).rejects.toMatchObject({
      failure: "malformed",
      operation: "get-metadata",
    });
    api.resources.set("malformed-id", file("\ud800", "read.md", ["root"], "x"));
    await expect(drive.getNode(fileId("malformed-id"))).rejects.toMatchObject({
      failure: "malformed",
      operation: "get-metadata",
    });
  });

  it("rejects metadata whose returned opaque ID differs from the requested ID", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    api.resources.set("requested", file("returned", "read.md", ["root"], "x"));
    await expect(
      adapter(api).getNode(fileId("requested")),
    ).rejects.toMatchObject({
      failure: "malformed",
      operation: "get-metadata",
    });
  });

  it.each([
    [() => Number.NaN],
    [() => Number.POSITIVE_INFINITY],
    [
      () => {
        throw new Error("clock payload");
      },
    ],
  ])("fails safely when the root-cache clock is invalid", async (now) => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    const drive = new GoogleDriveReadAdapter(
      {
        rootFolderId: folderId("root"),
        auth: {
          mode: "my-drive-refresh-token",
          credentials: { clientId: "c", clientSecret: "s", refreshToken: "r" },
        },
      },
      api,
      now,
    );

    await expect(drive.listChildren(folderId("root"))).rejects.toMatchObject({
      failure: "configuration",
      operation: "root-validation",
    });
  });

  it.each([
    [{ response: { status: 401 } }, "authentication", 401],
    [{ response: { status: 403 } }, "authentication", 403],
    [{ response: { status: 429 } }, "throttled", 429],
    [{ response: { status: 500 } }, "transient", 500],
    [{ code: "ETIMEDOUT" }, "transient", undefined],
  ] as const)(
    "normalizes upstream failure %# without retaining its payload",
    async (error, failure, status) => {
      const api = new FakeDriveApi();
      api.resources.set("root", folder("root", "root"));
      api.error = error;
      await expect(
        adapter(api).listChildren(folderId("root")),
      ).rejects.toMatchObject({
        failure,
        ...(status === undefined ? {} : { status }),
      });
    },
  );
});
