#!/usr/bin/env node
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cutoverConfirmation,
  evaluateCutoverPreflight,
  writeCutoverEvidenceExclusively,
} from "./cutover-evidence.js";
import { buildMigrationPlan } from "./plan.js";
import {
  findPlanningRepositoryRoot,
  readBoundedRepositoryFile,
} from "./repository.js";

const maximumConfigBytes = 262_144;
const outside = (root: string, path: string) => {
  const value = relative(root, path);
  return (
    value === ".." ||
    value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  );
};

type AncestorFacts = Readonly<{
  readonly path: string;
  readonly dev: bigint;
  readonly ino: bigint;
}>;

async function physicalAncestors(path: string): Promise<AncestorFacts[]> {
  const facts: AncestorFacts[] = [];
  for (let current = resolve(path); ; current = dirname(current)) {
    const stat = await lstat(current, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error("path");
    facts.push({ path: current, dev: stat.dev, ino: stat.ino });
    if (dirname(current) === current) return facts;
  }
}

async function logicalAncestors(path: string): Promise<void> {
  for (let current = resolve(path); ; current = dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error("path");
    if (dirname(current) === current) return;
  }
}

async function assertStableAncestors(
  expected: readonly AncestorFacts[],
): Promise<void> {
  const actual = await Promise.all(
    expected.map(async (fact) => {
      const stat = await lstat(fact.path, { bigint: true });
      return {
        path: fact.path,
        dev: stat.dev,
        ino: stat.ino,
        symlink: stat.isSymbolicLink(),
      };
    }),
  );
  if (
    actual.some(
      (fact, index) =>
        fact.symlink ||
        fact.dev !== expected[index]?.dev ||
        fact.ino !== expected[index]?.ino,
    )
  )
    throw new Error("path");
}

function args(
  values: readonly string[],
): Readonly<{ config: string; manifest: string; output: string }> {
  if (values[0] !== "run" || values.length !== 9) throw new Error("usage");
  const map = new Map<string, string>();
  for (let index = 1; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (
      !key ||
      !value ||
      !["--config", "--manifest", "--output", "--confirm"].includes(key) ||
      map.has(key)
    )
      throw new Error("usage");
    map.set(key, value);
  }
  if (map.size !== 4 || map.get("--confirm") !== cutoverConfirmation)
    throw new Error("usage");
  return {
    config: map.get("--config") as string,
    manifest: map.get("--manifest") as string,
    output: map.get("--output") as string,
  };
}

export async function main(values = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = args(values);
    const root = await findPlanningRepositoryRoot();
    const manifestPath = resolve(root, parsed.manifest);
    const manifestText = new TextDecoder("utf-8", { fatal: true }).decode(
      await readBoundedRepositoryFile(root, manifestPath, maximumConfigBytes),
    );
    const configPath = resolve(parsed.config);
    const outputPath = resolve(parsed.output);
    const canonicalRoot = await realpath(root);
    if (!outside(root, configPath) || !outside(root, outputPath))
      throw new Error("path");
    await logicalAncestors(configPath);
    await logicalAncestors(dirname(outputPath));
    const canonicalConfig = await realpath(configPath);
    const canonicalOutputParent = await realpath(dirname(outputPath));
    const canonicalOutputPath = resolve(
      canonicalOutputParent,
      basename(outputPath),
    );
    if (
      !outside(canonicalRoot, canonicalConfig) ||
      !outside(canonicalRoot, canonicalOutputParent)
    )
      throw new Error("path");
    const configAncestors = await physicalAncestors(canonicalConfig);
    const outputAncestors = await physicalAncestors(canonicalOutputParent);
    const configText = new TextDecoder("utf-8", { fatal: true }).decode(
      await readBoundedRepositoryFile(
        dirname(canonicalConfig),
        canonicalConfig,
        maximumConfigBytes,
      ),
    );
    await assertStableAncestors(configAncestors);
    const config = JSON.parse(configText);
    const plan = await buildMigrationPlan(root, JSON.parse(manifestText));
    const evidence = evaluateCutoverPreflight(
      config,
      plan,
      new Date().toISOString(),
    );
    const parent = await lstat(canonicalOutputParent);
    if (!parent.isDirectory() || parent.isSymbolicLink())
      throw new Error("output");
    if ((await realpath(dirname(outputPath))) !== canonicalOutputParent)
      throw new Error("output");
    await assertStableAncestors(outputAncestors);
    const outputParent = outputAncestors[0];
    if (!outputParent) throw new Error("output");
    await writeCutoverEvidenceExclusively(canonicalOutputPath, evidence, {
      path: canonicalOutputParent,
      dev: outputParent.dev,
      ino: outputParent.ino,
    });
    await assertStableAncestors(outputAncestors);
    process.stdout.write("planning cutover preflight: recorded\n");
    return evidence.overall === "BLOCKED" ? 11 : 12;
  } catch {
    process.stderr.write("planning cutover preflight: invalid local input\n");
    return 2;
  }
}

if (process.argv[1])
  void Promise.all([
    realpath(process.argv[1]),
    realpath(fileURLToPath(import.meta.url)),
  ]).then(([invoked, entrypoint]) => {
    if (invoked === entrypoint)
      void main().then((code) => {
        process.exitCode = code;
      });
  });
