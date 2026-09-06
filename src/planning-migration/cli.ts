#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMigrationPlan } from "./plan.js";
import {
  findPlanningRepositoryRoot,
  readBoundedRepositoryFile,
} from "./repository.js";

const maximumManifestBytes = 262_144;

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    if (args.length !== 2 || args[0] !== "--manifest") throw new Error("usage");
    const root = await findPlanningRepositoryRoot();
    const path = resolve(root, args[1]);
    const bytes = await readBoundedRepositoryFile(
      root,
      path,
      maximumManifestBytes,
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const plan = await buildMigrationPlan(root, JSON.parse(text));
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return 0;
  } catch {
    process.stderr.write(
      "migration plan: invalid local manifest or source state\n",
    );
    return 2;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main().then((code) => {
    process.exitCode = code;
  });
