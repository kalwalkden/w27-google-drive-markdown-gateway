import { chmod, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliUrl = new URL("../dist/codex-cli/cli.js", import.meta.url);

await chmod(cliUrl, 0o755);

const mode = (await stat(cliUrl)).mode;
if (process.platform !== "win32" && (mode & 0o111) === 0) {
  throw new Error("Built md-drive CLI is not executable.");
}

if (process.platform !== "win32") {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(fileURLToPath(cliUrl), ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
  if (
    output.code !== 0 ||
    output.stdout !== "0.1.0\n" ||
    output.stderr !== ""
  ) {
    throw new Error("Built md-drive CLI self-check failed.");
  }
}
