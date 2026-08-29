import { describe, expect, it } from "vitest";

import type { SecretFileReference } from "../../src/config/service-config.js";
import {
  composeRuntime,
  defaultCloudRunPort,
  startRuntime,
} from "../../src/runtime/server.js";

function config(mode: "shared-drive-adc" | "my-drive-refresh-token") {
  const drive = {
    authMode: mode,
    rootFolderId: "root",
    archiveFolderId: "archive",
    maxMarkdownBytes: 1_000,
    maxTraversalNodes: 10,
    maxPages: 1,
    maxResults: 10,
    ...(mode === "shared-drive-adc"
      ? { sharedDriveId: "shared" }
      : { oauthSecretFile: "/var/run/secrets/oauth" }),
  };
  return JSON.stringify({
    drive,
    authentication: {
      workMcp: {
        issuer: "https://issuer.invalid",
        audience: "audience",
        jwksUrl: "https://keys.invalid/jwks",
        allowedAlgorithms: ["RS256"],
        clockToleranceSeconds: 0,
        jwksTimeoutMs: 100,
        jwksCacheMaxAgeMs: 1_000,
      },
      codex: { bearerSecretFile: "/var/run/secrets/codex/bearer" },
    },
    http: {
      maxRequestMarkdownBytes: 1_000,
      maxJsonBodyBytes: 10_096,
      maxResultItems: 10,
      maxJsonResponseBytes: 4_096,
      requestTimeoutMs: 1_000,
      rateLimitWindowMs: 1_000,
      maxRequestsPerWindow: 10,
      maxConcurrentRequestsPerPrincipal: 2,
      maxRateLimitPrincipals: 2,
    },
  });
}

function runtimeDependencies(calls: string[]) {
  return {
    createReadAdapter: (adapterConfig: unknown) => {
      calls.push(JSON.stringify(adapterConfig));
      return {
        async getNode() {
          return undefined;
        },
        async listChildren() {
          return [];
        },
        async listDescendants() {
          return [];
        },
        async searchDirectChildren() {
          return [];
        },
        async searchDescendants() {
          return [];
        },
        async readFile() {
          return undefined;
        },
      };
    },
    createVerifier: () => ({
      async verify() {
        throw new Error("not used by health");
      },
    }),
  };
}

describe("runtime composition", () => {
  it("selects ADC without reading an OAuth secret and leaves writes disabled", async () => {
    const calls: string[] = [];
    let writeSessionProvider: unknown;
    const runtime = await composeRuntime(config("shared-drive-adc"), {
      ...runtimeDependencies(calls),
      readOAuthSecret: async () => {
        throw new Error("ADC must not load OAuth");
      },
      createApiApp: (dependencies) => {
        writeSessionProvider = dependencies.writeSessionProvider;
        return { get() {} } as never;
      },
    });

    expect(calls).toEqual([
      expect.stringContaining('"mode":"shared-drive-adc"'),
    ]);
    expect(runtime.app).toBeDefined();
    expect(writeSessionProvider).toBeUndefined();
  });

  it("loads a bounded OAuth file only for My Drive before composing its adapter", async () => {
    const calls: string[] = [];
    await composeRuntime(config("my-drive-refresh-token"), {
      ...runtimeDependencies(calls),
      readOAuthSecret: async (reference: SecretFileReference, maximumBytes) => {
        expect(reference).toBe("/var/run/secrets/oauth");
        expect(maximumBytes).toBeGreaterThan(0);
        return JSON.stringify({
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
        });
      },
    });
    expect(calls).toEqual([
      expect.stringContaining('"mode":"my-drive-refresh-token"'),
    ]);
  });

  it("rejects missing, malformed, and oversized deployment configuration before listening", async () => {
    let listened = false;
    const dependencies = {
      ...runtimeDependencies([]),
      environment: {},
      listen: () => {
        listened = true;
        return { close() {} };
      },
    };
    await expect(startRuntime(dependencies)).rejects.toThrow(
      "Runtime configuration is invalid.",
    );
    await expect(
      composeRuntime("{".repeat(70_000), runtimeDependencies([])),
    ).rejects.toThrow("Runtime configuration is invalid.");
    expect(listened).toBe(false);
  });

  it("uses the numeric Cloud Run default port and closes on SIGTERM", async () => {
    let port: number | undefined;
    let shutdown: (() => void) | undefined;
    let closed = false;
    await startRuntime({
      ...runtimeDependencies([]),
      environment: { GATEWAY_SERVICE_CONFIG_JSON: config("shared-drive-adc") },
      listen: (_app, value) => {
        port = value;
        return { close: () => (closed = true) };
      },
      waitForListener: async () => {},
      registerSigterm: (handler) => (shutdown = handler),
      logReady: () => {},
    });
    expect(port).toBe(defaultCloudRunPort);
    shutdown?.();
    expect(closed).toBe(true);
  });

  it("imports runtime modules without starting a listener or reading environment", async () => {
    await expect(import("../../src/runtime/config.js")).resolves.toHaveProperty(
      "parseRuntimeConfigJson",
    );
    await expect(import("../../src/runtime/server.js")).resolves.toHaveProperty(
      "startRuntime",
    );
  });
});
