import { describe, expect, it } from "vitest";

import { MarkdownService } from "../../src/application/markdown-service.js";
import {
  fileId,
  folderId,
  MarkdownGatewayError,
  revision,
} from "../../src/domain/markdown.js";
import { InMemoryDrivePort } from "../../src/drive/in-memory-drive-port.js";
import type {
  DriveNode,
  DrivePort,
  DriveRead,
  DriveSearchHit,
} from "../../src/drive/drive-port.js";

function fixture() {
  const drive = new InMemoryDrivePort();
  drive.addFixture({ id: "root", name: "root", kind: "folder" });
  drive.addFixture({
    id: "docs",
    name: "docs",
    kind: "folder",
    parentIds: ["root"],
  });
  drive.addFixture({
    id: "archive",
    name: "archive",
    kind: "folder",
    parentIds: ["root"],
  });
  drive.addFixture({
    id: "nested",
    name: "nested",
    kind: "folder",
    parentIds: ["docs"],
  });
  drive.addFixture({
    id: "guide",
    name: "guide.md",
    kind: "file",
    parentIds: ["docs"],
    content: "hello release plan",
  });
  drive.addFixture({
    id: "nested-file",
    name: "child.MD",
    kind: "file",
    parentIds: ["nested"],
    content: "nested",
  });
  const service = new MarkdownService(drive, {
    rootFolderId: folderId("root"),
    archiveFolderId: folderId("archive"),
    maxMarkdownBytes: 32,
    defaultSearchLimit: 5,
    maxSearchLimit: 10,
  });
  return { drive, service };
}

function expectCode(action: () => Promise<unknown>, code: string) {
  return expect(action()).rejects.toMatchObject({ code });
}

function portFrom(
  drive: InMemoryDrivePort,
  overrides: Partial<DrivePort> = {},
): DrivePort {
  return {
    getNode: drive.getNode.bind(drive),
    listChildren: drive.listChildren.bind(drive),
    listDescendants: drive.listDescendants.bind(drive),
    searchDescendants: drive.searchDescendants.bind(drive),
    readFile: drive.readFile.bind(drive),
    createFile: drive.createFile.bind(drive),
    updateFile: drive.updateFile.bind(drive),
    moveFile: drive.moveFile.bind(drive),
    ...overrides,
  };
}

