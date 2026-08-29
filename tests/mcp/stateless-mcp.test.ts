import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { describe, expect, it } from "vitest";

import type { MarkdownWriteSession } from "../../src/application/markdown-service.js";
import {
  AuthenticationError,
  type PrincipalVerifier,
} from "../../src/auth/principal.js";
import { parseServiceConfig } from "../../src/config/service-config.js";
import {
  fileId,
  MarkdownGatewayError,
  revision,
} from "../../src/domain/markdown.js";
import { DriveProviderError } from "../../src/drive/provider-error.js";
import {
  createStatelessMcpApp,
  type StatelessMcpDependencies,
} from "../../src/mcp/stateless-mcp.js";
import type {
  MarkdownApiAuditEvent,
  MarkdownMetricObservation,
} from "../../src/observability/audit.js";

const metadata = {
  relativePath: "guide.md",
  fileId: fileId("guide-file"),
  revision: revision("one"),
  modifiedTime: "2026-01-01T00:00:00.000Z",
  size: 5,
};

function config() {
  return parseServiceConfig({
    drive: {
      authMode: "shared-drive-adc",
      rootFolderId: "root",
      archiveFolderId: "archive",
      sharedDriveId: "drive",
      maxMarkdownBytes: 1_000,
      maxTraversalNodes: 11,
      maxPages: 1,
      maxResults: 10,
    },
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
      codex: { bearerSecretFile: "/var/run/secrets/codex" },
    },
    http: {
      maxRequestMarkdownBytes: 100,
      maxJsonBodyBytes: 4_696,
      maxResultItems: 10,
      maxJsonResponseBytes: 16_384,
      requestTimeoutMs: 1_000,
      rateLimitWindowMs: 1_000,
      maxRequestsPerWindow: 10,
      maxConcurrentRequestsPerPrincipal: 2,
      maxRateLimitPrincipals: 2,
    },
  });
}

function fakeService(calls: string[]): StatelessMcpDependencies["service"] {
  return {
    async listMarkdown(input) {
      calls.push(`list:${String(input?.recursive)}`);
      return [metadata];
    },
    async searchMarkdown(input) {
      calls.push(`search:${input.query}:${String(input.limit)}`);
      return [{ ...metadata, excerpt: "found" }];
    },
    async readMarkdown(input) {
      calls.push(`read:${"fileId" in input ? input.fileId : input.path}`);
      return { ...metadata, content: "hello" };
    },
  };
}

function verifier(calls: unknown[]): PrincipalVerifier {
  return {
    async verify(value) {
      calls.push(value);
      if (value !== "Bearer work") throw new AuthenticationError();
      return { kind: "work-mcp", subject: "work-user", issuer: "issuer" };
    },
  };
}

async function start(
  overrides: Partial<StatelessMcpDependencies> = {},
): Promise<{
  readonly dependencies: StatelessMcpDependencies;
  readonly endpoint: string;
  readonly close: () => Promise<void>;
  readonly connect: () => Promise<Client>;
}> {
  const calls: string[] = [];
  const verificationCalls: unknown[] = [];
  const dependencies: StatelessMcpDependencies = {
    config: config(),
    service: fakeService(calls),
    principalVerifier: verifier(verificationCalls),
    auditLogger: { info() {} },
    ...overrides,
  };
  const app = createStatelessMcpApp(dependencies);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    dependencies,
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
    async connect() {
      const client = new Client({ name: "mcp-test", version: "1.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${address.port}/mcp`),
          { requestInit: { headers: { Authorization: "Bearer work" } } },
        ),
      );
      return client;
    },
  };
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>) {
  if (!("content" in result)) throw new Error("expected standard tool result");
  return result.structuredContent;
}

async function rawMcpResponse(
  endpoint: string,
  body: unknown,
): Promise<{ readonly response: Response; readonly text: string }> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer work",
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { response, text: await response.text() };
}

