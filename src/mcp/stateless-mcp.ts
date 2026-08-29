import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type {
  MarkdownService,
  MarkdownWriteSession,
} from "../application/markdown-service.js";
import {
  AuthenticationError,
  type AuthenticatedPrincipal,
  type PrincipalVerifier,
} from "../auth/principal.js";
import type { ServiceConfig } from "../config/service-config.js";
import {
  fileId,
  type MarkdownDocument,
  type MarkdownFileMetadata,
  MarkdownGatewayError,
  isWellFormedUtf16,
  revision,
  type SearchMarkdownResult,
} from "../domain/markdown.js";
import {
  DriveProviderError,
  type DriveProviderFailure,
} from "../drive/provider-error.js";
import {
  disabledWriteSessionProvider,
  type WriteSessionProvider,
} from "../http/json-api.js";
import {
  type AuditLogger,
  auditPrincipal,
  createPinoAuditLogger,
  type MetricRecorder,
  type MarkdownApiAuditResult,
  noOpMetricRecorder,
  recordOperationInFlight,
  recordOperationTerminal,
} from "../observability/audit.js";

export interface StatelessMcpDependencies {
  readonly service: Pick<
    MarkdownService,
    "listMarkdown" | "searchMarkdown" | "readMarkdown"
  >;
  readonly config: ServiceConfig;
  readonly principalVerifier: PrincipalVerifier;
  readonly writeSessionProvider?: WriteSessionProvider;
  readonly auditLogger?: AuditLogger;
  readonly metricRecorder?: MetricRecorder;
  readonly now?: () => number;
  readonly operationId?: () => string;
}

interface McpRequestContext {
  readonly operationId: string;
  readonly startedAt: number;
  principal?: AuthenticatedPrincipal;
  completed: boolean;
}

const mcpRequestContext = Symbol("mcp-request-context");
type RequestWithMcpContext = Request & {
  [mcpRequestContext]?: McpRequestContext;
};

type PublicErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_PATH"
  | "NOT_MARKDOWN"
  | "INVALID_CONTENT"
  | "INVALID_ARCHIVE"
  | "FILE_TOO_LARGE"
  | "RESULT_LIMIT_EXCEEDED"
  | "NOT_FOUND"
  | "AMBIGUOUS_PATH"
  | "CONFLICT"
  | "UNSUPPORTED"
  | "UPSTREAM_UNAVAILABLE"
  | "INTERNAL";

interface PublicToolError {
  readonly code: PublicErrorCode;
  readonly message: string;
}

const validationMessage = "Request validation failed.";
const publicErrorMessage = "Operation is unavailable.";

const bytes = (minimum: number, maximum: number) =>
  z.string({ error: validationMessage }).refine(
    (value) => {
      const size = Buffer.byteLength(value, "utf8");
      return isWellFormedUtf16(value) && size >= minimum && size <= maximum;
    },
    { error: validationMessage },
  );

const pathSchema = () => bytes(1, 1_024);
const fileIdSchema = () => bytes(1, 512);
const revisionSchema = () => bytes(1, 1_024);

const metadataSchema = z
  .object({
    relativePath: z.string(),
    fileId: z.string(),
    revision: z.string(),
    modifiedTime: z.string(),
    size: z.number().finite().nonnegative(),
  })
  .strict();

const documentSchema = metadataSchema.extend({ content: z.string() }).strict();
const searchResultSchema = metadataSchema
  .extend({ excerpt: z.string().optional() })
  .strict();
const publicErrorSchema = z
  .object({
    code: z.enum([
      "INVALID_REQUEST",
      "INVALID_PATH",
      "NOT_MARKDOWN",
      "INVALID_CONTENT",
      "INVALID_ARCHIVE",
      "FILE_TOO_LARGE",
      "RESULT_LIMIT_EXCEEDED",
      "NOT_FOUND",
      "AMBIGUOUS_PATH",
      "CONFLICT",
      "UNSUPPORTED",
      "UPSTREAM_UNAVAILABLE",
      "INTERNAL",
    ]),
    message: z.string().max(256),
  })
  .strict();

