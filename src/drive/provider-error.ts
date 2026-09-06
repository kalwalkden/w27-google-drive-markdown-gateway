/**
 * Transport-neutral classification for failures raised by a Drive provider.
 * Its fields are intentionally safe categories, never a provider payload.
 */
export type DriveProviderFailure =
  | "authentication"
  | "not-found"
  | "throttled"
  | "transient"
  | "malformed"
  | "limit"
  | "configuration";

export type DriveProviderOperation =
  | "root-validation"
  | "get-metadata"
  | "list-children"
  | "read-media";

export class DriveProviderError extends Error {
  constructor(
    readonly failure: DriveProviderFailure,
    readonly operation: DriveProviderOperation,
    readonly status?: number,
  ) {
    super(`Google Drive ${operation} failed: ${failure}.`);
    this.name = "GoogleDriveProviderError";
  }
}
