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
import { WriteGate, WriteLease } from "../../src/write-gate/gate.js";
import { InMemoryConsumedApprovalStore } from "../../src/write-gate/replay-store.js";
import {
  compactHeader,
  evidenceBytes,
  validApproval,
  validEvidence,
  validTrust,
} from "../write-gate/fixtures.js";

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

async function issueLease(fill = 7) {
  const evidence = validEvidence();
  const bytes = evidenceBytes(evidence);
  const gate = new WriteGate({
    trust: validTrust(),
    replayStore: new InMemoryConsumedApprovalStore(() =>
      Date.parse("2026-01-01T00:03:00.000Z"),
    ),
    clock: { now: () => new Date("2026-01-01T00:03:00.000Z") },
    verifier: { verify: async () => validApproval(bytes) },
    randomBytes: () => new Uint8Array(32).fill(fill),
  });
  const decision = await gate.evaluate({
    evidence,
    evidenceBytes: bytes,
    approvalJws: compactHeader(),
  });
  if (!decision.allowed) throw new Error("test lease was denied");
  return { gate, lease: decision.lease };
}

describe("GuardedDriveWritePort", () => {
  it("dispatches once with a lease issued from synthetic supported evidence", async () => {
    const { gate, lease } = await issueLease();
    const events: string[] = [];
    const writer = new GuardedDriveWritePort(gate, raw(events));
    await guardedCreateFile(writer, lease, folderId("root"), "new.md", "x");
    expect(events).toEqual(["raw-create"]);
  });

  it("dispatches exactly one raw mutation for an authentic lease", async () => {
    const { gate, lease } = await issueLease();
    const events: string[] = [];
    const writer = new GuardedDriveWritePort(gate, raw(events));
    await guardedUpdateFile(
      writer,
      lease,
      fileId("file"),
      revision('W/"same"'),
      "x",
    );
    expect(events).toEqual(["raw-update"]);
  });

  it("denies fabricated or expired authority with no raw mutation", async () => {
    const { lease } = await issueLease();
    const { gate } = await issueLease(8);
    const events: string[] = [];
    const writer = new GuardedDriveWritePort(gate, raw(events));
    await expect(
      guardedMoveFile(
        writer,
        lease,
        fileId("file"),
        revision('"old"'),
        folderId("docs"),
        folderId("archive"),
      ),
    ).resolves.toEqual({ outcome: "unsupported" });
    expect(events).toEqual([]);
  });

  it("defaults to no mutation without a composed capability", async () => {
    const { lease } = await issueLease();
    const writer = new DisabledDriveWritePort();
    await expect(
      guardedCreateFile(writer, lease, folderId("root"), "new.md", "x"),
    ).resolves.toEqual({ outcome: "unsupported" });
  });

  it("rejects fabricated leases and structural gate objects", async () => {
    expect(() => new WriteLease("fabricated", Symbol("wrong"))).toThrow(
      TypeError,
    );
    class GuardedSubclass extends GuardedDriveWritePort {}
    expect(() => new GuardedSubclass({} as WriteGate, raw([]))).toThrow(
      TypeError,
    );
    class DisabledSubclass extends DisabledDriveWritePort {}
    expect(() => new DisabledSubclass()).toThrow(TypeError);
    const events: string[] = [];
    const writer = new GuardedDriveWritePort(
      { validateLease: () => ({ allowed: true }) } as unknown as WriteGate,
      raw(events),
    );
    await expect(
      guardedCreateFile(
        writer,
        {} as WriteLease,
        folderId("root"),
        "new.md",
        "x",
      ),
    ).resolves.toEqual({ outcome: "unsupported" });
    expect(events).toEqual([]);
  });

  it("denies a real-object prototype forgery and a subclass override", async () => {
    const { gate, lease } = await issueLease();
    const events: string[] = [];
    const forged = Object.create(gate) as WriteGate;
    const forgedWriter = new GuardedDriveWritePort(forged, raw(events));
    await guardedCreateFile(
      forgedWriter,
      lease,
      folderId("root"),
      "new.md",
      "x",
    );
    expect(events).toEqual([]);

    class OverrideGate extends WriteGate {
      validateLease(): ReturnType<WriteGate["validateLease"]> {
        return {
          allowed: true,
          lease,
          audit: {
            event: "write-gate-evaluated",
            decision: "allowed",
            reason: "approved",
          },
        };
      }
    }
    expect(() => new OverrideGate({} as never)).toThrow(TypeError);
  });

  it("denies a prototype-forged lease without throwing or dispatching", async () => {
    const { gate } = await issueLease();
    const forged = Object.setPrototypeOf(
      {},
      WriteLease.prototype,
    ) as WriteLease;
    expect(gate.validateLease(forged)).toMatchObject({
      allowed: false,
      reason: "lease-invalid",
    });
  });

  it("fails closed for prototype and Proxy forgeries", async () => {
    const forged = Object.setPrototypeOf({}, GuardedDriveWritePort.prototype);
    expect(isGuardedDriveWriter(forged)).toBe(false);

    const { gate, lease } = await issueLease();
    const events: string[] = [];
    const authentic = new GuardedDriveWritePort(gate, raw(events));
    const proxied = new Proxy(authentic, {});
    await expect(
      guardedCreateFile(
        forged as GuardedDriveWriter,
        lease,
        folderId("root"),
        "new.md",
        "x",
      ),
    ).resolves.toEqual({ outcome: "unsupported" });
    await expect(
      guardedCreateFile(
        proxied as GuardedDriveWriter,
        lease,
        folderId("root"),
        "new.md",
        "x",
      ),
    ).resolves.toEqual({ outcome: "unsupported" });
    expect(events).toEqual([]);
  });

  it("does not dispatch through replaced instance methods", async () => {
    const { gate, lease } = await issueLease();
    const events: string[] = [];
    const writer = new GuardedDriveWritePort(gate, raw(events));
    Object.assign(writer, {
      createFile: () => {
        events.push("replacement");
        return Promise.resolve({ outcome: "unsupported" });
      },
    });

    await guardedCreateFile(writer, lease, folderId("root"), "new.md", "x");
    expect(events).toEqual(["raw-create"]);
  });
});
