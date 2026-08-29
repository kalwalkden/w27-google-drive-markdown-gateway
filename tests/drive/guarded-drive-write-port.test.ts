import { describe, expect, it } from "vitest";

import { fileId, folderId, revision } from "../../src/domain/markdown.js";
import {
  DisabledDriveWritePort,
  GuardedDriveWritePort,
  guardedCreateFile,
  guardedMoveFile,
  guardedUpdateFile,
  isGuardedDriveWriter,
  type GuardedDriveWriter,
} from "../../src/drive/guarded-drive-write-port.js";
import type { RawDriveWritePort } from "../../src/drive/drive-port.js";

function raw(events: string[]): RawDriveWritePort {
  return {
    createFile: async () => {
      events.push("raw-create");
      return { outcome: "unsupported" };
    },
    updateFile: async () => {
      events.push("raw-update");
      return { outcome: "unsupported" };
    },
    moveFile: async () => {
      events.push("raw-move");
      return { outcome: "unsupported" };
    },
  };
}

describe("GuardedDriveWritePort", () => {
  it("dispatches each authentic writer mutation exactly once", async () => {
    const events: string[] = [];
    const writer = new GuardedDriveWritePort(raw(events));
    await guardedCreateFile(writer, folderId("root"), "new.md", "x");
    await guardedUpdateFile(writer, fileId("file"), revision('W/"same"'), "x");
    await guardedMoveFile(
      writer,
      fileId("file"),
      revision('"old"'),
      folderId("docs"),
      folderId("archive"),
    );
    expect(events).toEqual(["raw-create", "raw-update", "raw-move"]);
  });

  it("defaults to no mutation without a composed capability", async () => {
    const writer = new DisabledDriveWritePort();
    await expect(
      guardedCreateFile(writer, folderId("root"), "new.md", "x"),
    ).resolves.toEqual({ outcome: "unsupported" });
  });

  it("rejects an incomplete raw port before creating enabled authority", () => {
    for (const rawPort of [null, {}, { createFile() {} }]) {
      expect(() => new GuardedDriveWritePort(rawPort as never)).toThrow(
        TypeError,
      );
    }
  });

  it("rejects subclass, prototype, Proxy, and replaced-instance forgeries", async () => {
    class GuardedSubclass extends GuardedDriveWritePort {}
    expect(() => new GuardedSubclass(raw([]))).toThrow(TypeError);
    class DisabledSubclass extends DisabledDriveWritePort {}
    expect(() => new DisabledSubclass()).toThrow(TypeError);

    const forged = Object.setPrototypeOf({}, GuardedDriveWritePort.prototype);
    expect(isGuardedDriveWriter(forged)).toBe(false);
    const events: string[] = [];
    const authentic = new GuardedDriveWritePort(raw(events));
    const proxied = new Proxy(authentic, {});
    await expect(
      guardedCreateFile(
        forged as GuardedDriveWriter,
        folderId("root"),
        "new.md",
        "x",
      ),
    ).resolves.toEqual({ outcome: "unsupported" });
    await expect(
      guardedCreateFile(
        proxied as GuardedDriveWriter,
        folderId("root"),
        "new.md",
        "x",
      ),
    ).resolves.toEqual({ outcome: "unsupported" });

    Object.assign(authentic, {
      createFile: () => Promise.resolve({ outcome: "unsupported" }),
    });
    await guardedCreateFile(authentic, folderId("root"), "new.md", "x");
    expect(events).toEqual(["raw-create"]);
  });
});