/**
 * The SDK requires output schemas to have an object root. Metadata is retained
 * by the SDK's Zod v4 JSON Schema converter, so this publishes exact `oneOf`
 * variants while the object root remains discoverable to MCP clients.
 */
function publishedJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...published } = z.toJSONSchema(schema);
  return published;
}

function outputSchema(data: z.ZodType) {
  const success = z.object({ ok: z.literal(true), data }).strict();
  const failure = z
    .object({ ok: z.literal(false), error: publicErrorSchema })
    .strict();
  return z
    .object({
      ok: z.union([z.literal(true), z.literal(false)]),
      data: data.optional(),
      error: publicErrorSchema.optional(),
    })
    .strict()
    .meta({
      oneOf: [publishedJsonSchema(success), publishedJsonSchema(failure)],
    });
}

function listInputSchema() {
  return z
    .object(
      {
        path: pathSchema().optional(),
        recursive: z.boolean({ error: validationMessage }).optional(),
      },
      validationMessage,
    )
    .strict();
}

function searchInputSchema(maxResultItems: number) {
  return z
    .object(
      {
        query: bytes(1, 256).refine((value) => value.trim().length > 0, {
          error: validationMessage,
        }),
        path: pathSchema().optional(),
        limit: z
          .number({ error: validationMessage })
          .int({ error: validationMessage })
          .min(1, { error: validationMessage })
          .max(maxResultItems, { error: validationMessage })
          .optional(),
      },
      validationMessage,
    )
    .strict();
}

function locatorInputSchema() {
  return z
    .object(
      {
        path: pathSchema().optional(),
        fileId: fileIdSchema().optional(),
      },
      validationMessage,
    )
    .strict()
    .refine(
      (input) => (input.path === undefined) !== (input.fileId === undefined),
      { error: validationMessage },
    );
}

function createInputSchema(maxRequestMarkdownBytes: number) {
  return z
    .object(
      {
        path: pathSchema(),
        content: bytes(0, maxRequestMarkdownBytes),
      },
      validationMessage,
    )
    .strict();
}

function updateInputSchema(maxRequestMarkdownBytes: number) {
  return locatorInputSchema()
    .extend({
      expectedRevision: revisionSchema(),
      content: bytes(0, maxRequestMarkdownBytes),
    })
    .strict();
}

function archiveInputSchema() {
  return locatorInputSchema()
    .extend({ expectedRevision: revisionSchema() })
    .strict();
}

const mcpResponseEnvelopeAllowanceBytes = 512;
const maxMcpRequestIdBytes = 256;

function exceedsMcpProtocolResponseLimit(
  body: unknown,
  maximumBytes: number,
): boolean {
  if (Array.isArray(body) && body.length > 1) return true;
  const message = Array.isArray(body) ? body[0] : body;
  if (!message || typeof message !== "object" || !("id" in message))
    return false;

  const id = message.id;
  if (typeof id !== "string" && typeof id !== "number") return false;
  try {
    return (
      Buffer.byteLength(JSON.stringify(id), "utf8") > maxMcpRequestIdBytes ||
      maxMcpRequestIdBytes > maximumBytes
    );
  } catch {
    return true;
  }
}

function responseLimitError(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32600,
      message: "Request exceeds the configured response limit.",
    },
    id: null,
  });
}

function isMcpToolCall(body: unknown): boolean {
  return (
    !Array.isArray(body) &&
    typeof body === "object" &&
    body !== null &&
    Reflect.get(body, "method") === "tools/call"
  );
}

/**
 * The SDK serializes tool content twice: once as text and once as structured
 * content. Reserve a small, fixed amount for the JSON-RPC result envelope as
 * well. Request IDs and batches are bounded before protocol dispatch, so this
 * fixed allowance covers the remaining response framing.
 */
function exceedsMcpResponseLimit(data: unknown, maximumBytes: number): boolean {
  try {
    const structuredContent = { ok: true as const, data };
    const toolResult = {
      content: [
        { type: "text" as const, text: JSON.stringify(structuredContent) },
      ],
      structuredContent,
    };
    return (
      Buffer.byteLength(JSON.stringify(toolResult), "utf8") +
        mcpResponseEnvelopeAllowanceBytes >
      maximumBytes
    );
  } catch {
    return true;
  }
}

