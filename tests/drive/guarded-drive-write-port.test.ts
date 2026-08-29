import { describe, expect, it, vi } from "vitest";

import {
  fileId,
  folderId,
  revision,
  type FileId,
  type FolderId,
  type Revision,
} from "../../src/domain/markdown.js";
import {
  DisabledDriveWritePort,
  GuardedDriveWriter,
  GuardedDriveWritePort,
} from "../../src/drive/guarded-drive-write-port.js";
import type {
  ConditionalWriteResult,
  CreateWriteResult,
  RawDriveWritePort,
} from "../../src/drive/drive-port.js";
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

class ExternalWriter extends GuardedDriveWriter {
  constructor() {
    super(Symbol("external-writer"));
  }

  createFile(
    _lease: WriteLease,
    _parentId: FolderId,
    _name: string,
    _content: string,
  ): Promise<CreateWriteResult> {
    return Promise.resolve({ outcome: "unsupported" });
  }

  updateFile(
    _lease: WriteLease,
    _fileId: FileId,
    _expectedRevision: Revision,
    _content: string,
  ): Promise<ConditionalWriteResult> {
    return Promise.resolve({ outcome: "unsupported" });
  }

  moveFile(
    _lease: WriteLease,
    _fileId: FileId,
    _expectedRevision: Revision,
    _sourceFolderId: FolderId,
    _destinationFolderId: FolderId,
  ): Promise<ConditionalWriteResult> {
    return Promise.resolve({ outcome: "unsupported" });
  }
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
    await writer.createFile(lease, folderId("root"), "new.md", "x");
    expect(events).toEqual(["raw-create"]);
  });

  it("validates immediately before exactly one raw mutation", async () => {
    const { gate, lease } = await issueLease();
    const events: string[] = [];
    const validate = gate.validateLease.bind(gate);
    vi.spyOn(gate, "validateLease").mockImplementation((candidate) => {
      events.push("validate");
      return validate(candidate);
    });
    const writer = new GuardedDriveWritePort(gate, raw(events));
    await writer.updateFile(lease, fileId("file"), revision('W/"same"'), "x");
    expect(events).toEqual(["validate", "raw-update"]);
  });

  it("denies fabricated or expired authority with no raw mutation", async () => {
    const { lease } = await issueLease();
    const { gate } = await issueLease(8);
    const events: string[] = [];
    const writer = new GuardedDriveWritePort(gate, raw(events));
    await expect(
      writer.moveFile(
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
      writer.createFile(lease, folderId("root"), "new.md", "x"),
    ).resolves.toEqual({ outcome: "unsupported" });
  });

  it("rejects fabricated leases and structural gate objects", async () => {
    expect(() => new WriteLease("fabricated", Symbol("wrong"))).toThrow(
      TypeError,
    );
    expect(() => new ExternalWriter()).toThrow(TypeError);
    expect(
      () =>
        new GuardedDriveWritePort(
          { validateLease: () => ({ allowed: true }) } as unknown as WriteGate,
          raw([]),
        ),
    ).toThrow(TypeError);
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

  it("does not recognize a prototype-forged writer capability", () => {
    const forged = Object.setPrototypeOf({}, GuardedDriveWritePort.prototype);
    expect(GuardedDriveWriter.isCapability(forged)).toBe(false);
  });
});
