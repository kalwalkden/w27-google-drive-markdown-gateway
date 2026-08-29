import { access, lstat, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { z } from "zod";

export const testRootMarker = Object.freeze({
  key: "w27MarkdownGatewayTestRoot",
  value: "v1",
});
export const liveConfirmation = "W27_DRIVE_TEST_ONLY";

const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    authMode: z.enum(["shared-drive-adc", "my-drive-refresh-token"]),
    testRootFolderId: z.string().trim().min(1),
    archiveFolderId: z.string().trim().min(1),
    requestTimeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
  })
  .strict()
  .refine((value) => value.testRootFolderId !== value.archiveFolderId, {
    message: "test root and archive must differ",
    path: ["archiveFolderId"],
  });

export type LiveDriveProbeConfig = z.infer<typeof configSchema>;

const oauthSecretSchema = z
  .object({
    clientId: z.string().trim().min(1),
    clientSecret: z.string().trim().min(1),
    refreshToken: z.string().trim().min(1),
  })
  .strict();

export type OAuthSecret = z.infer<typeof oauthSecretSchema>;

export function parseLiveDriveProbeConfig(
  input: unknown,
): LiveDriveProbeConfig {
  return configSchema.parse(input);
}

export function parseLiveDriveProbeArgs(args: readonly string[]): {
  configPath: string;
  outputPath: string;
} {
  if (args[0] !== "run")
    throw new Error("expected the explicit run subcommand");
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !key ||
      !value ||
      !["--config", "--output", "--confirm"].includes(key)
    ) {
      throw new Error("invalid probe arguments");
    }
    if (values.has(key)) throw new Error("duplicate probe argument");
    values.set(key, value);
  }
  if (values.get("--confirm") !== liveConfirmation) {
    throw new Error("explicit test-only confirmation is required");
  }
  const configPath = values.get("--config");
  const outputPath = values.get("--output");
  if (!configPath || !outputPath || values.size !== 3)
    throw new Error("config and output are required");
  return { configPath, outputPath };
}

export async function loadLiveDriveProbeConfig(
  path: string,
): Promise<LiveDriveProbeConfig> {
  return parseLiveDriveProbeConfig(JSON.parse(await readFile(path, "utf8")));
}

export async function findRepositoryRoot(startPath: string): Promise<string> {
  let current = resolve(startPath);
  while (true) {
    try {
      await access(resolve(current, "package.json"));
      await access(resolve(current, "AGENTS.md"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error("repository root was not found");
      current = parent;
    }
  }
}

export async function loadOAuthSecret(
  path: string,
  repositoryRoot: string,
): Promise<OAuthSecret> {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(repositoryRoot);
  const pathFromRoot = relative(resolvedRoot, resolvedPath);
  if (!pathFromRoot.startsWith("..")) {
    throw new Error("OAuth secret file must be outside the repository");
  }
  const file = await lstat(resolvedPath);
  if (!file.isFile() || file.isSymbolicLink())
    throw new Error("OAuth secret must be a regular file");
  if ((file.mode & 0o077) !== 0)
    throw new Error("OAuth secret file must not be group/world readable");
  if (
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    file.uid !== process.getuid()
  ) {
    throw new Error("OAuth secret file must be owned by the current user");
  }
  return oauthSecretSchema.parse(
    JSON.parse(await readFile(resolvedPath, "utf8")),
  );
}