function toolSuccess(data: unknown, maximumBytes: number) {
  if (exceedsMcpResponseLimit(data, maximumBytes)) {
    return toolFailure({
      code: "RESULT_LIMIT_EXCEEDED",
      message: "Result exceeds the configured response limit.",
    });
  }
  const structuredContent = { ok: true as const, data };
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
  };
}

function toolFailure(error: PublicToolError) {
  const structuredContent = { ok: false as const, error };
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
    isError: true,
  };
}

function publicToolError(error: unknown): PublicToolError {
  if (error instanceof MarkdownGatewayError) {
    switch (error.code) {
      case "INVALID_PATH":
        return { code: error.code, message: "Path is invalid." };
      case "NOT_MARKDOWN":
        return {
          code: error.code,
          message: "Only Markdown files are supported.",
        };
      case "INVALID_CONTENT":
        return { code: error.code, message: "Markdown content is invalid." };
      case "INVALID_ARCHIVE":
        return { code: error.code, message: "Archive operation is invalid." };
      case "FILE_TOO_LARGE":
        return {
          code: error.code,
          message: "Markdown content exceeds the configured limit.",
        };
      case "RESULT_LIMIT":
        return {
          code: "RESULT_LIMIT_EXCEEDED",
          message: "Result exceeds the configured response limit.",
        };
      case "NOT_FOUND":
      case "OUTSIDE_ROOT":
        return { code: "NOT_FOUND", message: "Markdown file was not found." };
      case "AMBIGUOUS_PATH":
        return { code: error.code, message: "Markdown path is ambiguous." };
      case "CONFLICT":
        return {
          code: error.code,
          message:
            "Markdown revision conflict. Read the document again before retrying.",
        };
      case "UNSUPPORTED":
        return { code: error.code, message: publicErrorMessage };
    }
  }
  if (error instanceof DriveProviderError)
    return {
      code: "UPSTREAM_UNAVAILABLE",
      message: "Service dependency is unavailable.",
    };
  return { code: "INTERNAL", message: "Internal server error." };
}

function auditResultForToolError(error: unknown): Readonly<{
  readonly result: MarkdownApiAuditResult;
  readonly dependencyFailure?: DriveProviderFailure;
}> {
  if (error instanceof DriveProviderError) {
    return { result: "upstream_unavailable", dependencyFailure: error.failure };
  }
  if (error instanceof MarkdownGatewayError) {
    switch (error.code) {
      case "INVALID_PATH":
        return { result: "invalid_path" };
      case "NOT_MARKDOWN":
        return { result: "not_markdown" };
      case "INVALID_CONTENT":
      case "INVALID_ARCHIVE":
        return { result: "invalid_content" };
      case "FILE_TOO_LARGE":
        return { result: "file_too_large" };
      case "RESULT_LIMIT":
        return { result: "result_limit_exceeded" };
      case "NOT_FOUND":
      case "OUTSIDE_ROOT":
        return { result: "not_found" };
      case "AMBIGUOUS_PATH":
        return { result: "ambiguous_path" };
      case "CONFLICT":
        return { result: "conflict" };
      case "UNSUPPORTED":
        return { result: "unsupported" };
    }
  }
  return { result: "internal" };
}

