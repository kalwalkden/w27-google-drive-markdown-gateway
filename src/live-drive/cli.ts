import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AdcAccessTokenProvider,
  RefreshTokenAccessTokenProvider,
} from "./auth.js";
import {
  loadLiveDriveProbeConfig,
  loadOAuthSecret,
  findRepositoryRoot,
  assertOutputOutsideRepository,
  parseLiveDriveProbeArgs,
} from "./config.js";
import { RawDriveClient } from "./drive-client.js";
import { writeEvidenceExclusively } from "./evidence.js";
import { FetchHttpTransport } from "./http.js";
import { runLiveDriveCapabilityProbe } from "./probe.js";

export function exitCode(outcome: string, cleanup: string): number {
  if (cleanup === "FAILED") return 14;
  if (outcome === "SUPPORTED") return 0;
  return outcome === "UNSUPPORTED" ? 11 : 12;
}

export async function main(
  args = process.argv.slice(2),
  environment = process.env,
): Promise<number> {
  try {
    const parsed = parseLiveDriveProbeArgs(args);
    const repositoryRoot = await findRepositoryRoot(process.cwd());
    await assertOutputOutsideRepository(parsed.outputPath, repositoryRoot);
    const config = await loadLiveDriveProbeConfig(parsed.configPath);
    const tokenProvider =
      config.authMode === "shared-drive-adc"
        ? new AdcAccessTokenProvider()
        : new RefreshTokenAccessTokenProvider(
            await loadOAuthSecret(
              environment.W27_DRIVE_PROBE_OAUTH_SECRET_FILE ?? "",
              repositoryRoot,
            ),
          );
    const transport = new FetchHttpTransport();
    const gracefulAbort = new AbortController();
    const abort = () => gracefulAbort.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    const clients = {
      actorA: new RawDriveClient(
        "actor-a",
        tokenProvider,
        transport,
        config.requestTimeoutMs,
        gracefulAbort.signal,
      ),
      actorB: new RawDriveClient(
        "actor-b",
        tokenProvider,
        transport,
        config.requestTimeoutMs,
        gracefulAbort.signal,
      ),
      cleanup: new RawDriveClient(
        "cleanup",
        tokenProvider,
        transport,
        config.requestTimeoutMs,
      ),
    };
    try {
      const evidence = await runLiveDriveCapabilityProbe(config, clients);
      await writeEvidenceExclusively(parsed.outputPath, evidence);
      process.stderr.write(
        `Drive capability probe: ${evidence.outcome}; cleanup: ${evidence.cleanup.status}\n`,
      );
      if (evidence.cleanup.status === "FAILED")
        process.stderr.write(
          "Manual cleanup required: locate the generated probe filename by its run ID in the evidence record.\n",
        );
      return exitCode(evidence.outcome, evidence.cleanup.status);
    } finally {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
  } catch {
    process.stderr.write(
      "Drive capability probe: configuration or execution failed without recording sensitive details.\n",
    );
    return 13;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