describe("stateless MCP adapter", () => {
  it("emits exactly one terminal telemetry set for a successful tool call", async () => {
    const events: MarkdownApiAuditEvent[] = [];
    const metrics: MarkdownMetricObservation[] = [];
    const fixture = await start({
      auditLogger: { info: (event) => events.push(event) },
      metricRecorder: { record: (observation) => metrics.push(observation) },
      operationId: () => "mcp-success-operation",
    });
    try {
      const result = await rawMcpResponse(fixture.endpoint, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "read_markdown",
          arguments: { fileId: "SENTINEL-MCP-FILE-ID" },
        },
      });
      expect(result.response.status).toBe(200);
      expect(events).toEqual([
        expect.objectContaining({
          event: "markdown-api-request",
          operationId: "mcp-success-operation",
          operation: "mcp",
          result: "succeeded",
          statusCode: 200,
        }),
      ]);
      expect(metrics).toEqual([
        { metric: "gateway_http_in_flight", operation: "mcp", value: 1 },
        {
          metric: "gateway_http_requests_total",
          operation: "mcp",
          principalKind: "work-mcp",
          result: "succeeded",
        },
        {
          metric: "gateway_http_request_duration_ms",
          operation: "mcp",
          result: "succeeded",
          value: expect.any(Number),
        },
        { metric: "gateway_http_in_flight", operation: "mcp", value: -1 },
      ]);
      expect(JSON.stringify({ events, metrics })).not.toContain(
        "SENTINEL-MCP-FILE-ID",
      );
    } finally {
      await fixture.close();
    }
  });

  it("classifies an SDK JSON-RPC error as one invalid request terminal result", async () => {
    const events: MarkdownApiAuditEvent[] = [];
    const metrics: MarkdownMetricObservation[] = [];
    const fixture = await start({
      auditLogger: { info: (event) => events.push(event) },
      metricRecorder: { record: (observation) => metrics.push(observation) },
    });
    try {
      const result = await rawMcpResponse(fixture.endpoint, {
        jsonrpc: "2.0",
        id: 1,
        method: "SENTINEL-UNSUPPORTED-SDK-METHOD",
      });
      const envelope = JSON.parse(result.text) as { error?: unknown };
      expect(envelope.error).toBeDefined();
      expect(events).toEqual([
        expect.objectContaining({
          operation: "mcp",
          result: "invalid_request",
          statusCode: result.response.status,
        }),
      ]);
      expect(metrics).toEqual([
        { metric: "gateway_http_in_flight", operation: "mcp", value: 1 },
        {
          metric: "gateway_http_requests_total",
          operation: "mcp",
          principalKind: "work-mcp",
          result: "invalid_request",
        },
        {
          metric: "gateway_http_request_duration_ms",
          operation: "mcp",
          result: "invalid_request",
          value: expect.any(Number),
        },
        { metric: "gateway_http_in_flight", operation: "mcp", value: -1 },
      ]);
      expect(JSON.stringify({ events, metrics })).not.toContain(
        "SENTINEL-UNSUPPORTED-SDK-METHOD",
      );
    } finally {
      await fixture.close();
    }
  });

  it("emits one closed terminal telemetry set for Work MCP auth failures and Drive tool failures", async () => {
    const events: MarkdownApiAuditEvent[] = [];
    const metrics: MarkdownMetricObservation[] = [];
    const fixture = await start({
      service: {
        async listMarkdown() {
          throw new DriveProviderError("transient", "list-children");
        },
        async searchMarkdown() {
          return [];
        },
        async readMarkdown() {
          return { ...metadata, content: "hello" };
        },
      },
      auditLogger: { info: (event) => events.push(event) },
      metricRecorder: { record: (observation) => metrics.push(observation) },
      operationId: (() => {
        let number = 0;
        return () => `mcp-operation-${++number}`;
      })(),
    });
    try {
      const unauthorized = await fetch(fixture.endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer SENTINEL-UNTRUSTED-CREDENTIAL",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(unauthorized.status).toBe(401);

      const driveFailure = await rawMcpResponse(fixture.endpoint, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_markdown", arguments: {} },
      });
      expect(driveFailure.response.status).toBe(200);

      expect(events).toEqual([
        expect.objectContaining({
          event: "markdown-api-request",
          operationId: "mcp-operation-1",
          operation: "mcp",
          principal: { kind: "unauthenticated" },
          result: "unauthenticated",
          statusCode: 401,
        }),
        expect.objectContaining({
          event: "markdown-api-request",
          operationId: "mcp-operation-2",
          operation: "mcp",
          principal: {
            kind: "work-mcp",
            subject: "work-user",
            issuer: "issuer",
          },
          result: "upstream_unavailable",
          statusCode: 200,
          dependency: "drive",
          dependencyFailure: "transient",
        }),
      ]);
      expect(metrics).toEqual([
        {
          metric: "gateway_http_in_flight",
          operation: "mcp",
          value: 1,
        },
        {
          metric: "gateway_http_requests_total",
          operation: "mcp",
          principalKind: "unauthenticated",
          result: "unauthenticated",
        },
        {
          metric: "gateway_http_request_duration_ms",
          operation: "mcp",
          result: "unauthenticated",
          value: expect.any(Number),
        },
        {
          metric: "gateway_http_in_flight",
          operation: "mcp",
          value: -1,
        },
        {
          metric: "gateway_http_in_flight",
          operation: "mcp",
          value: 1,
        },
        {
          metric: "gateway_http_requests_total",
          operation: "mcp",
          principalKind: "work-mcp",
          result: "upstream_unavailable",
        },
        {
          metric: "gateway_http_request_duration_ms",
          operation: "mcp",
          result: "upstream_unavailable",
          value: expect.any(Number),
        },
        {
          metric: "gateway_http_in_flight",
          operation: "mcp",
          value: -1,
        },
        {
          metric: "gateway_dependency_failures_total",
          operation: "mcp",
          dependency: "drive",
          failure: "transient",
        },
      ]);
      const serialized = JSON.stringify({ events, metrics });
      expect(serialized).not.toContain("SENTINEL-UNTRUSTED-CREDENTIAL");
      expect(serialized).not.toContain('"list_markdown"');
    } finally {
      await fixture.close();
    }
  });

  it("preserves MCP responses when audit and metric sinks throw", async () => {
    const fixture = await start({
      auditLogger: {
        info() {
          throw new Error("SENTINEL-AUDIT-SINK");
        },
      },
      metricRecorder: {
        record() {
          throw new Error("SENTINEL-METRIC-SINK");
        },
      },
    });
    try {
      const response = await rawMcpResponse(fixture.endpoint, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      expect(response.response.status).toBe(200);
      expect(response.text).not.toContain("SENTINEL");
    } finally {
      await fixture.close();
    }
  });

  it("advertises exactly the six safe tools and delegates each through the shared seams", async () => {
    const calls: string[] = [];
    const session: MarkdownWriteSession = {
      async createMarkdown(input) {
        calls.push(`create:${input.path}`);
        return metadata;
      },
      async updateMarkdown(input) {
        calls.push(`update:${input.expectedRevision}`);
        return metadata;
      },
      async archiveMarkdown(input) {
        calls.push(`archive:${input.expectedRevision}`);
        return metadata;
      },
    };
    const fixture = await start({
      service: fakeService(calls),
      writeSessionProvider: { getWriteSession: () => session },
    });
    try {
      const client = await fixture.connect();
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        "list_markdown",
        "search_markdown",
        "read_markdown",
        "create_markdown",
        "update_markdown",
        "archive_markdown",
      ]);
      expect(listed.tools.map((tool) => tool.annotations)).toEqual([
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
        {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
        {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      ]);
      expect(listed.tools[4]?.description).toContain("CONFLICT");
      expect(listed.tools[5]?.description).toContain("never deletes");
      const listOutputSchema = listed.tools[0]?.outputSchema;
      expect(listOutputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
        oneOf: [
          { required: ["ok", "data"], properties: { ok: { const: true } } },
          {
            required: ["ok", "error"],
            properties: { ok: { const: false } },
          },
        ],
      });
      if (!listOutputSchema) throw new Error("missing list output schema");
      const validate = new AjvJsonSchemaValidator().getValidator(
        listOutputSchema,
      );
      expect(validate({ ok: true, data: { items: [metadata] } }).valid).toBe(
        true,
      );
      expect(
        validate({
          ok: false,
          error: { code: "INTERNAL", message: "Internal server error." },
        }).valid,
      ).toBe(true);
      expect(validate({ ok: true }).valid).toBe(false);
      expect(
        validate({
          ok: true,
          data: { items: [metadata] },
          error: { code: "INTERNAL", message: "Internal server error." },
        }).valid,
      ).toBe(false);
      expect(validate({ ok: false, data: { items: [metadata] } }).valid).toBe(
        false,
      );

      expect(
        structured(
          await client.callTool({
            name: "list_markdown",
            arguments: { recursive: true },
          }),
        ),
      ).toEqual({ ok: true, data: { items: [metadata] } });
      expect(
        structured(
          await client.callTool({
            name: "search_markdown",
            arguments: { query: "release", limit: 2 },
          }),
        ),
      ).toEqual({
        ok: true,
        data: { items: [{ ...metadata, excerpt: "found" }] },
      });
      expect(
        structured(
          await client.callTool({
            name: "read_markdown",
            arguments: { fileId: "guide-file" },
          }),
        ),
      ).toEqual({ ok: true, data: { ...metadata, content: "hello" } });
      for (const [name, arguments_] of [
        ["create_markdown", { path: "new.md", content: "new" }],
        [
          "update_markdown",
          { fileId: "guide-file", expectedRevision: "one", content: "new" },
        ],
        ["archive_markdown", { path: "guide.md", expectedRevision: "one" }],
      ] as const) {
        expect(
          structured(await client.callTool({ name, arguments: arguments_ })),
        ).toEqual({
          ok: true,
          data: metadata,
        });
      }
      expect(calls).toEqual([
        "list:true",
        "search:release:2",
        "read:guide-file",
        "create:new.md",
        "update:one",
        "archive:one",
      ]);
      await client.close();
    } finally {
      await fixture.close();
    }
  });

  it("authenticates every request before protocol dispatch and accepts only Work principals", async () => {
    let serviceCalls = 0;
    let verifierCalls = 0;
    const fixture = await start({
      service: {
        async listMarkdown() {
          serviceCalls += 1;
          return [metadata];
        },
        async searchMarkdown() {
          serviceCalls += 1;
          return [];
        },
        async readMarkdown() {
          serviceCalls += 1;
          return { ...metadata, content: "hello" };
        },
      },
      principalVerifier: {
        async verify(value) {
          verifierCalls += 1;
          expect(value).toBe("Bearer dangerous-token");
          return { kind: "codex", subject: "codex", issuer: "issuer" };
        },
      },
    });
    try {
      const response = await fetch(fixture.endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer dangerous-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("dangerous-token");
      expect(serviceCalls).toBe(0);
      expect(verifierCalls).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  it("uses no MCP session identifier and safely serves overlapping stateless requests", async () => {
    let calls = 0;
    const fixture = await start({
      service: {
        async listMarkdown() {
          calls += 1;
          return [metadata];
        },
        async searchMarkdown() {
          return [];
        },
        async readMarkdown() {
          return { ...metadata, content: "hello" };
        },
      },
    });
    try {
      const initialized = await fetch(fixture.endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer work",
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "mcp-test", version: "1.0.0" },
          },
        }),
      });
      expect(initialized.status).toBe(200);
      expect(initialized.headers.get("mcp-session-id")).toBeNull();

      const first = await fixture.connect();
      const second = await fixture.connect();
      await Promise.all([
        first.callTool({ name: "list_markdown", arguments: {} }),
        second.callTool({ name: "list_markdown", arguments: {} }),
      ]);
      expect(calls).toBe(2);
      await first.close();
      await second.close();
    } finally {
      await fixture.close();
    }
  });

  it("keeps malformed protocol bodies generic after authentication", async () => {
    const fixture = await start();
    try {
      const response = await fetch(fixture.endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer work",
          "Content-Type": "application/json",
        },
        body: '{"SENTINEL-BODY":',
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toBe(
        JSON.stringify({ error: "Request validation failed." }),
      );
    } finally {
      await fixture.close();
    }
  });

  it("rejects response-expanding IDs and batches before tool dispatch", async () => {
    let reads = 0;
    const fixture = await start({
      service: {
        async listMarkdown() {
          return [];
        },
        async searchMarkdown() {
          return [];
        },
        async readMarkdown() {
          reads += 1;
          return { ...metadata, content: "SENTINEL-SHOULD-NOT-LEAK" };
        },
      },
    });
    try {
      const longId = await rawMcpResponse(fixture.endpoint, {
        jsonrpc: "2.0",
        id: "x".repeat(3_800),
        method: "tools/call",
        params: { name: "read_markdown", arguments: { fileId: "guide-file" } },
      });
      expect(longId.response.status).toBe(400);
      expect(Buffer.byteLength(longId.text, "utf8")).toBeLessThanOrEqual(
        fixture.dependencies.config.http.maxJsonResponseBytes,
      );
      expect(JSON.parse(longId.text)).toMatchObject({
        jsonrpc: "2.0",
        error: { code: -32600 },
        id: null,
      });
      expect(longId.text).not.toContain("SENTINEL-SHOULD-NOT-LEAK");

      const singleMessageBatch = await rawMcpResponse(fixture.endpoint, [
        {
          jsonrpc: "2.0",
          id: "x".repeat(3_800),
          method: "tools/call",
          params: {
            name: "read_markdown",
            arguments: { fileId: "guide-file" },
          },
        },
      ]);
      expect(singleMessageBatch.response.status).toBe(400);
      expect(
        Buffer.byteLength(singleMessageBatch.text, "utf8"),
      ).toBeLessThanOrEqual(
        fixture.dependencies.config.http.maxJsonResponseBytes,
      );
      expect(JSON.parse(singleMessageBatch.text)).toMatchObject({
        jsonrpc: "2.0",
        error: { code: -32600 },
        id: null,
      });

      const batch = await rawMcpResponse(fixture.endpoint, [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "read_markdown",
            arguments: { fileId: "guide-file" },
          },
        },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "read_markdown",
            arguments: { fileId: "guide-file" },
          },
        },
      ]);
      expect(batch.response.status).toBe(400);
      expect(Buffer.byteLength(batch.text, "utf8")).toBeLessThanOrEqual(
        fixture.dependencies.config.http.maxJsonResponseBytes,
      );
      expect(JSON.parse(batch.text)).toMatchObject({
        jsonrpc: "2.0",
        error: { code: -32600 },
        id: null,
      });
      expect(reads).toBe(0);
    } finally {
      await fixture.close();
    }
  });

  it("caps raw single and batch SDK discovery without truncating tool schemas", async () => {
    const fixture = await start();
    try {
      const single = await rawMcpResponse(fixture.endpoint, {
        jsonrpc: "2.0",
        id: "single-discovery",
        method: "tools/list",
      });
      expect(single.response.status).toBe(200);
      expect(Buffer.byteLength(single.text, "utf8")).toBeLessThanOrEqual(
        fixture.dependencies.config.http.maxJsonResponseBytes,
      );
      const singleEnvelope = JSON.parse(single.text) as {
        readonly result?: { readonly tools?: unknown[] };
      };
      expect(singleEnvelope.result?.tools).toHaveLength(6);
      expect(singleEnvelope.result?.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "list_markdown",
            inputSchema: expect.any(Object),
            outputSchema: expect.objectContaining({ oneOf: expect.any(Array) }),
          }),
          expect.objectContaining({
            name: "archive_markdown",
            inputSchema: expect.any(Object),
            outputSchema: expect.objectContaining({ oneOf: expect.any(Array) }),
          }),
        ]),
      );

      const batch = await rawMcpResponse(fixture.endpoint, [
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]);
      expect(batch.response.status).toBe(400);
      expect(Buffer.byteLength(batch.text, "utf8")).toBeLessThanOrEqual(
        fixture.dependencies.config.http.maxJsonResponseBytes,
      );
      expect(JSON.parse(batch.text)).toMatchObject({
        jsonrpc: "2.0",
        error: { code: -32600 },
        id: null,
      });
    } finally {
      await fixture.close();
    }
  });

  it("returns safe tool errors, disables writes by default, and does not retry conflicts", async () => {
    let updates = 0;
    const fixture = await start({
      service: {
        async listMarkdown() {
          throw new DriveProviderError("transient", "list-children");
        },
        async searchMarkdown() {
          throw new MarkdownGatewayError("OUTSIDE_ROOT", "SENTINEL-PATH");
        },
        async readMarkdown() {
          throw new MarkdownGatewayError("CONFLICT", "SENTINEL-REVISION");
        },
      },
      writeSessionProvider: {
        getWriteSession: () => ({
          async createMarkdown() {
            return metadata;
          },
          async updateMarkdown() {
            updates += 1;
            throw new MarkdownGatewayError("CONFLICT", "SENTINEL-REVISION");
          },
          async archiveMarkdown() {
            return metadata;
          },
        }),
      },
    });
    try {
      const client = await fixture.connect();
      const provider = await client.callTool({
        name: "list_markdown",
        arguments: {},
      });
      expect(structured(provider)).toEqual({
        ok: false,
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "Service dependency is unavailable.",
        },
      });
      expect("content" in provider && provider.isError).toBe(true);
      const outside = await client.callTool({
        name: "search_markdown",
        arguments: { query: "sentinel-query" },
      });
      expect(structured(outside)).toEqual({
        ok: false,
        error: { code: "NOT_FOUND", message: "Markdown file was not found." },
      });
      const conflict = await client.callTool({
        name: "update_markdown",
        arguments: {
          fileId: "guide-file",
          expectedRevision: "one",
          content: "hello",
        },
      });
      expect(structured(conflict)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      expect(JSON.stringify(conflict)).not.toContain("SENTINEL-REVISION");
      expect(updates).toBe(1);
      await client.close();
    } finally {
      await fixture.close();
    }
  });

  it("returns UNSUPPORTED for writes without a supplied write session", async () => {
    const fixture = await start();
    try {
      const client = await fixture.connect();
      const result = await client.callTool({
        name: "create_markdown",
        arguments: { path: "new.md", content: "hello" },
      });
      expect(structured(result)).toEqual({
        ok: false,
        error: { code: "UNSUPPORTED", message: "Operation is unavailable." },
      });
      await client.close();
    } finally {
      await fixture.close();
    }
  });

  it("maps domain result limits to the stable public tool error", async () => {
    const fixture = await start({
      service: {
        async listMarkdown() {
          return [];
        },
        async searchMarkdown() {
          return [];
        },
        async readMarkdown() {
          throw new MarkdownGatewayError("RESULT_LIMIT", "SENTINEL-RESULT");
        },
      },
    });
    try {
      const client = await fixture.connect();
      const result = await client.callTool({
        name: "read_markdown",
        arguments: { fileId: "guide-file" },
      });
      expect(structured(result)).toEqual({
        ok: false,
        error: {
          code: "RESULT_LIMIT_EXCEEDED",
          message: "Result exceeds the configured response limit.",
        },
      });
      expect("content" in result && result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("SENTINEL-RESULT");
      await client.close();
    } finally {
      await fixture.close();
    }
  });

  it("enforces the configured MCP wire cap before emitting a successful tool result", async () => {
    let reads = 0;
    let content = "n".repeat(1_200);
    const fixture = await start({
      service: {
        async listMarkdown() {
          return [];
        },
        async searchMarkdown() {
          return [];
        },
        async readMarkdown() {
          reads += 1;
          return { ...metadata, content };
        },
      },
    });
    try {
      const client = await fixture.connect();
      await expect(
        client.callTool({
          name: "read_markdown",
          arguments: { fileId: "guide-file" },
        }),
      ).resolves.toMatchObject({
        structuredContent: { ok: true, data: { content } },
      });

      content = "SENTINEL-OVERSIZE-CONTENT-".repeat(1_000);
      const oversized = await client.callTool({
        name: "read_markdown",
        arguments: { fileId: "guide-file" },
      });
      expect(reads).toBe(2);
      expect(structured(oversized)).toEqual({
        ok: false,
        error: {
          code: "RESULT_LIMIT_EXCEEDED",
          message: "Result exceeds the configured response limit.",
        },
      });
      expect("content" in oversized && oversized.isError).toBe(true);
      expect(JSON.stringify(oversized)).not.toContain(
        "SENTINEL-OVERSIZE-CONTENT",
      );
      await client.close();
    } finally {
      await fixture.close();
    }
  });

  it("does not leak oversized tool content in the raw MCP response", async () => {
    let reads = 0;
    const fixture = await start({
      service: {
        async listMarkdown() {
          return [];
        },
        async searchMarkdown() {
          return [];
        },
        async readMarkdown() {
          reads += 1;
          return {
            ...metadata,
            content: "SENTINEL-OVERSIZE-RAW-CONTENT-".repeat(1_000),
          };
        },
      },
    });
    try {
      const result = await rawMcpResponse(fixture.endpoint, {
        jsonrpc: "2.0",
        id: "raw-read",
        method: "tools/call",
        params: { name: "read_markdown", arguments: { fileId: "guide-file" } },
      });
      expect(result.response.status).toBe(200);
      expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(
        fixture.dependencies.config.http.maxJsonResponseBytes,
      );
      expect(JSON.parse(result.text)).toMatchObject({
        jsonrpc: "2.0",
        id: "raw-read",
        result: {
          structuredContent: {
            ok: false,
            error: { code: "RESULT_LIMIT_EXCEEDED" },
          },
          isError: true,
        },
      });
      expect(result.text).not.toContain("SENTINEL-OVERSIZE-RAW-CONTENT");
      expect(reads).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  it("treats a write-session provider failure as an unavailable write", async () => {
    const fixture = await start({
      writeSessionProvider: {
        getWriteSession() {
          throw new Error("SENTINEL-WRITE-SESSION-FAILURE");
        },
      },
    });
    try {
      const client = await fixture.connect();
      const result = await client.callTool({
        name: "create_markdown",
        arguments: { path: "new.md", content: "hello" },
      });
      expect(structured(result)).toEqual({
        ok: false,
        error: { code: "UNSUPPORTED", message: "Operation is unavailable." },
      });
      expect(JSON.stringify(result)).not.toContain(
        "SENTINEL-WRITE-SESSION-FAILURE",
      );
      await client.close();
    } finally {
      await fixture.close();
    }
  });

  it("rejects ill-formed UTF-16 in every string input before shared seams run", async () => {
    const calls: string[] = [];
    const session: MarkdownWriteSession = {
      async createMarkdown() {
        calls.push("create");
        return metadata;
      },
      async updateMarkdown() {
        calls.push("update");
        return metadata;
      },
      async archiveMarkdown() {
        calls.push("archive");
        return metadata;
      },
    };
    const fixture = await start({
      service: {
        async listMarkdown() {
          calls.push("list");
          return [];
        },
        async searchMarkdown() {
          calls.push("search");
          return [];
        },
        async readMarkdown() {
          calls.push("read");
          return { ...metadata, content: "hello" };
        },
      },
      writeSessionProvider: { getWriteSession: () => session },
    });
    try {
      const client = await fixture.connect();
      for (const [name, arguments_] of [
        ["list_markdown", { path: "\ud800" }],
        ["search_markdown", { query: "\ud800" }],
        ["read_markdown", { fileId: "\ud800" }],
        ["create_markdown", { path: "safe.md", content: "\ud800" }],
        [
          "update_markdown",
          { path: "safe.md", expectedRevision: "\ud800", content: "hello" },
        ],
      ] as const) {
        const result = await client.callTool({ name, arguments: arguments_ });
        expect("content" in result && result.isError).toBe(true);
      }
      expect(calls).toEqual([]);
      await client.close();
    } finally {
      await fixture.close();
    }
  });

  it("rejects malformed tool arguments before a service call without echoing them", async () => {
    let reads = 0;
    const fixture = await start({
      service: {
        async listMarkdown() {
          return [];
        },
        async searchMarkdown() {
          return [];
        },
        async readMarkdown() {
          reads += 1;
          return { ...metadata, content: "hello" };
        },
      },
    });
    try {
      const client = await fixture.connect();
      const result = await client.callTool({
        name: "read_markdown",
        arguments: { path: "guide.md", "SENTINEL-UNKNOWN-KEY": "secret" },
      });
      expect(reads).toBe(0);
      expect(JSON.stringify(result)).not.toContain("SENTINEL-UNKNOWN-KEY");
      await client.close();
    } finally {
      await fixture.close();
    }
  });
});