function asLocator(input: { path?: string; fileId?: string }) {
  return input.path === undefined
    ? { fileId: fileId(input.fileId ?? "") }
    : { path: input.path };
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function registerTools(
  server: McpServer,
  dependencies: StatelessMcpDependencies,
  classifyToolOutcome: (
    outcome: ReturnType<typeof auditResultForToolError> | undefined,
  ) => void,
): void {
  const { service, config } = dependencies;
  const writeSessionProvider =
    dependencies.writeSessionProvider ?? disabledWriteSessionProvider;
  const withFailure = async (work: () => Promise<unknown>) => {
    try {
      const result = toolSuccess(
        await work(),
        config.http.maxJsonResponseBytes,
      );
      if (result.structuredContent.ok) classifyToolOutcome(undefined);
      else classifyToolOutcome({ result: "result_limit_exceeded" });
      return result;
    } catch (error) {
      classifyToolOutcome(auditResultForToolError(error));
      return toolFailure(publicToolError(error));
    }
  };
  const withWrite = async (
    work: (session: MarkdownWriteSession) => Promise<MarkdownFileMetadata>,
  ) => {
    let session: MarkdownWriteSession | undefined;
    try {
      session = writeSessionProvider.getWriteSession();
    } catch {
      classifyToolOutcome({ result: "unsupported" });
      return toolFailure({ code: "UNSUPPORTED", message: publicErrorMessage });
    }
    if (!session) {
      classifyToolOutcome({ result: "unsupported" });
      return toolFailure({ code: "UNSUPPORTED", message: publicErrorMessage });
    }
    return withFailure(() => work(session));
  };

  server.registerTool(
    "list_markdown",
    {
      description:
        "List Markdown files. Before editing, list, search, or read the target and retain its revision.",
      inputSchema: listInputSchema(),
      outputSchema: outputSchema(
        z.object({ items: z.array(metadataSchema) }).strict(),
      ),
      annotations: readAnnotations,
    },
    (input) =>
      withFailure(async () => ({
        items: await service.listMarkdown({
          ...(input.path === undefined ? {} : { path: input.path }),
          ...(input.recursive === undefined
            ? {}
            : { recursive: input.recursive }),
        }),
      })),
  );
  server.registerTool(
    "search_markdown",
    {
      description:
        "Search Markdown files. Before editing, read the selected document and retain its revision.",
      inputSchema: searchInputSchema(config.http.maxResultItems),
      outputSchema: outputSchema(
        z.object({ items: z.array(searchResultSchema) }).strict(),
      ),
      annotations: readAnnotations,
    },
    (input) =>
      withFailure(async () => ({
        items: await service.searchMarkdown({
          query: input.query,
          ...(input.path === undefined ? {} : { path: input.path }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        }),
      })),
  );
  server.registerTool(
    "read_markdown",
    {
      description:
        "Read one Markdown document. Retain its revision for any later update or archive.",
      inputSchema: locatorInputSchema(),
      outputSchema: outputSchema(documentSchema),
      annotations: readAnnotations,
    },
    (input) => withFailure(() => service.readMarkdown(asLocator(input))),
  );
  server.registerTool(
    "create_markdown",
    {
      description:
        "Create a Markdown document. Confirm the requested write with the user before calling this tool.",
      inputSchema: createInputSchema(config.http.maxRequestMarkdownBytes),
      outputSchema: outputSchema(metadataSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) => withWrite((session) => session.createMarkdown(input)),
  );
  server.registerTool(
    "update_markdown",
    {
      description:
        "Replace Markdown content using a revision returned by read_markdown. On CONFLICT, read again before retrying; confirm the write with the user.",
      inputSchema: updateInputSchema(config.http.maxRequestMarkdownBytes),
      outputSchema: outputSchema(metadataSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      withWrite((session) =>
        session.updateMarkdown({
          ...asLocator(input),
          expectedRevision: revision(input.expectedRevision),
          content: input.content,
        }),
      ),
  );
  server.registerTool(
    "archive_markdown",
    {
      description:
        "Move a Markdown document to archive using a revision returned by read_markdown. Confirm with the user before archiving. This never deletes a document.",
      inputSchema: archiveInputSchema(),
      outputSchema: outputSchema(metadataSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      withWrite((session) =>
        session.archiveMarkdown({
          ...asLocator(input),
          expectedRevision: revision(input.expectedRevision),
        }),
      ),
  );
}

/**
 * Creates a Work-only Streamable HTTP endpoint. Each accepted request gets a
 * new SDK server and explicitly stateless transport because the SDK rejects
 * reusing a stateless transport across message IDs.
 */
export function createStatelessMcpApp(
  dependencies: StatelessMcpDependencies,
): Express {
  const app = express();
  app.set("strict routing", true);
  app.set("case sensitive routing", true);
  const auditLogger = dependencies.auditLogger ?? createPinoAuditLogger();
  const metricRecorder = dependencies.metricRecorder ?? noOpMetricRecorder;
  const now = dependencies.now ?? (() => performance.now());
  const operationId = dependencies.operationId ?? randomUUID;
  const parser = express.json({
    limit: dependencies.config.http.maxJsonBodyBytes,
    type: "application/json",
  });

  const authenticate = async (
    request: RequestWithMcpContext,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const principal = await dependencies.principalVerifier.verify(
        request.get("Authorization"),
      );
      if (principal.kind !== "work-mcp") throw new AuthenticationError();
      const context = request[mcpRequestContext];
      if (context) context.principal = principal;
      next();
    } catch {
      response
        .set("Cache-Control", "no-store")
        .set("WWW-Authenticate", "Bearer")
        .status(401)
        .type("application/json");
      complete(request, response, "unauthenticated");
      response.send(JSON.stringify({ error: "Authentication failed." }));
    }
  };

  const enforceMcpResponseLimit = (
    request: RequestWithMcpContext,
    response: Response,
    next: NextFunction,
  ): void => {
    if (
      !exceedsMcpProtocolResponseLimit(
        request.body,
        dependencies.config.http.maxJsonResponseBytes,
      )
    ) {
      next();
      return;
    }
    response
      .set("Cache-Control", "no-store")
      .status(400)
      .type("application/json");
    complete(request, response, "invalid_request");
    response.send(responseLimitError());
  };

  app.all(
    "/mcp",
    (request: RequestWithMcpContext, _response, next): void => {
      request[mcpRequestContext] = {
        operationId: operationId(),
        startedAt: now(),
        completed: false,
      };
      recordOperationInFlight(metricRecorder, "mcp");
      next();
    },
    authenticate,
    parser,
    enforceMcpResponseLimit,
    async (request: RequestWithMcpContext, response) => {
      const server = new McpServer({
        name: "google-drive-markdown-gateway",
        version: "0.1.0",
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      let toolOutcome: ReturnType<typeof auditResultForToolError> | undefined =
        isMcpToolCall(request.body) ? { result: "invalid_request" } : undefined;
      try {
        registerTools(server, dependencies, (outcome) => {
          toolOutcome = outcome;
        });
        await server.connect(transport);
        await transport.handleRequest(request, response, request.body);
        complete(
          request,
          response,
          toolOutcome?.result ?? "succeeded",
          toolOutcome?.dependencyFailure,
        );
      } catch {
        if (!response.headersSent) {
          response
            .set("Cache-Control", "no-store")
            .status(500)
            .type("application/json");
          complete(request, response, "internal");
          response.send(JSON.stringify({ error: "Service is unavailable." }));
        } else {
          complete(request, response, "internal");
        }
      } finally {
        await server.close().catch(() => undefined);
      }
    },
  );

  app.use(
    (
      _error: unknown,
      request: RequestWithMcpContext,
      response: Response,
      next: NextFunction,
    ): void => {
      if (response.headersSent) {
        complete(request, response, "invalid_request");
        next(_error);
        return;
      }
      response
        .set("Cache-Control", "no-store")
        .status(400)
        .type("application/json");
      complete(request, response, "invalid_request");
      response.send(JSON.stringify({ error: validationMessage }));
    },
  );

  return app;

  function complete(
    request: RequestWithMcpContext,
    response: Response,
    result: MarkdownApiAuditResult,
    dependencyFailure?: DriveProviderFailure,
  ): void {
    const context = request[mcpRequestContext];
    if (!context || context.completed) return;
    context.completed = true;
    recordOperationTerminal(auditLogger, metricRecorder, {
      event: "markdown-api-request",
      operationId: context.operationId,
      operation: "mcp",
      principal: auditPrincipal(context.principal),
      result,
      statusCode: response.statusCode,
      durationMs: Math.max(0, Math.round(now() - context.startedAt)),
      ...(dependencyFailure === undefined
        ? {}
        : { dependency: "drive" as const, dependencyFailure }),
    });
  }
}

export type { MarkdownDocument, MarkdownFileMetadata, SearchMarkdownResult };
