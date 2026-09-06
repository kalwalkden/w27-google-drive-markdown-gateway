import { z } from "zod";

import {
  canonicalRelativePath,
  isMarkdownName,
  isWellFormedUtf16,
  parseRelativePath,
  utf8ByteSize,
} from "../domain/markdown.js";

export const manifestSchemaVersion =
  "w27-planning-file-migration-manifest-v1" as const;
const categories = { brief: "briefs", spec: "specs", draft: "drafts" } as const;
const sha256 = /^[0-9a-f]{64}$/u;

const entrySchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
    classification: z.enum(["brief", "spec", "draft"]),
    sourcePath: z.string().min(1).max(1_024),
    targetPath: z.string().min(1).max(1_024),
    sourceSha256: z.string().regex(sha256),
    collisionPolicy: z.literal("fail"),
    sourceDisposition: z.literal("frozen-bootstrap-reference"),
  })
  .strict();

export const planningMigrationManifestSchema = z
  .object({
    schemaVersion: z.literal(manifestSchemaVersion),
    topology: z.literal("bounded-nested-v1"),
    entries: z.array(entrySchema).min(1).max(100),
  })
  .strict();

export type PlanningMigrationEntry = z.infer<typeof entrySchema>;
export type PlanningMigrationManifest = z.infer<
  typeof planningMigrationManifestSchema
>;

const prohibitedRoots = new Set([
  ".agents",
  ".git",
  "ai",
  "config",
  "docs",
  "infra",
  "node_modules",
  "src",
  "tests",
]);

export function parsePlanningMigrationManifest(
  value: unknown,
): PlanningMigrationManifest {
  const manifest = planningMigrationManifestSchema.parse(value);
  const keys = new Set<string>();
  const targets = new Set<string>();
  for (const entry of manifest.entries) {
    if (
      !isWellFormedUtf16(entry.sourcePath) ||
      entry.sourcePath.startsWith("/")
    )
      throw new Error("manifest");
    const source = parseRelativePath(entry.sourcePath);
    if (
      source.some((segment) =>
        prohibitedRoots.has(
          segment.normalize("NFC").toLocaleLowerCase("en-US"),
        ),
      )
    )
      throw new Error("manifest");
    const sourceLeaf = source.at(-1);
    if (!sourceLeaf || !isMarkdownName(sourceLeaf)) throw new Error("manifest");
    const target = parseRelativePath(entry.targetPath);
    if (target.length !== 2) throw new Error("manifest");
    if (target[0] !== categories[entry.classification])
      throw new Error("manifest");
    const leaf = target.at(-1);
    if (
      !leaf ||
      !isMarkdownName(leaf) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(leaf) ||
      utf8ByteSize(entry.targetPath) > 1_024
    )
      throw new Error("manifest");
    const normalizedTarget = canonicalRelativePath(
      target.map((segment) => segment.normalize("NFC")),
    ).toLocaleLowerCase("en-US");
    if (keys.has(entry.key) || targets.has(normalizedTarget))
      throw new Error("manifest");
    keys.add(entry.key);
    targets.add(normalizedTarget);
  }
  return manifest;
}
