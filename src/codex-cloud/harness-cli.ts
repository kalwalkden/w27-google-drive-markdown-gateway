#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type CommandRunner, confirmation, runHarness } from "./harness.js";

const maximumOutputBytes = 1_048_576;

function isOutside(path: string, root: string): boolean {
  const value = relative(root, path);
  return (
    Boolean(value) &&
    value !== ".." &&
    !value.startsWith(`..${process.platform === "win32" ? "\\\\" : "/"}`)
  );
}

function parseArgs(args: readonly string[]): {
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

async function externalRegularFile(
  path: string,
  root: string,
): Promise<string> {
  const resolved = resolve(path);
  if (!isOutside(resolved, root)) throw new Error("repository-path");
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe-file");
  return resolved;
}

function mdDriveRunner(): CommandRunner {
  return {
    run: (args) =>
      new Promise((resolveRun, reject) => {
        const child = spawn(
          process.execPath,
          [resolve("dist/codex-cli/cli.js"), ...args],
          {
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
          },
        );
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

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const parsed = parseArgs(args);
    const root = resolve(".");
    const configPath = await externalRegularFile(parsed.configPath, root);
    const outputPath = resolve(parsed.outputPath);
    if (!isOutside(outputPath, root)) throw new Error("repository-path");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const output = await open(
      outputPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    try {
      const evidence = await runHarness(config, confirmation, mdDriveRunner());
      await output.writeFile(`${JSON.stringify(evidence)}\n`, "utf8");
      return evidence.staleConflict === "passed" &&
        evidence.cleanup === "passed"
        ? 0
        : 12;
    } finally {
      await output.close();
    }
  } catch {
    process.stderr.write("codex-cloud harness: BLOCKED\n");
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
