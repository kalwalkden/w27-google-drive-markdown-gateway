import type { WriteGate, WriteLease } from "../write-gate/gate.js";
import type {
  ConditionalWriteResult,
  CreateWriteResult,
  RawDriveWritePort,
} from "./drive-port.js";
import type { FileId, FolderId, Revision } from "../domain/markdown.js";

/** The only mutation boundary available to the application service. */
export interface GuardedDriveWriter {
  createFile(
    lease: WriteLease,
    parentId: FolderId,
    name: string,
    content: string,
  ): Promise<CreateWriteResult>;
  updateFile(
    lease: WriteLease,
    fileId: FileId,
    expectedRevision: Revision,
    content: string,
  ): Promise<ConditionalWriteResult>;
  moveFile(
    lease: WriteLease,
    fileId: FileId,
    expectedRevision: Revision,
    sourceFolderId: FolderId,
    destinationFolderId: FolderId,
  ): Promise<ConditionalWriteResult>;
}

/**
 * Revalidates process-local authority at the last synchronous step before a
 * provider mutation. Evaluation belongs to operator-controlled composition.
 */
export class GuardedDriveWritePort implements GuardedDriveWriter {
  constructor(
    private readonly gate: Pick<WriteGate, "validateLease">,
    private readonly raw: RawDriveWritePort,
  ) {}

  createFile(
    lease: WriteLease,
    parentId: FolderId,
    name: string,
    content: string,
  ): Promise<CreateWriteResult> {
    if (!this.gate.validateLease(lease).allowed)
      return Promise.resolve({ outcome: "unsupported" });
    return this.raw.createFile(parentId, name, content);
  }

  updateFile(
    lease: WriteLease,
    fileId: FileId,
    expectedRevision: Revision,
    content: string,
  ): Promise<ConditionalWriteResult> {
    if (!this.gate.validateLease(lease).allowed)
      return Promise.resolve({ outcome: "unsupported" });
    return this.raw.updateFile(fileId, expectedRevision, content);
  }

  moveFile(
    lease: WriteLease,
    fileId: FileId,
    expectedRevision: Revision,
    sourceFolderId: FolderId,
    destinationFolderId: FolderId,
  ): Promise<ConditionalWriteResult> {
    if (!this.gate.validateLease(lease).allowed)
      return Promise.resolve({ outcome: "unsupported" });
    return this.raw.moveFile(
      fileId,
      expectedRevision,
      sourceFolderId,
      destinationFolderId,
    );
  }
}

/** Safe default until deployment supplies evidence, trust, replay, and approval. */
export class DisabledDriveWritePort implements GuardedDriveWriter {
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
