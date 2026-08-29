import { describe, expect, it } from "vitest";

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
  version?: string;
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
    version: "7",
    trashed: false,
  };
}

class FakeDriveApi implements GoogleDriveApi {
  readonly gets: Readonly<Record<string, unknown>>[] = [];
  readonly lists: Readonly<Record<string, unknown>>[] = [];
  readonly resources = new Map<string, Resource>();
  readonly media = new Map<string, Uint8Array>();
  nextPages = new Map<string, readonly Resource[][]>();
  error?: unknown;

  readonly files = {
    get: async (request: Readonly<Record<string, unknown>>) => {
      this.gets.push(request);
      if (this.error) throw this.error;
      const id = request.fileId as string;
      if (request.alt === "media") return { data: this.media.get(id) };
      const resource = this.resources.get(id);
      if (!resource) throw { response: { status: 404, data: "hidden" } };
      return { data: resource };
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
    expect(api.gets).toHaveLength(1);
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
    expect(api.lists.some((request) => request.pageToken === "1")).toBe(true);
    drive.invalidateRootContext();
    await drive.listChildren(folderId("root"));
    expect(api.gets).toHaveLength(2);
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
    const results = await adapter(api).searchDescendants(
      folderId("root"),
      "release",
      10,
    );
    expect(results).toMatchObject([
      { node: { id: fileId("match") } },
      { node: { id: fileId("miss") }, excerpt: "release body" },
    ]);
    expect(api.gets).toHaveLength(3);
    expect(
      api.lists.every((request) => !String(request.q).includes("fullText")),
    ).toBe(true);
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
      node: { revision: revision("7"), size: 5 },
    });
    expect(api.gets.slice(-2).map((request) => request.alt)).toEqual([
      undefined,
      "media",
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

  it("keeps all writes disabled without touching the API", async () => {
    const api = new FakeDriveApi();
    api.resources.set("root", folder("root", "root"));
    const drive = adapter(api);
    await expect(
      drive.createFile(folderId("root"), "new.md", "new"),
    ).rejects.toMatchObject({ operation: "write-disabled" });
    await expect(
      drive.updateFile(fileId("file"), revision("1"), "new"),
    ).resolves.toEqual({ outcome: "unsupported" });
    await expect(
      drive.moveFile(fileId("file"), revision("1"), folderId("root")),
    ).resolves.toEqual({ outcome: "unsupported" });
    expect(api.gets).toHaveLength(0);
    expect(api.lists).toHaveLength(0);
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
