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
import { DriveProviderError } from "../drive/provider-error.js";
import {
  disabledWriteSessionProvider,
  type WriteSessionProvider,
} from "../http/json-api.js";

export interface StatelessMcpDependencies {
  readonly service: Pick<
    MarkdownService,
    "listMarkdown" | "searchMarkdown" | "readMarkdown"
  >;
  readonly config: ServiceConfig;
  readonly principalVerifier: PrincipalVerifier;
  readonly writeSessionProvider?: WriteSessionProvider;
}

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

/**
 * The SDK serializes tool content twice: once as text and once as structured
 * content. Reserve a small, fixed amount for the JSON-RPC result envelope as
 * well, so a bounded service result cannot bypass the configured wire limit.
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
): void {
  const { service, config } = dependencies;
  const writeSessionProvider =
    dependencies.writeSessionProvider ?? disabledWriteSessionProvider;
  const withFailure = async (work: () => Promise<unknown>) => {
    try {
      return toolSuccess(await work(), config.http.maxJsonResponseBytes);
    } catch (error) {
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
      return toolFailure({ code: "UNSUPPORTED", message: publicErrorMessage });
    }
    if (!session)
      return toolFailure({ code: "UNSUPPORTED", message: publicErrorMessage });
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
  const parser = express.json({
    limit: dependencies.config.http.maxJsonBodyBytes,
    type: "application/json",
  });

  const authenticate = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const principal = await dependencies.principalVerifier.verify(
        request.get("Authorization"),
      );
      if (principal.kind !== "work-mcp") throw new AuthenticationError();
      next();
    } catch {
      response
        .set("Cache-Control", "no-store")
        .set("WWW-Authenticate", "Bearer")
        .status(401)
        .type("application/json")
        .send(JSON.stringify({ error: "Authentication failed." }));
    }
  };

  app.all("/mcp", authenticate, parser, async (request, response) => {
    const server = new McpServer({
      name: "google-drive-markdown-gateway",
      version: "0.1.0",
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      registerTools(server, dependencies);
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent)
        response
          .set("Cache-Control", "no-store")
          .status(500)
          .type("application/json")
          .send(JSON.stringify({ error: "Service is unavailable." }));
    } finally {
      await server.close().catch(() => undefined);
    }
  });

  app.use(
    (
      _error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ): void => {
      if (response.headersSent) {
        next(_error);
        return;
      }
      response
        .set("Cache-Control", "no-store")
        .status(400)
        .type("application/json")
        .send(JSON.stringify({ error: validationMessage }));
    },
  );

  return app;
}

export type { MarkdownDocument, MarkdownFileMetadata, SearchMarkdownResult };