describe("MarkdownService", () => {
  it("lists, searches, and reads only verified Markdown files", async () => {
    const { service } = fixture();
    expect(
      (await service.listMarkdown({ path: "docs" })).map(
        (file) => file.relativePath,
      ),
    ).toEqual(["docs/guide.md"]);
    expect(
      (await service.listMarkdown({ path: "docs", recursive: true })).map(
        (file) => file.relativePath,
      ),
    ).toEqual(["docs/nested/child.MD", "docs/guide.md"]);
    expect(await service.searchMarkdown({ query: "release" })).toMatchObject([
      { relativePath: "docs/guide.md", excerpt: "hello release plan" },
    ]);
    expect(await service.readMarkdown({ path: "docs/guide.md" })).toMatchObject(
      {
        fileId: fileId("guide"),
        revision: revision("1"),
        content: "hello release plan",
      },
    );
  });

  it("creates, conditionally updates, and archives while retaining the file ID", async () => {
    const { drive, service } = fixture();
    const created = await service.createMarkdown({
      path: "docs/new.md",
      content: "é",
    });
    expect(created.relativePath).toBe("docs/new.md");
    const updated = await service.updateMarkdown({
      fileId: created.fileId,
      expectedRevision: created.revision,
      content: "new",
    });
    expect(updated.revision).toBe(revision("2"));
    const archived = await service.archiveMarkdown({
      fileId: created.fileId,
      expectedRevision: updated.revision,
    });
    expect(archived).toMatchObject({
      fileId: created.fileId,
      relativePath: "archive/new.md",
      revision: revision("3"),
    });
    expect(drive.inspect(created.fileId)).toMatchObject({
      parentIds: [folderId("archive")],
      content: "new",
    });
  });

  it("does not mutate fake state when an update or archive revision is stale", async () => {
    const { drive, service } = fixture();
    const before = drive.inspect("guide");
    await expectCode(
      () =>
        service.updateMarkdown({
          path: "docs/guide.md",
          expectedRevision: revision("0"),
          content: "unsafe",
        }),
      "CONFLICT",
    );
    await expectCode(
      () =>
        service.archiveMarkdown({
          path: "docs/guide.md",
          expectedRevision: revision("0"),
        }),
      "CONFLICT",
    );
    expect(drive.inspect("guide")).toEqual(before);
  });

  it("rejects unsafe local inputs before any port call", async () => {
    const neverPort = new Proxy(
      {},
      {
        get() {
          throw new Error("port must not be called for invalid input");
        },
      },
    ) as DrivePort;
    const service = new MarkdownService(neverPort, {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("archive"),
      maxMarkdownBytes: 32,
    });
    await expectCode(
      () => service.createMarkdown({ path: "../outside.md", content: "x" }),
      "INVALID_PATH",
    );
    await expectCode(
      () => service.createMarkdown({ path: "docs/file.txt", content: "x" }),
      "NOT_MARKDOWN",
    );
    await expectCode(
      () =>
        service.createMarkdown({
          path: "docs/too-big.md",
          content: "012345678901234567890123456789012",
        }),
      "FILE_TOO_LARGE",
    );
    await expectCode(
      () => service.searchMarkdown({ query: "", limit: 1 }),
      "INVALID_CONTENT",
    );
  });

  it("rejects duplicate names, shortcuts, intermediate files, and identifiers outside the root", async () => {
    const { drive, service } = fixture();
    drive.addFixture({
      id: "duplicate",
      name: "guide.md",
      kind: "file",
      parentIds: ["docs"],
      content: "duplicate",
    });
    await expectCode(
      () => service.readMarkdown({ path: "docs/guide.md" }),
      "AMBIGUOUS_PATH",
    );

    const second = fixture();
    second.drive.addFixture({
      id: "shortcut",
      name: "shortcut.md",
      kind: "shortcut",
      parentIds: ["docs"],
    });
    second.drive.addFixture({
      id: "outside",
      name: "outside.md",
      kind: "file",
      parentIds: [],
      content: "outside",
    });
    await expectCode(
      () => second.service.readMarkdown({ path: "docs/shortcut.md" }),
      "UNSUPPORTED",
    );
    await expectCode(
      () => second.service.readMarkdown({ fileId: fileId("outside") }),
      "OUTSIDE_ROOT",
    );
    await expectCode(
      () => second.service.readMarkdown({ path: "docs/guide.md/child.md" }),
      "NOT_FOUND",
    );
  });

  it("rejects malformed identifier parent graphs and an archive outside the root", async () => {
    const { drive, service } = fixture();
    drive.addFixture({
      id: "cycle-a",
      name: "a",
      kind: "folder",
      parentIds: ["cycle-b"],
    });
    drive.addFixture({
      id: "cycle-b",
      name: "b",
      kind: "folder",
      parentIds: ["cycle-a"],
    });
    drive.addFixture({
      id: "cycle-file",
      name: "cycle.md",
      kind: "file",
      parentIds: ["cycle-a"],
      content: "x",
    });
    drive.addFixture({
      id: "multi",
      name: "multi.md",
      kind: "file",
      parentIds: ["docs", "archive"],
      content: "x",
    });
    await expectCode(
      () => service.readMarkdown({ fileId: fileId("cycle-file") }),
      "OUTSIDE_ROOT",
    );
    await expectCode(
      () => service.readMarkdown({ fileId: fileId("multi") }),
      "OUTSIDE_ROOT",
    );

    const invalidArchive = new MarkdownService(drive, {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("cycle-a"),
    });
    await expectCode(
      () =>
        invalidArchive.archiveMarkdown({
          path: "docs/guide.md",
          expectedRevision: revision("1"),
        }),
      "OUTSIDE_ROOT",
    );
  });

  it("does not expose non-Markdown, oversized, or escaped list/search candidates", async () => {
    const { drive, service } = fixture();
    drive.addFixture({
      id: "text",
      name: "ignore.txt",
      kind: "file",
      parentIds: ["docs"],
      content: "release",
    });
    drive.addFixture({
      id: "large",
      name: "large.md",
      kind: "file",
      parentIds: ["docs"],
      content: "012345678901234567890123456789012",
    });
    drive.addFixture({
      id: "external",
      name: "external.md",
      kind: "file",
      parentIds: [],
      content: "release",
    });
    expect(
      (await service.listMarkdown({ path: "docs", recursive: true })).map(
        (entry) => entry.relativePath,
      ),
    ).toEqual(["docs/nested/child.MD", "docs/guide.md"]);
    expect(
      (await service.searchMarkdown({ query: "release" })).map(
        (entry) => entry.relativePath,
      ),
    ).toEqual(["docs/guide.md"]);
  });

  it("validates service configuration", () => {
    const drive = new InMemoryDrivePort();
    expect(
      () =>
        new MarkdownService(drive, {
          rootFolderId: folderId("root"),
          archiveFolderId: folderId("root"),
        }),
    ).toThrow(MarkdownGatewayError);
    expect(
      () =>
        new MarkdownService(drive, {
          rootFolderId: folderId("root"),
          archiveFolderId: folderId("archive"),
          maxMarkdownBytes: -1,
        }),
    ).toThrow(MarkdownGatewayError);
    expect(
      () =>
        new MarkdownService(drive, {
          rootFolderId: folderId("root"),
          archiveFolderId: folderId("archive"),
          defaultSearchLimit: 1,
          maxSearchLimit: 1_001,
        }),
    ).toThrow(MarkdownGatewayError);
  });

  it("rejects non-boolean recursive values before invoking the port", async () => {
    const neverPort = new Proxy(
      {},
      {
        get() {
          throw new Error("port must not be called for invalid input");
        },
      },
    ) as DrivePort;
    const service = new MarkdownService(neverPort, {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("archive"),
    });
    await expectCode(
      () => service.listMarkdown({ recursive: "yes" as unknown as boolean }),
      "INVALID_CONTENT",
    );
    expect(
      () =>
        new MarkdownService(neverPort, {
          rootFolderId: folderId("root"),
          archiveFolderId: folderId("archive"),
          defaultRecursive: "yes" as unknown as boolean,
        }),
    ).toThrow(MarkdownGatewayError);
  });

  it("enforces direct depth and rejects duplicate canonical list/search results", async () => {
    const { drive } = fixture();
    const directIgnoringPort = portFrom(drive, {
      listDescendants: async () => [
        ...(await drive.listDescendants(folderId("docs"), {
          recursive: true,
          limit: 10,
        })),
      ],
    });
    const directService = new MarkdownService(directIgnoringPort, {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("archive"),
      defaultSearchLimit: 5,
      maxSearchLimit: 10,
    });
    expect(
      (
        await directService.listMarkdown({ path: "docs", recursive: false })
      ).map((entry) => entry.relativePath),
    ).toEqual(["docs/guide.md"]);

    const guide = drive.inspect("guide") as DriveNode;
    const duplicateListService = new MarkdownService(
      portFrom(drive, { listDescendants: async () => [guide, guide] }),
      { rootFolderId: folderId("root"), archiveFolderId: folderId("archive") },
    );
    await expectCode(
      () => duplicateListService.listMarkdown({ recursive: true }),
      "AMBIGUOUS_PATH",
    );

    const duplicateSearchService = new MarkdownService(
      portFrom(drive, {
        searchDescendants: async (): Promise<readonly DriveSearchHit[]> => [
          { node: guide },
          { node: guide },
        ],
      }),
      { rootFolderId: folderId("root"), archiveFolderId: folderId("archive") },
    );
    await expectCode(
      () => duplicateSearchService.searchMarkdown({ query: "guide" }),
      "AMBIGUOUS_PATH",
    );
  });

  it("rejects a read that races outside the root or returns inconsistent metadata/content", async () => {
    const { drive } = fixture();
    const guide = drive.inspect("guide") as DriveNode;
    const outsideOnRecheck = portFrom(drive, {
      getNode: async (id) =>
        id === fileId("guide")
          ? { ...guide, parentIds: [] }
          : drive.getNode(id),
    });
    const movedService = new MarkdownService(outsideOnRecheck, {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("archive"),
    });
    await expectCode(
      () => movedService.readMarkdown({ path: "docs/guide.md" }),
      "OUTSIDE_ROOT",
    );

    const inconsistentPort = portFrom(drive, {
      readFile: async (): Promise<DriveRead> => ({
        node: guide,
        content: "changed-but-size-is-not",
      }),
    });
    const inconsistentService = new MarkdownService(inconsistentPort, {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("archive"),
    });
    await expectCode(
      () => inconsistentService.readMarkdown({ path: "docs/guide.md" }),
      "UNSUPPORTED",
    );
  });

  it("rejects inconsistent create/update success and an occupied archive destination", async () => {
    const { drive } = fixture();
    const guide = drive.inspect("guide") as DriveNode;
    const createService = new MarkdownService(
      portFrom(drive, {
        createFile: async () => ({ ...guide, name: "wrong.md" }),
      }),
      { rootFolderId: folderId("root"), archiveFolderId: folderId("archive") },
    );
    await expectCode(
      () =>
        createService.createMarkdown({ path: "docs/new.md", content: "new" }),
      "UNSUPPORTED",
    );

    const updateService = new MarkdownService(
      portFrom(drive, {
        updateFile: async () => ({
          outcome: "success" as const,
          node: { ...guide, revision: revision("2"), size: 999 },
        }),
      }),
      { rootFolderId: folderId("root"), archiveFolderId: folderId("archive") },
    );
    await expectCode(
      () =>
        updateService.updateMarkdown({
          path: "docs/guide.md",
          expectedRevision: revision("1"),
          content: "new",
        }),
      "UNSUPPORTED",
    );

    const archiveResponseService = new MarkdownService(
      portFrom(drive, {
        moveFile: async () => ({
          outcome: "success" as const,
          node: {
            ...guide,
            parentIds: [folderId("archive")],
            revision: revision("1"),
          },
        }),
      }),
      { rootFolderId: folderId("root"), archiveFolderId: folderId("archive") },
    );
    await expectCode(
      () =>
        archiveResponseService.archiveMarkdown({
          path: "docs/guide.md",
          expectedRevision: revision("1"),
        }),
      "UNSUPPORTED",
    );

    drive.addFixture({
      id: "archive-guide",
      name: "guide.md",
      kind: "file",
      parentIds: ["archive"],
      content: "old",
    });
    const archiveService = new MarkdownService(drive, {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("archive"),
    });
    await expectCode(
      () =>
        archiveService.archiveMarkdown({
          path: "docs/guide.md",
          expectedRevision: revision("1"),
        }),
      "INVALID_ARCHIVE",
    );
  });

  it("rejects malformed returned metadata instead of exposing it", async () => {
    const { drive, service } = fixture();
    drive.addFixture({
      id: "bad-time",
      name: "bad.md",
      kind: "file",
      parentIds: ["docs"],
      content: "x",
      modifiedTime: "not-a-timestamp",
    });
    await expectCode(
      () => service.readMarkdown({ path: "docs/bad.md" }),
      "UNSUPPORTED",
    );
    expect(
      (await service.listMarkdown({ path: "docs", recursive: true })).map(
        (entry) => entry.relativePath,
      ),
    ).not.toContain("docs/bad.md");
  });
});
