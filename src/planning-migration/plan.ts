import { createHash } from "node:crypto";

import {
  type PlanningMigrationManifest,
  parsePlanningMigrationManifest,
} from "./manifest.js";
import { sourceDigest } from "./repository.js";

export interface MigrationPlan {
  readonly schemaVersion: "w27-planning-file-migration-plan-v1";
  readonly topology: "bounded-nested-v1";
  readonly manifestSha256: string;
  readonly entryCount: number;
  readonly entries: readonly Readonly<{
    key: string;
    classification: string;
    sourcePath: string;
    targetPath: string;
    sourceBytes: number;
    digestState: "verified";
    collisionPolicy: "fail";
  }>[];
}

export async function buildMigrationPlan(
  root: string,
  input: unknown,
): Promise<MigrationPlan> {
  const manifest = parsePlanningMigrationManifest(input);
  const entries = await Promise.all(
    [...manifest.entries]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(async (entry) => {
        const source = await sourceDigest(root, entry.sourcePath);
        if (source.sha256 !== entry.sourceSha256) throw new Error("digest");
        return {
          key: entry.key,
          classification: entry.classification,
          sourcePath: entry.sourcePath,
          targetPath: entry.targetPath,
          sourceBytes: source.bytes,
          digestState: "verified" as const,
          collisionPolicy: "fail" as const,
        };
      }),
  );
  return {
    schemaVersion: "w27-planning-file-migration-plan-v1",
    topology: manifest.topology,
    manifestSha256: createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex"),
    entryCount: entries.length,
    entries,
  };
}

export const parseManifestForPlan = (
  value: unknown,
): PlanningMigrationManifest => parsePlanningMigrationManifest(value);
