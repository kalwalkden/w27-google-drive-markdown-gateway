import { describe, expect, it } from "vitest";

import type {
  DriveFileMetadata,
  DriveResponse,
  RawDriveClient,
} from "../../src/live-drive/drive-client.js";
import { runLiveDriveCapabilityProbe } from "../../src/live-drive/probe.js";

class FakeDrive {
  content: Uint8Array = new TextEncoder().encode("initial");
  etag = '"v1"';
  version = "1";
  parent = "root";
  staleIgnored = false;
  staleParentIgnored = false;
  staleContentStatus = 412;
  freshStatus?: number;
  unreadableAfterStale = false;
  pendingReadFailure = false;
  changeStateAfter412 = false;
  cleanupConditionalConflict = false;
  cleanupMoveFails = false;
  omitEtag = false;
  invalidVersion = false;
  malformedCreateWithCandidate = false;
  movedFileIds: string[] = [];
  name = "w27-drive-capability-unit.md";
  markedRoot = true;
  archiveParent = "root";

  metadata(id: string): DriveFileMetadata {
    if (id === "root")
      return {
        id,
        name: "root",
        mimeType: "application/vnd.google-apps.folder",
        parents: [],
        trashed: false,
        driveId: "drive",
        appProperties: this.markedRoot
          ? { w27MarkdownGatewayTestRoot: "v1" }
          : {},
      };
    if (id === "archive")
      return {
        id,
        name: "archive",
        mimeType: "application/vnd.google-apps.folder",
        parents: [this.archiveParent],
        trashed: false,
        driveId: "drive",
      };
    return {
      id: "file",
      name: this.name,
      mimeType: "text/markdown",
      parents: [this.parent],
      trashed: false,
      driveId: "drive",
      version: this.invalidVersion ? "not-numeric" : this.version,
      headRevisionId: `revision-${this.version}`,
    };
  }

  response<T>(value?: T, status = 200): DriveResponse<T> {
    return { status, etag: this.omitEtag ? undefined : this.etag, value };
  }

  client(): RawDriveClient {
    return {
      getMetadata: async (id: string) => {
        if (this.pendingReadFailure) {
          this.pendingReadFailure = false;
          return this.response(undefined, 401);
        }
        return this.response(this.metadata(id));
      },
      download: async () => this.response(this.content),
      create: async (name: string, _root: string, content: Uint8Array) => {
        this.name = name;
        this.content = content;
        if (this.malformedCreateWithCandidate)
          return {
            status: 200,
            etag: this.etag,
            candidateId: "file",
            malformed: true,
          };
        return this.response(this.metadata("file"));
      },
      updateContent: async (_id: string, content: Uint8Array, etag: string) => {
        if (etag !== this.etag) {
          if (this.unreadableAfterStale) {
            this.pendingReadFailure = true;
            return this.response(undefined, 412);
          }
          if (this.changeStateAfter412) {
            this.content = content;
            this.etag = '"changed-after-412"';
            return this.response(undefined, 412);
          }
          if (!this.staleIgnored)
            return this.response(undefined, this.staleContentStatus);
          this.content = content;
          this.etag = '"unsafe"';
          this.version = "99";
          return this.response(this.metadata("file"));
        }
        if (this.freshStatus) return this.response(undefined, this.freshStatus);
        this.content = content;
        this.version = String(Number(this.version) + 1);
        this.etag = `"v${this.version}"`;
        return this.response(this.metadata("file"));
      },
      move: async (id: string, add: string, _remove: string, etag?: string) => {
        this.movedFileIds.push(id);
        if (etag && etag !== this.etag) {
          if (!this.staleParentIgnored) return this.response(undefined, 412);
          this.parent = add;
          return this.response(this.metadata("file"));
        }
        if (etag && this.cleanupConditionalConflict) {
          this.cleanupConditionalConflict = false;
          return this.response(undefined, 412);
        }
        if (this.cleanupMoveFails) return this.response(undefined, 500);
        this.parent = add;
        this.version = String(Number(this.version) + 1);
        this.etag = `"v${this.version}"`;
        return this.response(this.metadata("file"));
      },
    } as unknown as RawDriveClient;
  }
}

const config = {
  schemaVersion: 1 as const,
  authMode: "shared-drive-adc" as const,
  testRootFolderId: "root",
  archiveFolderId: "archive",
  requestTimeoutMs: 1_000,
};

