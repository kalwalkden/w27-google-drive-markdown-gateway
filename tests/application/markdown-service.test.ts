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
  RawDriveWritePort,
} from "../../src/drive/drive-port.js";
import { GuardedDriveWritePort } from "../../src/drive/guarded-drive-write-port.js";
import { WriteGate } from "../../src/write-gate/gate.js";
import { InMemoryConsumedApprovalStore } from "../../src/write-gate/replay-store.js";
import {
  compactHeader,
  evidenceBytes,
  validApproval,
  validEvidence,
  validTrust,
} from "../write-gate/fixtures.js";

async function issueTestCapability() {
  const evidence = validEvidence();
  const bytes = evidenceBytes(evidence);
  const gate = new WriteGate({
    trust: validTrust(),
    replayStore: new InMemoryConsumedApprovalStore(() =>
      Date.parse("2026-01-01T00:03:00.000Z"),
    ),
    clock: { now: () => new Date("2026-01-01T00:03:00.000Z") },
    verifier: { verify: async () => validApproval(bytes) },
    randomBytes: () => new Uint8Array(32).fill(7),
  });
  const decision = await gate.evaluate({
    evidence,
    evidenceBytes: bytes,
    approvalJws: compactHeader(),
  });
  if (!decision.allowed) throw new Error("test lease was denied");
  return { gate, lease: decision.lease };
}

const testCapability = await issueTestCapability();
const testLease = testCapability.lease;

function writerFrom(raw: RawDriveWritePort): GuardedDriveWritePort {
  return new GuardedDriveWritePort(testCapability.gate, raw);
}

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
    id: "root-file",
    name: "root-file.md",
    kind: "file",
    parentIds: ["root"],
    content: "root content",
  });
  drive.addFixture({
    id: "nested-file",
    name: "child.MD",
    kind: "file",
    parentIds: ["nested"],
    content: "nested",
  });
  const service = new MarkdownService(
    drive,
    {
      rootFolderId: folderId("root"),
      archiveFolderId: folderId("archive"),
      maxMarkdownBytes: 32,
      defaultSearchLimit: 5,
      maxSearchLimit: 10,
    },
    writerFrom(drive),
  );
  return { drive, service, session: service.openWriteSession(testLease) };
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
    ...overrides,
  };
}

