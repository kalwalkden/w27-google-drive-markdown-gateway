import type { Express } from "express";

import { MarkdownService } from "../application/markdown-service.js";
import type { PrincipalVerifier } from "../auth/principal.js";
import { createPrincipalVerifier } from "../auth/principal-verifier.js";
import type { ServiceConfig } from "../config/service-config.js";
import {
  createGoogleDriveReadAdapter,
  type GoogleDriveReadAdapterConfig,
} from "../drive/google-drive-read-adapter.js";
import {
  createJsonApiApp,
  type JsonApiDependencies,
} from "../http/json-api.js";
import {
  loadOAuthCredentials,
  type OAuthSecretReader,
  parseRuntimeConfigJson,
  RuntimeConfigurationError,
} from "./config.js";

export const defaultCloudRunPort = 8080;

export interface RuntimeListener {
  close(callback?: (error?: Error) => void): unknown;
  once?(event: "error" | "listening", listener: () => void): unknown;
}

export interface RuntimeComposition {
  readonly config: ServiceConfig;
  readonly app: Express;
}

export interface RuntimeDependencies {
  readonly parseConfig?: (value: unknown) => ServiceConfig;
  readonly readOAuthSecret?: OAuthSecretReader;
  readonly createReadAdapter?: (
    config: GoogleDriveReadAdapterConfig,
  ) => ConstructorParameters<typeof MarkdownService>[0];
  readonly createVerifier?: (config: ServiceConfig) => PrincipalVerifier;
  readonly createApiApp?: (dependencies: JsonApiDependencies) => Express;
  readonly listen?: (app: Express, port: number) => RuntimeListener;
  readonly waitForListener?: (listener: RuntimeListener) => Promise<void>;
  readonly registerSigterm?: (handler: () => void) => void;
  readonly logReady?: (port: number) => void;
}

export interface StartRuntimeDependencies extends RuntimeDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === "") return defaultCloudRunPort;
  if (!/^[1-9][0-9]{0,4}$/u.test(value)) {
    throw new RuntimeConfigurationError();
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new RuntimeConfigurationError();
  }
  return port;
}

function readAdapterConfig(
  config: ServiceConfig,
  credentials?: Awaited<ReturnType<typeof loadOAuthCredentials>>,
): GoogleDriveReadAdapterConfig {
  const drive = config.drive;
  return {
    rootFolderId: drive.rootFolderId,
    auth:
      drive.authMode === "shared-drive-adc"
        ? { mode: "shared-drive-adc" }
        : {
            mode: "my-drive-refresh-token",
            credentials:
              credentials ??
              (() => {
                throw new RuntimeConfigurationError();
              })(),
          },
    ...(drive.authMode === "shared-drive-adc"
      ? { sharedDriveId: drive.sharedDriveId }
      : {}),
    maxReadBytes: drive.maxMarkdownBytes,
    maxTraversalNodes: drive.maxTraversalNodes,
    maxPages: drive.maxPages,
  };
}

/**
 * Creates the API only after bounded configuration parsing. It leaves write sessions absent, so
 * the JSON API retains its default-disabled write behavior.
 */
export async function composeRuntime(
  configJson: unknown,
  dependencies: RuntimeDependencies = {},
): Promise<RuntimeComposition> {
  const config = (dependencies.parseConfig ?? parseRuntimeConfigJson)(
    configJson,
  );
  const credentials =
    config.drive.authMode === "my-drive-refresh-token"
      ? await loadOAuthCredentials(
          config.drive.oauthSecretFile,
          dependencies.readOAuthSecret,
        )
      : undefined;
  const adapter = (
    dependencies.createReadAdapter ?? createGoogleDriveReadAdapter
  )(readAdapterConfig(config, credentials));
  const service = new MarkdownService(adapter, {
    rootFolderId: config.drive.rootFolderId,
    archiveFolderId: config.drive.archiveFolderId,
    maxMarkdownBytes: config.drive.maxMarkdownBytes,
    defaultSearchLimit: Math.min(20, config.http.maxResultItems),
    maxSearchLimit: config.http.maxResultItems,
    maxListResults: config.http.maxResultItems,
  });
  const app = (dependencies.createApiApp ?? createJsonApiApp)({
    config,
    service,
    principalVerifier: (dependencies.createVerifier ?? createPrincipalVerifier)(
      config,
    ),
  });
  return { config, app };
}

function defaultListen(app: Express, port: number): RuntimeListener {
  return app.listen(port);
}

function waitForListener(listener: RuntimeListener): Promise<void> {
  if (listener.once === undefined) return Promise.resolve();
  return new Promise((resolve, reject) => {
    listener.once?.("listening", resolve);
    listener.once?.("error", () => reject(new RuntimeConfigurationError()));
  });
}

function defaultRegisterSigterm(handler: () => void): void {
  process.once("SIGTERM", handler);
}

function defaultLogReady(port: number): void {
  console.info(`Gateway listening on port ${port}.`);
}

/** Starts the production listener after all configuration and composition checks have passed. */
export async function startRuntime(
  dependencies: StartRuntimeDependencies = {},
): Promise<RuntimeListener> {
  const environment = dependencies.environment ?? process.env;
  const composition = await composeRuntime(
    environment.GATEWAY_SERVICE_CONFIG_JSON,
    dependencies,
  );
  const port = parsePort(environment.PORT);
  const listener = (dependencies.listen ?? defaultListen)(
    composition.app,
    port,
  );
  await (dependencies.waitForListener ?? waitForListener)(listener);
  (dependencies.registerSigterm ?? defaultRegisterSigterm)(() => {
    listener.close();
  });
  (dependencies.logReady ?? defaultLogReady)(port);
  return listener;
}