describe("live Drive capability probe", () => {
  it("requires two 412 stale rejections and archives the exact generated file", async () => {
    const drive = new FakeDrive();
    const evidence = await runLiveDriveCapabilityProbe(config, {
      actorA: drive.client(),
      actorB: drive.client(),
      cleanup: drive.client(),
    });
    expect(evidence.outcome).toBe("SUPPORTED");
    expect(evidence.cleanup.status).toBe("ARCHIVED");
    expect(
      evidence.checks.find((entry) => entry.id === "stale-content-update")
        ?.operationStatus,
    ).toBe(412);
    expect(
      evidence.checks.find((entry) => entry.id === "stale-parent-move")
        ?.operationStatus,
    ).toBe(412);
  });

  it("does not create a file when the root marker or archive topology is invalid", async () => {
    for (const setup of [
      (drive: FakeDrive) => {
        drive.markedRoot = false;
      },
      (drive: FakeDrive) => {
        drive.archiveParent = "other-parent";
      },
    ]) {
      const drive = new FakeDrive();
      setup(drive);
      const evidence = await runLiveDriveCapabilityProbe(config, {
        actorA: drive.client(),
        actorB: drive.client(),
        cleanup: drive.client(),
      });
      expect(evidence.outcome).toBe("INCONCLUSIVE");
      expect(evidence.cleanup.status).toBe("NOT_CREATED");
    }
  });

  it("fails closed when Drive accepts a stale content update", async () => {
    const drive = new FakeDrive();
    drive.staleIgnored = true;
    const evidence = await runLiveDriveCapabilityProbe(config, {
      actorA: drive.client(),
      actorB: drive.client(),
      cleanup: drive.client(),
    });
    expect(evidence.outcome).toBe("UNSUPPORTED");
    expect(evidence.cleanup.status).toBe("ARCHIVED");
  });

  it("fails closed for accepted/non-412 stale writes and changed 412 readback", async () => {
    for (const setup of [
      (drive: FakeDrive) => {
        drive.staleParentIgnored = true;
      },
      (drive: FakeDrive) => {
        drive.staleContentStatus = 409;
      },
      (drive: FakeDrive) => {
        drive.changeStateAfter412 = true;
      },
    ]) {
      const drive = new FakeDrive();
      setup(drive);
      const evidence = await runLiveDriveCapabilityProbe(config, {
        actorA: drive.client(),
        actorB: drive.client(),
        cleanup: drive.client(),
      });
      expect(evidence.outcome).toBe("UNSUPPORTED");
    }
  });

  it("reports transient status and unreadable rejection readback as inconclusive", async () => {
    for (const status of [401, 429, 500]) {
      const transient = new FakeDrive();
      transient.freshStatus = status;
      const transientEvidence = await runLiveDriveCapabilityProbe(config, {
        actorA: transient.client(),
        actorB: transient.client(),
        cleanup: transient.client(),
      });
      expect(transientEvidence.outcome).toBe("INCONCLUSIVE");
    }

    const unreadable = new FakeDrive();
    unreadable.unreadableAfterStale = true;
    const unreadableEvidence = await runLiveDriveCapabilityProbe(config, {
      actorA: unreadable.client(),
      actorB: unreadable.client(),
      cleanup: unreadable.client(),
    });
    expect(unreadableEvidence.outcome).toBe("INCONCLUSIVE");
  });

  it("treats a missing raw ETag as unsupported", async () => {
    const drive = new FakeDrive();
    drive.omitEtag = true;
    const evidence = await runLiveDriveCapabilityProbe(config, {
      actorA: drive.client(),
      actorB: drive.client(),
      cleanup: drive.client(),
    });
    expect(evidence.outcome).toBe("UNSUPPORTED");
  });

  it("arms exact-ID cleanup after a malformed successful create response", async () => {
    const drive = new FakeDrive();
    drive.malformedCreateWithCandidate = true;
    const evidence = await runLiveDriveCapabilityProbe(config, {
      actorA: drive.client(),
      actorB: drive.client(),
      cleanup: drive.client(),
    });
    expect(evidence.outcome).toBe("INCONCLUSIVE");
    expect(evidence.cleanup.status).toBe("ARCHIVED");
    expect(drive.movedFileIds).toEqual(["file"]);
    expect(evidence.cleanup.status).not.toBe("NOT_CREATED");
  });

  it("requires numeric nondecreasing Drive version observations", async () => {
    const drive = new FakeDrive();
    drive.invalidVersion = true;
    const evidence = await runLiveDriveCapabilityProbe(config, {
      actorA: drive.client(),
      actorB: drive.client(),
      cleanup: drive.client(),
    });
    expect(evidence.outcome).toBe("UNSUPPORTED");
    expect(evidence.checks).toContainEqual(
      expect.objectContaining({ reason: "invalid-version-observation" }),
    );
  });

  it("uses guarded cleanup fallback and fails closed when cleanup cannot verify", async () => {
    const fallback = new FakeDrive();
    fallback.cleanupConditionalConflict = true;
    const fallbackEvidence = await runLiveDriveCapabilityProbe(config, {
      actorA: fallback.client(),
      actorB: fallback.client(),
      cleanup: fallback.client(),
    });
    expect(fallbackEvidence.cleanup.status).toBe("ARCHIVED");
    expect(fallbackEvidence.cleanup.reason).toBe(
      "archived-with-unconditional-fallback",
    );
    expect(fallbackEvidence.checks).toContainEqual(
      expect.objectContaining({
        id: "cleanup-conditional-conflict",
        ifMatchSent: true,
        operationStatus: 412,
      }),
    );
    expect(fallbackEvidence.checks).toContainEqual(
      expect.objectContaining({
        id: "cleanup-move",
        ifMatchSent: false,
      }),
    );

    const failed = new FakeDrive();
    failed.cleanupMoveFails = true;
    const failedEvidence = await runLiveDriveCapabilityProbe(config, {
      actorA: failed.client(),
      actorB: failed.client(),
      cleanup: failed.client(),
    });
    expect(failedEvidence.cleanup.status).toBe("FAILED");
    expect(failedEvidence.outcome).toBe("INCONCLUSIVE");

    const alreadyArchived = new FakeDrive();
    alreadyArchived.staleParentIgnored = true;
    const alreadyArchivedEvidence = await runLiveDriveCapabilityProbe(config, {
      actorA: alreadyArchived.client(),
      actorB: alreadyArchived.client(),
      cleanup: alreadyArchived.client(),
    });
    expect(alreadyArchivedEvidence.cleanup.status).toBe("ALREADY_ARCHIVED");
  });
});
