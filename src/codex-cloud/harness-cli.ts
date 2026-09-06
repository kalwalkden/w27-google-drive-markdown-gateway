#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertSanitizedEvidence,
  cloudHarnessConfigSchema,
  type CommandRunner,
  confirmation,
  runHarness,
} from "./harness.js";

const maximumOutputBytes = 1_048_576;

export async function resolveInstallationBoundary(
  anchor = fileURLToPath(import.meta.url),
): Promise<Readonly<{ repositoryRoot: string; cliPath: string }>> {
  const physicalAnchor = await realpath(anchor);
  const repositoryRoot = await realpath(
    resolve(dirname(physicalAnchor), "..", ".."),
  );
  return {
    repositoryRoot,
    cliPath: join(repositoryRoot, "dist", "codex-cli", "cli.js"),
  };
}

export function isOutsideRepository(path: string, root: string): boolean {
  const value = relative(root, path);
  return value === ".." || value.startsWith(`..${sep}`);
}

export function parseHarnessArgs(args: readonly string[]): {
  configPath: string;
  outputPath: string;
} {
  if (args[0] !== "run" || (args.length - 1) % 2 !== 0)
    throw new Error("usage");
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !key ||
      !value ||
      !["--config", "--output", "--confirm"].includes(key) ||
      values.has(key)
    )
      throw new Error("usage");
    values.set(key, value);
  }
  if (values.size !== 3 || values.get("--confirm") !== confirmation)
    throw new Error("confirmation");
  return {
    configPath: values.get("--config") as string,
    outputPath: values.get("--output") as string,
  };
}

export async function externalRegularFile(
  path: string,
  root: string,
): Promise<string> {
  const requested = resolve(path);
  const stat = await lstat(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe-file");
  const [physical, physicalRoot] = await Promise.all([
    realpath(requested),
    realpath(root),
  ]);
  if (!isOutsideRepository(physical, physicalRoot))
    throw new Error("repository-path");
  return physical;
}

async function readExternalConfig(path: string): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximumOutputBytes)
      throw new Error("unsafe-file");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

export async function publishExternalEvidence(
  requestedPath: string,
  root: string,
  value: string,
): Promise<string> {
  const requested = resolve(requestedPath);
  const name = basename(requested);
  if (name === "." || name === "..") throw new Error("unsafe-file");
  const [physicalParent, physicalRoot] = await Promise.all([
    realpath(dirname(requested)),
    realpath(root),
  ]);
  if (!isOutsideRepository(physicalParent, physicalRoot))
    throw new Error("repository-path");
  const destination = join(physicalParent, name);
  try {
    await lstat(destination);
    throw new Error("output-exists");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }
  const temporary = join(physicalParent, `.${name}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(value, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    // A hard-link publish is atomic and fails rather than replacing an
    // existing destination. The temporary file is already complete and synced.
    await link(temporary, destination);
    await unlink(temporary);
    return destination;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export function mdDriveRunner(cliPath: string): CommandRunner {
  return {
    run: (args) =>
      new Promise((resolveRun, reject) => {
        const child = spawn(process.execPath, [cliPath, ...args], {
          shell: false,
          env: Object.fromEntries(
            Object.entries(process.env).filter(([key]) =>
              [
                "MD_DRIVE_GATEWAY_URL",
                "MD_DRIVE_BEARER_TOKEN",
                "MD_DRIVE_BEARER_SECRET_FILE",
              ].includes(key),
            ),
          ),
          stdio: ["ignore", "pipe", "ignore"],
        });
        let stdout = "";
        let bytes = 0;
        child.stdout.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maximumOutputBytes) child.kill();
          else stdout += chunk.toString("utf8");
        });
        child.once("error", () => reject(new Error("process")));
        child.once("close", (code) => {
          if (bytes > maximumOutputBytes || code === null)
            reject(new Error("process"));
          else resolveRun({ exitCode: code, stdout });
        });
      }),
  };
}

export async function main(
  args = process.argv.slice(2),
  runner?: CommandRunner,
  anchor?: string,
): Promise<number> {
  try {
    const parsed = parseHarnessArgs(args);
    const boundary = await resolveInstallationBoundary(anchor);
    const configPath = await externalRegularFile(
      parsed.configPath,
      boundary.repositoryRoot,
    );
    const config = cloudHarnessConfigSchema.parse(
      await readExternalConfig(configPath),
    );
    const evidence = assertSanitizedEvidence(
      await runHarness(
        config,
        confirmation,
        runner ?? mdDriveRunner(boundary.cliPath),
      ),
      {
        forbiddenValues: [config.validationFolder, config.archiveFolder],
      },
    );
    await publishExternalEvidence(
      parsed.outputPath,
      boundary.repositoryRoot,
      `${JSON.stringify(evidence)}\n`,
    );
    return evidence.overall === "passed" ? 0 : 12;
  } catch {
    process.stderr.write("codex-cloud harness: BLOCKED\n");
    return 2;
  }
}

async function runEntrypoint(): Promise<void> {
  const entrypoint = process.argv[1];
  if (!entrypoint) return;
  try {
    const [physicalEntrypoint, physicalModule] = await Promise.all([
      realpath(resolve(entrypoint)),
      realpath(fileURLToPath(import.meta.url)),
    ]);
    if (physicalEntrypoint === physicalModule) process.exitCode = await main();
  } catch {
    process.stderr.write("codex-cloud harness: BLOCKED\n");
    process.exitCode = 2;
  }
}

void runEntrypoint();
