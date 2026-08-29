import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

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
  createJsonApiApp,
  type JsonApiDependencies,
} from "../../src/http/json-api.js";
import type { MarkdownApiAuditEvent } from "../../src/observability/audit.js";

const metadata = {
  relativePath: "docs/guide.md",
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
      maxTraversalNodes: 10,
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
      maxJsonResponseBytes: 4_096,
      requestTimeoutMs: 1_000,
      rateLimitWindowMs: 1_000,
      maxRequestsPerWindow: 10,
      maxConcurrentRequestsPerPrincipal: 2,
      maxRateLimitPrincipals: 2,
    },
  });
}

function verifier(): PrincipalVerifier {
  return {
    async verify(value) {
      if (value !== "Bearer accepted") throw new AuthenticationError();
      return {
        kind: "codex",
        subject: "codex",
        issuer: "gateway-codex-bearer",
      };
    },
  };
}

function fakeService(): JsonApiDependencies["service"] {
  return {
    async listMarkdown() {
      return [metadata];
    },
    async searchMarkdown() {
      return [{ ...metadata, excerpt: "found" }];
    },
    async readMarkdown() {
      return { ...metadata, content: "hello" };
    },
  };
}

const authorized = { Authorization: "Bearer accepted" };

async function call(
  dependencies: Omit<
    JsonApiDependencies,
    "config" | "principalVerifier" | "service"
  > & {
    readonly config?: ReturnType<typeof config>;
    readonly principalVerifier?: PrincipalVerifier;
    readonly service?: JsonApiDependencies["service"];
  },
  path: string,
  init: RequestInit = {},
) {
  const app = createJsonApiApp({
    config: dependencies.config ?? config(),
    principalVerifier: dependencies.principalVerifier ?? verifier(),
    service: dependencies.service ?? fakeService(),
    operationId: () => "00000000-0000-4000-8000-000000000001",
    auditLogger: dependencies.auditLogger ?? { info() {} },
    ...dependencies,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    server.close();
  }
}

async function callBeforeJsonBodyArrives(
  dependencies: Omit<
    JsonApiDependencies,
    "config" | "principalVerifier" | "service"
  > & {
    readonly config?: ReturnType<typeof config>;
    readonly principalVerifier?: PrincipalVerifier;
    readonly service?: JsonApiDependencies["service"];
  },
  delayMs: number,
): Promise<number> {
  const app = createJsonApiApp({
    config: dependencies.config ?? config(),
    principalVerifier: dependencies.principalVerifier ?? verifier(),
    service: dependencies.service ?? fakeService(),
    operationId: () => "00000000-0000-4000-8000-000000000001",
    auditLogger: dependencies.auditLogger ?? { info() {} },
    ...dependencies,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as AddressInfo;
    return await new Promise((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: address.port,
        path: "/v1/markdown/create",
        method: "POST",
        headers: {
          ...authorized,
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      });
      const bodyTimer = setTimeout(
        () => request.end('{"path":"docs/new.md","content":"safe"}'),
        delayMs,
      );
      request.once("error", reject);
      request.once("response", (response) => {
        clearTimeout(bodyTimer);
        request.destroy();
        resolve(response.statusCode ?? 0);
      });
      request.flushHeaders();
    });
  } finally {
    server.close();
  }
}

describe("JSON API", () => {
  it("delegates every named operation exactly once through the service/session seam", async () => {
    const calls: string[] = [];
    const events: MarkdownApiAuditEvent[] = [];
    const service: JsonApiDependencies["service"] = {
      async listMarkdown(input) {
        calls.push(`list:${String(input?.recursive)}`);
        return [metadata];
      },
      async searchMarkdown(input) {
        calls.push(`search:${input.query}:${String(input.limit)}`);
        return [metadata];
      },
      async readMarkdown(input) {
        calls.push(`read:${"fileId" in input ? input.fileId : input.path}`);
        return { ...metadata, content: "hello" };
      },
    };
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
    const dependencies = {
      service,
      writeSessionProvider: { getWriteSession: () => session },
      auditLogger: {
        info: (event: MarkdownApiAuditEvent) => events.push(event),
      },
    };
    const requests: ReadonlyArray<readonly [string, RequestInit]> = [
      ["/v1/markdown/list?recursive=true", { headers: authorized }],
      ["/v1/markdown/search?query=release&limit=2", { headers: authorized }],
      ["/v1/markdown/read?fileId=guide-file", { headers: authorized }],
      [
        "/v1/markdown/create",
        {
          method: "POST",
          headers: { ...authorized, "Content-Type": "application/json" },
          body: JSON.stringify({ path: "docs/new.md", content: "new" }),
        },
      ],
      [
        "/v1/markdown/update",
        {
          method: "POST",
          headers: { ...authorized, "Content-Type": "application/json" },
          body: JSON.stringify({
            fileId: "guide-file",
            expectedRevision: "one",
            content: "updated",
          }),
        },
      ],
      [
        "/v1/markdown/archive",
        {
          method: "POST",
          headers: { ...authorized, "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "docs/guide.md",
            expectedRevision: "one",
          }),
        },
      ],
    ];
    for (const [path, init] of requests) {
      const response = await call(dependencies, path, init);
      expect(response.status).toBe(path.includes("create") ? 201 : 200);
    }
    expect(calls).toEqual([
      "list:true",
      "search:release:2",
      "read:guide-file",
      "create:docs/new.md",
      "update:one",
      "archive:one",
    ]);
    expect(events).toHaveLength(6);
    expect(events.map((event) => event.operation)).toEqual([
      "list_markdown",
      "search_markdown",
      "read_markdown",
      "create_markdown",
      "update_markdown",
      "archive_markdown",
    ]);
  });

  it("delegates read routes and emits only allowlisted audit facts", async () => {
    const events: MarkdownApiAuditEvent[] = [];
    const response = await call(
      { auditLogger: { info: (event) => events.push(event) } },
      "/v1/markdown/list?recursive=true",
      { headers: { Authorization: "Bearer accepted" } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { items: [metadata] },
    });
    expect(events).toEqual([
      expect.objectContaining({
        event: "markdown-api-request",
        operation: "list_markdown",
        result: "succeeded",
        resultCount: 1,
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("recursive");
    expect(JSON.stringify(events)).not.toContain("docs/guide.md");

    const search = await call(
      { auditLogger: { info: (event) => events.push(event) } },
      "/v1/markdown/search?query=release",
      { headers: { Authorization: "Bearer accepted" } },
    );
    expect(search.status).toBe(200);
    expect(await search.json()).toMatchObject({
      data: { items: [{ excerpt: "found" }] },
    });
  });

  it("authenticates before parsing and keeps writes disabled by default", async () => {
    let serviceCalls = 0;
    const response = await call(
      {
        service: {
          async listMarkdown() {
            serviceCalls += 1;
            return [];
          },
          searchMarkdown: fakeService().searchMarkdown,
          readMarkdown: fakeService().readMarkdown,
        },
      },
      "/v1/markdown/create",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer accepted",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: "docs/new.md", content: "sentinel" }),
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED" },
    });
    expect(serviceCalls).toBe(0);

    const unauthenticated = await call(
      {},
      "/v1/markdown/list?unexpected=value",
    );
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED", message: "Authentication failed." },
    });

    let verified = 0;
    const malformedUnauthenticated = await call(
      {
        principalVerifier: {
          async verify() {
            verified += 1;
            throw new AuthenticationError();
          },
        },
      },
      "/v1/markdown/create",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"content":',
      },
    );
    expect(malformedUnauthenticated.status).toBe(401);
    expect(verified).toBe(1);
  });

  it("accepts only explicit fake write capability and strict JSON inputs", async () => {
    let creates = 0;
    const session: MarkdownWriteSession = {
      async createMarkdown() {
        creates += 1;
        return metadata;
      },
      async updateMarkdown() {
        return metadata;
      },
      async archiveMarkdown() {
        return metadata;
      },
    };
    const response = await call(
      { writeSessionProvider: { getWriteSession: () => session } },
      "/v1/markdown/create",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer accepted",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ path: "docs/new.md", content: "safe" }),
      },
    );
    expect(response.status).toBe(201);
    expect(creates).toBe(1);

    const invalid = await call(
      { writeSessionProvider: { getWriteSession: () => session } },
      "/v1/markdown/read?path=docs%2Fguide.md&fileId=guide-file",
      { headers: { Authorization: "Bearer accepted" } },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("rejects malformed media, strict query/body DTOs, and invalid wire forms", async () => {
    const cases: ReadonlyArray<readonly [string, RequestInit, number, string]> =
      [
        [
          "/v1/markdown/create",
          { method: "POST", headers: authorized, body: "not-json" },
          415,
          "UNSUPPORTED_MEDIA_TYPE",
        ],
        [
          "/v1/markdown/create",
          {
            method: "POST",
            headers: { ...authorized, "Content-Type": "application/json" },
            body: '{"path":"docs/a.md",',
          },
          400,
          "INVALID_REQUEST",
        ],
        [
          "/v1/markdown/create",
          {
            method: "POST",
            headers: { ...authorized, "Content-Type": "application/json" },
            body: JSON.stringify({
              path: "docs/a.md",
              content: "x",
              extra: true,
            }),
          },
          400,
          "INVALID_REQUEST",
        ],
        [
          "/v1/markdown/search?query=x&limit=01",
          { headers: authorized },
          400,
          "INVALID_REQUEST",
        ],
        [
          "/v1/markdown/list?recursive=1",
          { headers: authorized },
          400,
          "INVALID_REQUEST",
        ],
        [
          "/v1/markdown/read?fileId=one&fileId=two",
          { headers: authorized },
          400,
          "INVALID_REQUEST",
        ],
      ];
    for (const [path, init, status, code] of cases) {
      const response = await call({}, path, init);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
  });

  it("classifies unsupported JSON charsets and content encodings without dispatching", async () => {
    const cases: ReadonlyArray<Readonly<Record<string, string>>> = [
      { "Content-Type": "application/json; charset=iso-8859-1" },
      {
        "Content-Type": "application/json",
        "Content-Encoding": "unsupported",
      },
    ];

    for (const headers of cases) {
      let creates = 0;
      const events: MarkdownApiAuditEvent[] = [];
      const session: MarkdownWriteSession = {
        async createMarkdown() {
          creates += 1;
          return metadata;
        },
        async updateMarkdown() {
          return metadata;
        },
        async archiveMarkdown() {
          return metadata;
        },
      };
      const response = await call(
        {
          auditLogger: { info: (event) => events.push(event) },
          writeSessionProvider: { getWriteSession: () => session },
        },
        "/v1/markdown/create",
        {
          method: "POST",
          headers: { ...authorized, ...headers },
          body: JSON.stringify({ path: "docs/new.md", content: "safe" }),
        },
      );

      expect(response.status).toBe(415);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Request must use application/json.",
        },
      });
      expect(creates).toBe(0);
      expect(events).toEqual([
        expect.objectContaining({ result: "unsupported_media_type" }),
      ]);
    }
  });

  it("maps domain, upstream, and unknown failures without exposing their messages", async () => {
    const expectations: ReadonlyArray<readonly [Error, number, string]> = [
      [
        new MarkdownGatewayError("INVALID_PATH", "private path detail"),
        400,
        "INVALID_PATH",
      ],
      [
        new MarkdownGatewayError("FILE_TOO_LARGE", "private byte detail"),
        413,
        "FILE_TOO_LARGE",
      ],
      [
        new MarkdownGatewayError("RESULT_LIMIT", "private result detail"),
        413,
        "RESULT_LIMIT_EXCEEDED",
      ],
      [
        new MarkdownGatewayError("OUTSIDE_ROOT", "root identifier"),
        404,
        "NOT_FOUND",
      ],
      [
        new MarkdownGatewayError("CONFLICT", "revision detail"),
        409,
        "CONFLICT",
      ],
      [
        new MarkdownGatewayError("UNSUPPORTED", "lease detail"),
        503,
        "UNSUPPORTED",
      ],
      [
        new DriveProviderError("transient", "get-metadata"),
        503,
        "UPSTREAM_UNAVAILABLE",
      ],
      [new Error("provider secret failure"), 500, "INTERNAL"],
    ];
    for (const [error, status, code] of expectations) {
      const response = await call(
        {
          service: {
            async listMarkdown() {
              throw error;
            },
            searchMarkdown: fakeService().searchMarkdown,
            readMarkdown: fakeService().readMarkdown,
          },
        },
        "/v1/markdown/list",
        { headers: authorized },
      );
      const body = await response.text();
      expect(response.status).toBe(status);
      expect(body).toContain(code);
      expect(body).not.toContain(error.message);
    }
  });

  it("bounds result counts and response bytes without logging document content", async () => {
    const events: MarkdownApiAuditEvent[] = [];
    const tooMany = await call(
      {
        auditLogger: { info: (event) => events.push(event) },
        service: {
          async listMarkdown() {
            return Array.from({ length: 11 }, () => metadata);
          },
          searchMarkdown: fakeService().searchMarkdown,
          readMarkdown: fakeService().readMarkdown,
        },
      },
      "/v1/markdown/list",
      { headers: authorized },
    );
    expect(tooMany.status).toBe(413);
    expect(events.at(-1)).toMatchObject({ result: "result_limit_exceeded" });

    const sentinel = "MARKDOWN-CONTENT-MUST-NOT-REACH-AUDIT".repeat(200);
    const oversized = await call(
      {
        auditLogger: { info: (event) => events.push(event) },
        service: {
          ...fakeService(),
          async readMarkdown() {
            return { ...metadata, content: sentinel };
          },
        },
      },
      "/v1/markdown/read?fileId=guide-file",
      { headers: authorized },
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.text()).not.toContain(sentinel);
    expect(JSON.stringify(events)).not.toContain(sentinel);
  });

  it("times out once without retrying and keeps health isolated from dependencies", async () => {
    let calls = 0;
    let verifies = 0;
    let sessions = 0;
    const events: MarkdownApiAuditEvent[] = [];
    const response = await call(
      {
        config: parseServiceConfig({
          ...config(),
          http: { ...config().http, requestTimeoutMs: 100 },
        }),
        auditLogger: { info: (event) => events.push(event) },
        principalVerifier: {
          async verify(value) {
            verifies += 1;
            return verifier().verify(value);
          },
        },
        service: {
          async listMarkdown() {
            calls += 1;
            return await new Promise((resolve) =>
              setTimeout(() => resolve([]), 200),
            );
          },
          searchMarkdown: fakeService().searchMarkdown,
          readMarkdown: fakeService().readMarkdown,
        },
        writeSessionProvider: {
          getWriteSession() {
            sessions += 1;
            return undefined;
          },
        },
      },
      "/v1/markdown/list",
      { headers: authorized },
    );
    expect(response.status).toBe(504);
    expect(calls).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ result: "timeout" });

    const healthEvents: MarkdownApiAuditEvent[] = [];
    const health = await call(
      {
        auditLogger: { info: (event) => healthEvents.push(event) },
        principalVerifier: {
          async verify() {
            verifies += 1;
            throw new AuthenticationError();
          },
        },
        writeSessionProvider: {
          getWriteSession() {
            sessions += 1;
            return undefined;
          },
        },
      },
      "/healthz",
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    expect(healthEvents).toEqual([]);
    expect(verifies).toBe(1);
    expect(sessions).toBe(0);
  });

  it("returns the intended response and releases once when the audit sink fails", async () => {
    let auditCalls = 0;
    let releases = 0;
    const response = await call(
      {
        auditLogger: {
          info() {
            auditCalls += 1;
            throw new Error("audit destination unavailable");
          },
        },
        rateLimiter: {
          reserve() {
            return {
              accepted: true,
              release() {
                releases += 1;
              },
            };
          },
        },
      },
      "/v1/markdown/list",
      { headers: authorized },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(auditCalls).toBe(1);
    expect(releases).toBe(1);
  });

  it("applies the route deadline before verification and releases a reservation on timeout", async () => {
    let reservations = 0;
    let releases = 0;
    const events: MarkdownApiAuditEvent[] = [];
    const response = await call(
      {
        config: parseServiceConfig({
          ...config(),
          http: { ...config().http, requestTimeoutMs: 100 },
        }),
        auditLogger: { info: (event) => events.push(event) },
        principalVerifier: {
          async verify() {
            return await new Promise(() => undefined);
          },
        },
        rateLimiter: {
          reserve() {
            reservations += 1;
            return {
              accepted: true,
              release() {
                releases += 1;
              },
            };
          },
        },
      },
      "/v1/markdown/list",
      { headers: authorized },
    );
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: "REQUEST_TIMEOUT" },
    });
    expect(reservations).toBe(0);
    expect(releases).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ result: "timeout" });
  });

  it("keeps the route deadline active while the JSON body is still arriving", async () => {
    let releases = 0;
    const events: MarkdownApiAuditEvent[] = [];
    const status = await callBeforeJsonBodyArrives(
      {
        config: parseServiceConfig({
          ...config(),
          http: { ...config().http, requestTimeoutMs: 100 },
        }),
        auditLogger: { info: (event) => events.push(event) },
        rateLimiter: {
          reserve() {
            return {
              accepted: true,
              release() {
                releases += 1;
              },
            };
          },
        },
      },
      200,
    );
    expect(status).toBe(504);
    expect(releases).toBe(1);
    expect(events).toEqual([expect.objectContaining({ result: "timeout" })]);
  });

  it("does not classify a throwing write-session provider as invalid input", async () => {
    const events: MarkdownApiAuditEvent[] = [];
    const response = await call(
      {
        auditLogger: { info: (event) => events.push(event) },
        writeSessionProvider: {
          getWriteSession() {
            throw new Error("provider failure");
          },
        },
      },
      "/v1/markdown/create",
      {
        method: "POST",
        headers: { ...authorized, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "docs/new.md", content: "safe" }),
      },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL" },
    });
    expect(events).toEqual([expect.objectContaining({ result: "internal" })]);
  });

  it("rejects implicit methods and path aliases without reaching dependencies", async () => {
    let verifies = 0;
    const cases: ReadonlyArray<readonly [string, RequestInit]> = [
      ["/v1/markdown/list", { method: "HEAD", headers: authorized }],
      ["/v1/markdown/list", { method: "OPTIONS", headers: authorized }],
      ["/v1/markdown/list/", { headers: authorized }],
      ["/v1/markdown/list", { method: "POST", headers: authorized }],
      ["/healthz/", {}],
    ];
    for (const [path, init] of cases) {
      const response = await call(
        {
          principalVerifier: {
            async verify() {
              verifies += 1;
              return verifier().verify("Bearer accepted");
            },
          },
        },
        path,
        init,
      );
      expect(response.status).toBe(404);
    }
    expect(verifies).toBe(0);
  });

  it("omits hostile provider file IDs from audit events", async () => {
    const events: MarkdownApiAuditEvent[] = [];
    const hostileFileId = "x".repeat(700);
    const response = await call(
      {
        auditLogger: { info: (event) => events.push(event) },
        service: {
          ...fakeService(),
          async readMarkdown() {
            return {
              ...metadata,
              fileId: fileId(hostileFileId),
              content: "safe",
            };
          },
        },
      },
      "/v1/markdown/read?fileId=guide-file",
      { headers: authorized },
    );
    expect(response.status).toBe(200);
    expect(events).toEqual([
      expect.not.objectContaining({ fileId: expect.anything() }),
    ]);
    expect(JSON.stringify(events)).not.toContain(hostileFileId);
  });
});
