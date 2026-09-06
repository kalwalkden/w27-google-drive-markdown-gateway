import type {
  ConditionalWriteResult,
  CreateWriteResult,
  RawDriveWritePort,
} from "./drive-port.js";
import type { FileId, FolderId, Revision } from "../domain/markdown.js";

interface EnabledWriterState {
  readonly kind: "enabled";
  readonly raw: RawDriveWritePort;
}

interface DisabledWriterState {
  readonly kind: "disabled";
}

type WriterState = EnabledWriterState | DisabledWriterState;

// This is the authority boundary. Instances carry no mutable or dispatchable
// state; only an exact object key can retrieve its module-private state.
const writerStates = new WeakMap<object, WriterState>();

function isRawDriveWritePort(value: unknown): value is RawDriveWritePort {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RawDriveWritePort>;
  return (
    typeof candidate.createFile === "function" &&
    typeof candidate.updateFile === "function" &&
    typeof candidate.moveFile === "function"
  );
}

/** A module-authenticated writer capability accepted by MarkdownService. */
export type GuardedDriveWriter = GuardedDriveWritePort | DisabledDriveWritePort;

/**
 * The constructor is final so an alternate state cannot be installed by a
 * subclass. Runtime composition only creates this object in write-enabled
 * deployments, and its raw port remains module-private.
 */
export class GuardedDriveWritePort {
  constructor(raw: RawDriveWritePort) {
    if (new.target !== GuardedDriveWritePort) {
      throw new TypeError("GuardedDriveWritePort cannot be subclassed.");
    }
    if (!isRawDriveWritePort(raw)) {
      throw new TypeError(
        "GuardedDriveWritePort requires a raw Drive write port.",
      );
    }
    writerStates.set(this, { kind: "enabled", raw });
  }
}

/** Safe default for read-only deployments. */
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
  parentId: FolderId,
  name: string,
  content: string,
): Promise<CreateWriteResult> {
  const state = writerStates.get(writer);
  if (!state || state.kind === "disabled") {
    return Promise.resolve({ outcome: "unsupported" });
  }
  return state.raw.createFile(parentId, name, content);
}

export function guardedUpdateFile(
  writer: GuardedDriveWriter,
  fileId: FileId,
  expectedRevision: Revision,
  content: string,
): Promise<ConditionalWriteResult> {
  const state = writerStates.get(writer);
  if (!state || state.kind === "disabled") {
    return Promise.resolve({ outcome: "unsupported" });
  }
  return state.raw.updateFile(fileId, expectedRevision, content);
}

export function guardedMoveFile(
  writer: GuardedDriveWriter,
  fileId: FileId,
  expectedRevision: Revision,
  sourceFolderId: FolderId,
  destinationFolderId: FolderId,
): Promise<ConditionalWriteResult> {
  const state = writerStates.get(writer);
  if (!state || state.kind === "disabled") {
    return Promise.resolve({ outcome: "unsupported" });
  }
  return state.raw.moveFile(
    fileId,
    expectedRevision,
    sourceFolderId,
    destinationFolderId,
  );
}
