import { z } from "zod";

import type { LiveDriveEvidence } from "../live-drive/evidence.js";

const sha256Fingerprint = /^sha256:[a-f0-9]{64}$/;
const utcTimestamp = z
  .string()
  .datetime()
  .refine((value) => value.endsWith("Z"));

const approvalSchema = z
  .object({
    schemaVersion: z.literal(1),
    approvalId: z.string().uuid(),
    gatewayEnvironment: z.string().min(1).max(128),
    driveConfigurationFingerprint: z.string().regex(sha256Fingerprint),
    evidenceSha256: z.string().regex(sha256Fingerprint),
    authMode: z.enum(["shared-drive-adc", "my-drive-refresh-token"]),
    topology: z.enum(["shared-drive", "my-drive"]),
    issuedAt: utcTimestamp,
    expiresAt: utcTimestamp,
  })
  .strict();

export type WriteApproval = z.infer<typeof approvalSchema>;

export interface WriteApprovalBinding {
  readonly gatewayEnvironment: string;
  readonly driveConfigurationFingerprint: string;
  readonly authMode: LiveDriveEvidence["authMode"];
  readonly topology: Exclude<LiveDriveEvidence["topology"], "unknown">;
}

export function parseWriteApproval(value: unknown): WriteApproval {
  return approvalSchema.parse(value);
}
