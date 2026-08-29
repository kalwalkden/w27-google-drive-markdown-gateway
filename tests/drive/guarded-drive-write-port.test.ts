import { describe, expect, it } from "vitest";

import { fileId, folderId, revision } from "../../src/domain/markdown.js";
import {
  DisabledDriveWritePort,
  GuardedDriveWritePort,
} from "../../src/drive/guarded-drive-write-port.js";
import type { RawDriveWritePort } from "../../src/drive/drive-port.js";
import { WriteGate, type WriteLease } from "../../src/write-gate/gate.js";
import { InMemoryConsumedApprovalStore } from "../../src/write-gate/replay-store.js";
import {
  compactHeader,
  evidenceBytes,
  validApproval,
  validEvidence,
  validTrust,
} from "../write-gate/fixtures.js";

const lease: WriteLease = { value: "opaque" };

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
  it("dispatches once with a lease issued from synthetic supported evidence", async () => {
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
    const events: string[] = [];
    const writer = new GuardedDriveWritePort(gate, raw(events));
    await writer.createFile(decision.lease, folderId("root"), "new.md", "x");
    expect(events).toEqual(["raw-create"]);
  });

  it("validates immediately before exactly one raw mutation", async () => {
    const events: string[] = [];
    const writer = new GuardedDriveWritePort(
      {
        validateLease: () => {
          events.push("validate");
          return { allowed: true } as never;
        },
      } as never,
      raw(events),
    );
    await writer.updateFile(lease, fileId("file"), revision('W/"same"'), "x");
    expect(events).toEqual(["validate", "raw-update"]);
  });

  it("denies fabricated or expired authority with no raw mutation", async () => {
    const events: string[] = [];
    const writer = new GuardedDriveWritePort(
      { validateLease: () => ({ allowed: false }) as never } as never,
      raw(events),
    );
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
    const writer = new DisabledDriveWritePort();
    await expect(
      writer.createFile(lease, folderId("root"), "new.md", "x"),
    ).resolves.toEqual({ outcome: "unsupported" });
  });
});
