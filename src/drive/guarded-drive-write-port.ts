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

interface EnabledWriterState {
  readonly kind: "enabled";
  readonly gate: WriteGate;
  readonly raw: RawDriveWritePort;
}

interface DisabledWriterState {
  readonly kind: "disabled";
}

type WriterState = EnabledWriterState | DisabledWriterState;

// This is the authority boundary. Instances carry no mutable or dispatchable
// state; only an exact object key can retrieve its module-private state.
const writerStates = new WeakMap<object, WriterState>();

/** A module-authenticated writer capability accepted by MarkdownService. */
export type GuardedDriveWriter = GuardedDriveWritePort | DisabledDriveWritePort;

/**
 * Revalidates process-local authority at the last synchronous step before a
 * provider mutation. The constructor is final so an alternate state cannot be
 * installed by a subclass.
 */
export class GuardedDriveWritePort {
  constructor(gate: WriteGate, raw: RawDriveWritePort) {
    if (new.target !== GuardedDriveWritePort) {
      throw new TypeError("GuardedDriveWritePort cannot be subclassed.");
    }
    writerStates.set(this, { kind: "enabled", gate, raw });
  }
}

/** Safe default until deployment supplies evidence, trust, replay, and approval. */
export class DisabledDriveWritePort {
  constructor() {
    if (new.target !== DisabledDriveWritePort) {
      throw new TypeError("DisabledDriveWritePort cannot be subclassed.");
    }
    writerStates.set(this, { kind: "disabled" });
  }
}

export function isGuardedDriveWriter(
  value: unknown,
): value is GuardedDriveWriter {
  return typeof value === "object" && value !== null && writerStates.has(value);
}

export function guardedCreateFile(
  writer: GuardedDriveWriter,
  lease: WriteLease,
  parentId: FolderId,
  name: string,
  content: string,
): Promise<CreateWriteResult> {
  const state = writerStates.get(writer);
  if (!state || state.kind === "disabled") {
    return Promise.resolve({ outcome: "unsupported" });
  }
  if (!validateWriteLease(state.gate, lease).allowed) {
    return Promise.resolve({ outcome: "unsupported" });
  }
  return state.raw.createFile(parentId, name, content);
}

export function guardedUpdateFile(
  writer: GuardedDriveWriter,
  lease: WriteLease,
  fileId: FileId,
  expectedRevision: Revision,
  content: string,
): Promise<ConditionalWriteResult> {
  const state = writerStates.get(writer);
  if (!state || state.kind === "disabled") {
    return Promise.resolve({ outcome: "unsupported" });
  }
  if (!validateWriteLease(state.gate, lease).allowed) {
    return Promise.resolve({ outcome: "unsupported" });
  }
  return state.raw.updateFile(fileId, expectedRevision, content);
}

export function guardedMoveFile(
  writer: GuardedDriveWriter,
  lease: WriteLease,
  fileId: FileId,
  expectedRevision: Revision,
  sourceFolderId: FolderId,
  destinationFolderId: FolderId,
): Promise<ConditionalWriteResult> {
  const state = writerStates.get(writer);
  if (!state || state.kind === "disabled") {
    return Promise.resolve({ outcome: "unsupported" });
  }
  if (!validateWriteLease(state.gate, lease).allowed) {
    return Promise.resolve({ outcome: "unsupported" });
  }
  return state.raw.moveFile(
    fileId,
    expectedRevision,
    sourceFolderId,
    destinationFolderId,
  );
}
