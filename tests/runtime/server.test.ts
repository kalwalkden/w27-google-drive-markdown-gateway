import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express from "express";
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
    maxTraversalNodes: 11,
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
        return express();
      },
      createMcpApp: (dependencies) => {
        expect(dependencies.writeSessionProvider).toBeUndefined();
        return express();
      },
    });

    expect(calls).toEqual([
      expect.stringContaining('"mode":"shared-drive-adc"'),
    ]);
    expect(runtime.app).toBeDefined();
    expect(writeSessionProvider).toBeUndefined();
  });

  it("uses the smaller HTTP result cap for service list enumeration", async () => {
    const parsed = JSON.parse(config("shared-drive-adc")) as {
      http: { maxResultItems: number };
    };
    parsed.http.maxResultItems = 2;
    const listOptions: unknown[] = [];
    let service: { listMarkdown(): Promise<unknown> } | undefined;

    await composeRuntime(JSON.stringify(parsed), {
      ...runtimeDependencies([]),
      createReadAdapter: () => ({
        async getNode() {
          return undefined;
        },
        async listChildren(_folder, options) {
          listOptions.push(options);
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
      }),
      createApiApp: (dependencies) => {
        service = dependencies.service;
        return express();
      },
      createMcpApp: () => express(),
    });

    if (!service) throw new Error("runtime did not compose a service");
    await expect(service.listMarkdown()).resolves.toEqual([]);
    expect(listOptions).toEqual([{ limit: 3, overflowSignal: true }]);
  });

  it("redacts an equal traversal and HTTP result limit before runtime composition", async () => {
    const parsed = JSON.parse(config("shared-drive-adc")) as {
      drive: { maxTraversalNodes: number };
      http: { maxResultItems: number };
    };
    parsed.drive.maxTraversalNodes = parsed.http.maxResultItems;

    await expect(
      composeRuntime(JSON.stringify(parsed), runtimeDependencies([])),
    ).rejects.toThrow("Runtime configuration is invalid.");
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

  it("composes JSON and MCP routes with the same bounded dependencies", async () => {
    let api: unknown;
    let mcp: unknown;
    const auditLogger = { info() {} };
    const metricRecorder = { record() {} };
    const runtime = await composeRuntime(config("shared-drive-adc"), {
      ...runtimeDependencies([]),
      auditLogger,
      metricRecorder,
      createApiApp: (dependencies) => {
        api = dependencies;
        return express();
      },
      createMcpApp: (dependencies) => {
        mcp = dependencies;
        return express();
      },
    });
    if (!api || !mcp)
      throw new Error("runtime did not compose both transports");
    expect(api).toMatchObject({
      config: runtime.config,
      writeSessionProvider: undefined,
    });
    expect(mcp).toMatchObject({
      config: runtime.config,
      writeSessionProvider: undefined,
    });
    expect((api as { service: unknown }).service).toBe(
      (mcp as { service: unknown }).service,
    );
    expect((api as { principalVerifier: unknown }).principalVerifier).toBe(
      (mcp as { principalVerifier: unknown }).principalVerifier,
    );
    expect((api as { auditLogger: unknown }).auditLogger).toBe(auditLogger);
    expect((mcp as { auditLogger: unknown }).auditLogger).toBe(auditLogger);
    expect((api as { metricRecorder: unknown }).metricRecorder).toBe(
      metricRecorder,
    );
    expect((mcp as { metricRecorder: unknown }).metricRecorder).toBe(
      metricRecorder,
    );
  });

  it("serves the real Work MCP protocol at exactly /mcp with Work-only auth", async () => {
    let verified = 0;
    const runtime = await composeRuntime(config("shared-drive-adc"), {
      ...runtimeDependencies([]),
      createVerifier: () => ({
        async verify(value) {
          verified += 1;
          if (value === "Bearer work")
            return { kind: "work-mcp", subject: "work", issuer: "issuer" };
          return { kind: "codex", subject: "codex", issuer: "issuer" };
        },
      }),
    });
    const listener = runtime.app.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const { port } = listener.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${port}/mcp`;
    try {
      const client = new Client({ name: "runtime-test", version: "1.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint), {
          requestInit: { headers: { Authorization: "Bearer work" } },
        }),
      );
      await expect(client.listTools()).resolves.toMatchObject({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "list_markdown" }),
          expect.objectContaining({ name: "archive_markdown" }),
        ]),
      });
      await client.close();

      const nonWork = await fetch(`${endpoint}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer codex",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(nonWork.status).toBe(404);

      const unauthorized = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer codex",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      });
      expect(unauthorized.status).toBe(401);
      expect(verified).toBeGreaterThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