describe("MarkdownService", () => {
  it("keeps writes unavailable until a guarded writer is composed", async () => {
    const { service } = (() => {
      const drive = new InMemoryDrivePort();
      drive.addFixture({ id: "root", name: "root", kind: "folder" });
      drive.addFixture({
        id: "archive",
        name: "archive",
        kind: "folder",
        parentIds: ["root"],
      });
      return {
        service: new MarkdownService(drive, {
          rootFolderId: folderId("root"),
          archiveFolderId: folderId("archive"),
        }),
      };
    })();
    await expectCode(
      () =>
        service
          .openWriteSession(testLease)
          .createMarkdown({ path: "new.md", content: "x" }),
      "UNSUPPORTED",
    );
  });

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

  it("creates and conditionally updates direct-root files", async () => {
    const { drive, session } = fixture();
    const created = await session.createMarkdown({
      path: "new.md",
      content: "é",
    });
    expect(created.relativePath).toBe("new.md");
    const updated = await session.updateMarkdown({
      fileId: created.fileId,
      expectedRevision: created.revision,
      content: "new",
    });
    expect(updated.revision).toBe(revision("fake-revision-000001"));
    await expectCode(
      () =>
        session.archiveMarkdown({
          fileId: created.fileId,
          expectedRevision: updated.revision,
        }),
      "UNSUPPORTED",
    );
    expect(drive.inspect(created.fileId)).toMatchObject({
      parentIds: [folderId("root")],
      content: "new",
    });
  });

  it("does not mutate fake state when an update is stale or archive is disabled", async () => {
    const { drive, session } = fixture();
    const before = drive.inspect("root-file");
    await expectCode(
      () =>
        session.updateMarkdown({
          path: "root-file.md",
          expectedRevision: revision("0"),
          content: "unsafe",
        }),
      "CONFLICT",
    );
    await expectCode(
      () =>
        session.archiveMarkdown({
          path: "root-file.md",
          expectedRevision: revision("0"),
        }),
      "UNSUPPORTED",
    );
    expect(drive.inspect("root-file")).toEqual(before);
  });

  it("keeps two-actor stale content and stale source-parent mutations unchanged", async () => {
    const { drive, session } = fixture();
    const original = drive.inspect("root-file");
    if (!original?.revision) throw new Error("fixture revision is required");
    const originalRevision = original.revision;

    const actorBContent = await drive.updateFile(
      fileId("root-file"),
      originalRevision,
      "actor-b-content",
    );
    expect(actorBContent).toMatchObject({ outcome: "success" });
    const afterContent = drive.inspect("root-file");
    await expectCode(
      () =>
        session.updateMarkdown({
          fileId: fileId("root-file"),
          expectedRevision: originalRevision,
          content: "actor-a-content",
        }),
      "CONFLICT",
    );
    expect(drive.inspect("root-file")).toEqual(afterContent);

    const fresh = drive.inspect("root-file");
    if (!fresh?.revision) throw new Error("fixture revision is required");
    const actorBMove = await drive.moveFile(
      fileId("root-file"),
      fresh.revision,
      folderId("root"),
      folderId("docs"),
    );
    expect(actorBMove).toMatchObject({ outcome: "success" });
    if (actorBMove.outcome !== "success")
      throw new Error("actor B move failed");
    const afterMove = drive.inspect("root-file");
    await expect(
      drive.moveFile(
        fileId("root-file"),
        actorBMove.node.revision as ReturnType<typeof revision>,
        folderId("root"),
        folderId("archive"),
      ),
    ).resolves.toMatchObject({ outcome: "conflict" });
    expect(drive.inspect("root-file")).toEqual(afterMove);
  });

  it("does not dispatch nested mutations after a non-atomic ancestor resolution", async () => {
    const { service } = fixture();
    await expectCode(
      () =>
        service
          .openWriteSession(testLease)
          .createMarkdown({ path: "docs/new.md", content: "x" }),
      "UNSUPPORTED",
    );
    await expectCode(
      () =>
        service.openWriteSession(testLease).updateMarkdown({
          path: "docs/guide.md",
          expectedRevision: revision("1"),
          content: "x",
        }),
      "UNSUPPORTED",
    );
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
    const session = service.openWriteSession(testLease);
    await expectCode(
      () => session.createMarkdown({ path: "../outside.md", content: "x" }),
      "INVALID_PATH",
    );
    await expectCode(
      () => session.createMarkdown({ path: "docs/file.txt", content: "x" }),
      "NOT_MARKDOWN",
    );
    await expectCode(
      () =>
        session.createMarkdown({
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

    const invalidArchive = new MarkdownService(
      drive,
      { rootFolderId: folderId("root"), archiveFolderId: folderId("cycle-a") },
      writerFrom(drive),
    ).openWriteSession(testLease);
    await expectCode(
      () =>
        invalidArchive.archiveMarkdown({
          path: "root-file.md",
          expectedRevision: revision("1"),
        }),
      "UNSUPPORTED",
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

  it("rejects hostile provider names for ID reads and skips them in list/search", async () => {
    const { drive, service } = fixture();
    const hostileNames = [
      "../escape.md",
      "folder/name.md",
      "folder\\name.md",
      "C:escape.md",
      "control\u0000name.md",
    ];
    for (const [index, name] of hostileNames.entries()) {
      drive.addFixture({
        id: `hostile-${index}`,
        name,
        kind: "file",
        parentIds: ["docs"],
        content: "release",
      });
      await expectCode(
        () => service.readMarkdown({ fileId: fileId(`hostile-${index}`) }),
        "UNSUPPORTED",
      );
    }
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

  it("rejects an unsafe provider-selected root name before an ID mutation", async () => {
    const drive = new InMemoryDrivePort();
    drive.addFixture({ id: "root", name: "C:root", kind: "folder" });
    drive.addFixture({
      id: "archive",
      name: "archive",
      kind: "folder",
      parentIds: ["root"],
    });
    drive.addFixture({
      id: "file",
      name: "file.md",
      kind: "file",
      parentIds: ["root"],
      content: "old",
    });
    const session = new MarkdownService(
      drive,
      { rootFolderId: folderId("root"), archiveFolderId: folderId("archive") },
      writerFrom(drive),
    ).openWriteSession(testLease);
    await expectCode(
      () =>
        session.updateMarkdown({
          fileId: fileId("file"),
          expectedRevision: revision("1"),
          content: "new",
        }),
      "UNSUPPORTED",
    );
    expect(drive.inspect("file")?.content).toBe("old");
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
    const rootFile = drive.inspect("root-file") as DriveNode;
    const createService = new MarkdownService(
      portFrom(drive),
      { rootFolderId: folderId("root"), archiveFolderId: folderId("archive") },
      writerFrom({
        createFile: async () => ({
          outcome: "success",
          node: { ...rootFile, name: "wrong.md" },
        }),
        updateFile: drive.updateFile.bind(drive),
        moveFile: drive.moveFile.bind(drive),
      }),
    ).openWriteSession(testLease);
    await expectCode(
      () => createService.createMarkdown({ path: "new.md", content: "new" }),
      "UNSUPPORTED",
    );

    const updateService = new MarkdownService(
      portFrom(drive),
      { rootFolderId: folderId("root"), archiveFolderId: folderId("archive") },
      writerFrom({
        createFile: drive.createFile.bind(drive),
        updateFile: async () => ({
          outcome: "success" as const,
          node: {
            ...rootFile,
            revision: revision("fake-revision-000001"),
            size: 999,
          },
        }),
        moveFile: drive.moveFile.bind(drive),
      }),
    ).openWriteSession(testLease);
    await expectCode(
      () =>
        updateService.updateMarkdown({
          path: "root-file.md",
          expectedRevision: revision("1"),
          content: "new",
        }),
      "UNSUPPORTED",
    );

    const archiveResponseService = new MarkdownService(
      portFrom(drive),
      { rootFolderId: folderId("root"), archiveFolderId: folderId("archive") },
      writerFrom({
        createFile: drive.createFile.bind(drive),
        updateFile: drive.updateFile.bind(drive),
        moveFile: async () => ({
          outcome: "success" as const,
          node: {
            ...rootFile,
            name: "wrong.md",
            parentIds: [folderId("archive")],
            revision: revision("fake-revision-000001"),
          },
        }),
      }),
    ).openWriteSession(testLease);
    await expectCode(
      () =>
        archiveResponseService.archiveMarkdown({
          path: "root-file.md",
          expectedRevision: revision("1"),
        }),
      "UNSUPPORTED",
    );

    drive.addFixture({
      id: "archive-guide",
      name: "root-file.md",
      kind: "file",
      parentIds: ["archive"],
      content: "old",
    });
    const archiveService = new MarkdownService(
      drive,
      { rootFolderId: folderId("root"), archiveFolderId: folderId("archive") },
      writerFrom(drive),
    ).openWriteSession(testLease);
    await expectCode(
      () =>
        archiveService.archiveMarkdown({
          path: "root-file.md",
          expectedRevision: revision("1"),
        }),
      "UNSUPPORTED",
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
