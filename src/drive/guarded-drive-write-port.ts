import {
  type WriteGate,
  type WriteLease,
  validateWriteLease,
} from "../write-gate/gate.js";
import type {
  ConditionalWriteResult,
  CreateWriteResult,
  RawDriveWritePort,
} from "./drive-port.js";
import type { FileId, FolderId, Revision } from "../domain/markdown.js";

const writerConstructionKey = Symbol("guarded-drive-writer-construction-key");

/**
 * Nominal application write capability. Only this module can compose one with
 * a real WriteGate, so a structural object cannot bypass lease validation.
 */
export abstract class GuardedDriveWriter {
  readonly #capabilityBrand = true;

  protected constructor(key: symbol) {
    if (key !== writerConstructionKey) {
      throw new TypeError(
        "GuardedDriveWriter cannot be constructed outside this module.",
      );
    }
  }

  static isCapability(value: unknown): value is GuardedDriveWriter {
    if (!(value instanceof GuardedDriveWriter)) return false;
    try {
      return value.#capabilityBrand;
    } catch {
      return false;
    }
  }

  abstract createFile(
    lease: WriteLease,
    parentId: FolderId,
    name: string,
    content: string,
  ): Promise<CreateWriteResult>;
  abstract updateFile(
    lease: WriteLease,
    fileId: FileId,
    expectedRevision: Revision,
    content: string,
  ): Promise<ConditionalWriteResult>;
  abstract moveFile(
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
export class GuardedDriveWritePort extends GuardedDriveWriter {
  constructor(
    private readonly gate: WriteGate,
    private readonly raw: RawDriveWritePort,
  ) {
    super(writerConstructionKey);
  }

  createFile(
    lease: WriteLease,
    parentId: FolderId,
    name: string,
    content: string,
  ): Promise<CreateWriteResult> {
    if (!validateWriteLease(this.gate, lease).allowed)
      return Promise.resolve({ outcome: "unsupported" });
    return this.raw.createFile(parentId, name, content);
  }

  updateFile(
    lease: WriteLease,
    fileId: FileId,
    expectedRevision: Revision,
    content: string,
  ): Promise<ConditionalWriteResult> {
    if (!validateWriteLease(this.gate, lease).allowed)
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
    if (!validateWriteLease(this.gate, lease).allowed)
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
export class DisabledDriveWritePort extends GuardedDriveWriter {
  constructor() {
    super(writerConstructionKey);
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
