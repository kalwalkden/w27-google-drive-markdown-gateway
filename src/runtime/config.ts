import { open } from "node:fs/promises";

import { z } from "zod";

import {
  type SecretFileReference,
  type ServiceConfig,
  parseServiceConfig,
} from "../config/service-config.js";
import type { RefreshTokenCredentials } from "../drive/google-drive-auth.js";

export const maxRuntimeConfigBytes = 65_536;
export const maxOAuthSecretFileBytes = 16_384;

export class RuntimeConfigurationError extends Error {
  constructor() {
    super("Runtime configuration is invalid.");
    this.name = "RuntimeConfigurationError";
  }
}

const oauthCredentialsSchema = z
  .object({
    clientId: z.string().trim().min(1).max(4_096),
    clientSecret: z.string().trim().min(1).max(4_096),
    refreshToken: z.string().trim().min(1).max(8_192),
  })
  .strict();

/** Parses deployment-owned, non-secret configuration with a fixed input bound. */
export function parseRuntimeConfigJson(value: unknown): ServiceConfig {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maxRuntimeConfigBytes
  ) {
    throw new RuntimeConfigurationError();
  }
  try {
    return parseServiceConfig(JSON.parse(value));
  } catch {
    throw new RuntimeConfigurationError();
  }
}

export type OAuthSecretReader = (
  reference: SecretFileReference,
  maximumBytes: number,
) => Promise<string>;

async function readBoundedFile(
  reference: SecretFileReference,
  maximumBytes: number,
): Promise<string> {
  const handle = await open(reference, "r");
  try {
    const content = Buffer.alloc(maximumBytes + 1);
    const { bytesRead } = await handle.read(content, 0, content.byteLength, 0);
    if (bytesRead > maximumBytes) throw new Error("secret exceeds bound");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      content.subarray(0, bytesRead),
    );
  } finally {
    await handle.close();
  }
}

/** Reads a mounted My Drive credential only after the typed mode selected it. */
export async function loadOAuthCredentials(
  reference: SecretFileReference,
  readSecretText: OAuthSecretReader = readBoundedFile,
): Promise<RefreshTokenCredentials> {
  try {
    const value = await readSecretText(reference, maxOAuthSecretFileBytes);
    return oauthCredentialsSchema.parse(JSON.parse(value));
  } catch {
    throw new RuntimeConfigurationError();
  }
}
