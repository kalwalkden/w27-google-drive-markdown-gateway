import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";

import type {
  MarkdownService,
  MarkdownWriteSession,
} from "../application/markdown-service.js";
import {
  type AuthenticatedPrincipal,
  AuthenticationError,
  type PrincipalVerifier,
} from "../auth/principal.js";
import type { ServiceConfig } from "../config/service-config.js";
import {
  fileId,
  type MarkdownFileMetadata,
  MarkdownGatewayError,
  revision,
} from "../domain/markdown.js";
import { GoogleDriveProviderError } from "../drive/google-drive-read-adapter.js";
import {
  type AuditLogger,
  auditPrincipal,
  createPinoAuditLogger,
  type MarkdownApiAuditEvent,
  type MarkdownApiAuditResult,
  type MarkdownApiOperation,
} from "../observability/audit.js";
import {
  FixedWindowPrincipalRateLimiter,
  type PrincipalRateLimiter,
  type RateLimitReservation,
} from "./limiter.js";

export interface WriteSessionProvider {
  getWriteSession(): MarkdownWriteSession | undefined;
}

export const disabledWriteSessionProvider: WriteSessionProvider = {
  getWriteSession: () => undefined,
};

export interface JsonApiDependencies {
  readonly service: Pick<
    MarkdownService,
    "listMarkdown" | "searchMarkdown" | "readMarkdown"
  >;
  readonly config: ServiceConfig;
  readonly principalVerifier: PrincipalVerifier;
  readonly writeSessionProvider?: WriteSessionProvider;
  readonly auditLogger?: AuditLogger;
  readonly rateLimiter?: PrincipalRateLimiter;
  readonly now?: () => number;
  readonly operationId?: () => string;
}

interface RequestContext {
  readonly operation: MarkdownApiOperation;
  readonly operationId: string;
  readonly startedAt: number;
  principal?: AuthenticatedPrincipal;
  reservation?: RateLimitReservation;
  completed: boolean;
}

interface SuccessResponse {
  readonly status: 200 | 201;
  readonly data: unknown;
  readonly fileId?: string;
  readonly resultCount?: number;
}

interface PublicFailure {
  readonly status: number;
  readonly code:
    | "UNAUTHENTICATED"
    | "UNSUPPORTED_MEDIA_TYPE"
    | "INVALID_REQUEST"
    | "INVALID_PATH"
    | "NOT_MARKDOWN"
    | "INVALID_CONTENT"
    | "INVALID_ARCHIVE"
    | "FILE_TOO_LARGE"
    | "NOT_FOUND"
    | "AMBIGUOUS_PATH"
    | "CONFLICT"
    | "UNSUPPORTED"
    | "RATE_LIMITED"
    | "REQUEST_TIMEOUT"
    | "RESULT_LIMIT_EXCEEDED"
    | "UPSTREAM_UNAVAILABLE"
    | "INTERNAL";
  readonly message: string;
  readonly result: MarkdownApiAuditResult;
  readonly retryAfterSeconds?: number;
}

const requestContext = Symbol("markdown-api-request-context");
type RequestWithContext = Request & { [requestContext]?: RequestContext };

const bytes = (minimum: number, maximum: number) =>
  z.string().refine(
    (value) => {
      const size = Buffer.byteLength(value, "utf8");
      return size >= minimum && size <= maximum;
    },
    { message: "bounded UTF-8 string" },
  );

const pathSchema = () => bytes(1, 1_024);
const fileIdSchema = () => bytes(1, 512);
const revisionSchema = () => bytes(1, 1_024);

function listSchema() {
  return z
    .object({
      path: pathSchema().optional(),
      recursive: z.enum(["true", "false"]).optional(),
    })
    .strict();
}

function searchSchema(maxResultItems: number) {
  return z
    .object({
      query: bytes(1, 256).refine((value) => value.trim().length > 0),
      path: pathSchema().optional(),
      limit: z
        .string()
        .regex(/^[1-9][0-9]*$/u)
        .refine((value) => Number(value) <= maxResultItems)
        .optional(),
    })
    .strict();
}

function locatorSchema() {
  return z.union([
    z.object({ path: pathSchema() }).strict(),
    z.object({ fileId: fileIdSchema() }).strict(),
  ]);
}

function createSchema(maxRequestMarkdownBytes: number) {
  return z
    .object({
      path: pathSchema(),
      content: bytes(0, maxRequestMarkdownBytes),
    })
    .strict();
}

function updateSchema(maxRequestMarkdownBytes: number) {
  return z.union([
    z
      .object({
        path: pathSchema(),
        expectedRevision: revisionSchema(),
        content: bytes(0, maxRequestMarkdownBytes),
      })
      .strict(),
    z
      .object({
        fileId: fileIdSchema(),
        expectedRevision: revisionSchema(),
        content: bytes(0, maxRequestMarkdownBytes),
      })
      .strict(),
  ]);
}

function archiveSchema() {
  return z.union([
    z
      .object({ path: pathSchema(), expectedRevision: revisionSchema() })
      .strict(),
    z
      .object({ fileId: fileIdSchema(), expectedRevision: revisionSchema() })
      .strict(),
  ]);
}

const failure = (
  status: PublicFailure["status"],
  code: PublicFailure["code"],
  message: string,
  result: MarkdownApiAuditResult,
  retryAfterSeconds?: number,
): PublicFailure => ({ status, code, message, result, retryAfterSeconds });

const invalidRequest = (): PublicFailure =>
  failure(
    400,
    "INVALID_REQUEST",
    "Request validation failed.",
    "invalid_request",
  );

function publicFailure(error: unknown): PublicFailure {
  if (error instanceof AuthenticationError)
    return failure(
      401,
      "UNAUTHENTICATED",
      "Authentication failed.",
      "unauthenticated",
    );
  if (error instanceof MarkdownGatewayError) {
    switch (error.code) {
      case "INVALID_PATH":
        return failure(400, error.code, "Path is invalid.", "invalid_path");
      case "NOT_MARKDOWN":
        return failure(
          400,
          error.code,
          "Only Markdown files are supported.",
          "not_markdown",
        );
      case "INVALID_CONTENT":
        return failure(
          400,
          error.code,
          "Markdown content is invalid.",
          "invalid_content",
        );
      case "INVALID_ARCHIVE":
        return failure(
          400,
          error.code,
          "Archive operation is invalid.",
          "invalid_request",
        );
      case "FILE_TOO_LARGE":
        return failure(
          413,
          error.code,
          "Markdown content exceeds the configured limit.",
          "file_too_large",
        );
      case "NOT_FOUND":
      case "OUTSIDE_ROOT":
        return failure(
          404,
          "NOT_FOUND",
          "Markdown file was not found.",
          "not_found",
        );
      case "AMBIGUOUS_PATH":
        return failure(
          409,
          error.code,
          "Markdown path is ambiguous.",
          "ambiguous_path",
        );
      case "CONFLICT":
        return failure(
          409,
          error.code,
          "Markdown revision conflict.",
          "conflict",
        );
      case "UNSUPPORTED":
        return failure(
          503,
          error.code,
          "Operation is unavailable.",
          "unsupported",
        );
    }
  }
  if (error instanceof GoogleDriveProviderError)
    return failure(
      503,
      "UPSTREAM_UNAVAILABLE",
      "Service dependency is unavailable.",
      "upstream_unavailable",
    );
  return failure(500, "INTERNAL", "Internal server error.", "internal");
}

const unsupportedMediaType = (): PublicFailure =>
  failure(
    415,
    "UNSUPPORTED_MEDIA_TYPE",
    "Request must use application/json.",
    "unsupported_media_type",
  );

const rateLimited = (retryAfterSeconds: number): PublicFailure =>
  failure(
    429,
    "RATE_LIMITED",
    "Request rate limit exceeded.",
    "rate_limited",
    retryAfterSeconds,
  );

const timedOut = (): PublicFailure =>
  failure(504, "REQUEST_TIMEOUT", "Request timed out.", "timeout");

const oversizedResult = (): PublicFailure =>
  failure(
    413,
    "RESULT_LIMIT_EXCEEDED",
    "Result exceeds the configured response limit.",
    "result_limit_exceeded",
  );

/**
 * Builds the route-only API. It deliberately accepts a pre-issued write session rather than any
 * write-gate input; an HTTP timeout cannot cancel a dispatched Drive promise and never retries it.
 */
export function createJsonApiApp(dependencies: JsonApiDependencies): Express {
  const app = express();
  const { config, principalVerifier, service } = dependencies;
  const auditLogger = dependencies.auditLogger ?? createPinoAuditLogger();
  const now = dependencies.now ?? (() => performance.now());
  const operationId = dependencies.operationId ?? randomUUID;
  const rateLimiter =
    dependencies.rateLimiter ??
    new FixedWindowPrincipalRateLimiter(config.http);
  const writeSessionProvider =
    dependencies.writeSessionProvider ?? disabledWriteSessionProvider;
  const jsonParser = express.json({
    limit: config.http.maxJsonBodyBytes,
    type: "application/json",
  });

  const complete = (
    request: RequestWithContext,
    response: Response,
    outcome: MarkdownApiAuditResult,
    statusCode: number,
    body: string,
    options: Readonly<{ fileId?: string; resultCount?: number }> = {},
  ): void => {
    const context = request[requestContext];
    if (!context || context.completed || response.headersSent) return;
    context.completed = true;
    response.set("Cache-Control", "no-store");
    response.type("application/json");
    if (statusCode === 401) response.set("WWW-Authenticate", "Bearer");
    if (statusCode === 429 && context.reservation?.retryAfterSeconds) {
      response.set(
        "Retry-After",
        String(context.reservation.retryAfterSeconds),
      );
    }
    const event: MarkdownApiAuditEvent = {
      event: "markdown-api-request",
      operationId: context.operationId,
      operation: context.operation,
      principal: auditPrincipal(context.principal),
      result: outcome,
      statusCode,
      durationMs: Math.max(0, Math.round(now() - context.startedAt)),
      ...(options.fileId === undefined ? {} : { fileId: options.fileId }),
      ...(options.resultCount === undefined
        ? {}
        : { resultCount: options.resultCount }),
    };
    auditLogger.info(event);
    context.reservation?.release();
    response.status(statusCode).send(body);
  };

  const respondFailure = (
    request: RequestWithContext,
    response: Response,
    reason: PublicFailure,
  ): void => {
    const context = request[requestContext];
    if (!context) return;
    if (reason.retryAfterSeconds !== undefined && context.reservation) {
      context.reservation = {
        ...context.reservation,
        retryAfterSeconds: reason.retryAfterSeconds,
      };
    }
    complete(
      request,
      response,
      reason.result,
      reason.status,
      JSON.stringify({
        ok: false,
        operationId: context.operationId,
        error: { code: reason.code, message: reason.message },
      }),
    );
  };

  const protectedRoute =
    (operation: MarkdownApiOperation) =>
    async (
      request: RequestWithContext,
      response: Response,
      next: NextFunction,
    ): Promise<void> => {
      const context: RequestContext = {
        operation,
        operationId: operationId(),
        startedAt: now(),
        completed: false,
      };
      request[requestContext] = context;
      try {
        context.principal = await principalVerifier.verify(
          request.get("Authorization"),
        );
        const reservation = rateLimiter.reserve(context.principal, now());
        context.reservation = reservation;
        if (!reservation.accepted) {
          respondFailure(
            request,
            response,
            rateLimited(reservation.retryAfterSeconds ?? 1),
          );
          return;
        }
        next();
      } catch (error) {
        // Authentication providers can carry bearer or JWT detail; only fixed public data is safe.
        respondFailure(request, response, publicFailure(error));
      }
    };

  const requireJson = (
    request: RequestWithContext,
    response: Response,
    next: NextFunction,
  ): void => {
    if (!request.is("application/json")) {
      respondFailure(request, response, unsupportedMediaType());
      return;
    }
    next();
  };

  const execute = async (
    request: RequestWithContext,
    response: Response,
    work: () => Promise<SuccessResponse>,
  ): Promise<void> => {
    const context = request[requestContext];
    if (!context) return;
    const remainingMs = Math.floor(
      config.http.requestTimeoutMs - (now() - context.startedAt),
    );
    if (remainingMs <= 0) {
      respondFailure(request, response, timedOut());
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const success = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(timedOut()), remainingMs);
        }),
      ]);
      if (
        success.resultCount !== undefined &&
        success.resultCount > config.http.maxResultItems
      ) {
        respondFailure(request, response, oversizedResult());
        return;
      }
      const body = JSON.stringify({
        ok: true,
        operationId: context.operationId,
        data: success.data,
      });
      if (Buffer.byteLength(body, "utf8") > config.http.maxJsonResponseBytes) {
        respondFailure(request, response, oversizedResult());
        return;
      }
      complete(request, response, "succeeded", success.status, body, {
        fileId: success.fileId,
        resultCount: success.resultCount,
      });
    } catch (error) {
      // Domain/provider errors are classifications only; raw objects are never public data.
      respondFailure(
        request,
        response,
        isTimeoutFailure(error) ? timedOut() : publicFailure(error),
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const parseQuery = <T>(
    schema: z.ZodType<T>,
    request: Request,
  ): T | undefined => {
    const parsed = schema.safeParse(request.query);
    return parsed.success ? parsed.data : undefined;
  };
  const parseBody = <T>(
    schema: z.ZodType<T>,
    request: Request,
  ): T | undefined => {
    const parsed = schema.safeParse(request.body);
    return parsed.success ? parsed.data : undefined;
  };
  const unavailableWrite = (): MarkdownWriteSession | undefined =>
    writeSessionProvider.getWriteSession();

  app.get("/healthz", (_request, response) => {
    response.set("Cache-Control", "no-store");
    response
      .type("application/json")
      .status(200)
      .send(JSON.stringify({ ok: true }));
  });

  app.get(
    "/v1/markdown/list",
    protectedRoute("list_markdown"),
    (request: RequestWithContext, response) => {
      const input = parseQuery(listSchema(), request);
      if (!input) return respondFailure(request, response, invalidRequest());
      return execute(request, response, async () => {
        const items = await service.listMarkdown({
          ...(input.path === undefined ? {} : { path: input.path }),
          ...(input.recursive === undefined
            ? {}
            : { recursive: input.recursive === "true" }),
        });
        return { status: 200, data: { items }, resultCount: items.length };
      });
    },
  );

  app.get(
    "/v1/markdown/search",
    protectedRoute("search_markdown"),
    (request: RequestWithContext, response) => {
      const input = parseQuery(
        searchSchema(config.http.maxResultItems),
        request,
      );
      if (!input) return respondFailure(request, response, invalidRequest());
      return execute(request, response, async () => {
        const items = await service.searchMarkdown({
          query: input.query,
          ...(input.path === undefined ? {} : { path: input.path }),
          ...(input.limit === undefined ? {} : { limit: Number(input.limit) }),
        });
        return { status: 200, data: { items }, resultCount: items.length };
      });
    },
  );

  app.get(
    "/v1/markdown/read",
    protectedRoute("read_markdown"),
    (request: RequestWithContext, response) => {
      const input = parseQuery(locatorSchema(), request);
      if (!input) return respondFailure(request, response, invalidRequest());
      return execute(request, response, async () => {
        const data = await service.readMarkdown(
          "path" in input
            ? { path: input.path }
            : { fileId: fileId(input.fileId) },
        );
        return { status: 200, data, fileId: data.fileId };
      });
    },
  );

  const writeRoute = <T>(
    path: string,
    operation: MarkdownApiOperation,
    schema: z.ZodType<T>,
    action: (
      session: MarkdownWriteSession,
      input: T,
    ) => Promise<MarkdownFileMetadata>,
    status: 200 | 201,
  ): void => {
    app.post(
      path,
      protectedRoute(operation),
      requireJson,
      jsonParser,
      (request: RequestWithContext, response) => {
        const input = parseBody(schema, request);
        if (!input) return respondFailure(request, response, invalidRequest());
        const session = unavailableWrite();
        if (!session)
          return respondFailure(
            request,
            response,
            failure(
              503,
              "UNSUPPORTED",
              "Operation is unavailable.",
              "unsupported",
            ),
          );
        return execute(request, response, async () => {
          const data = await action(session, input);
          return { status, data, fileId: data.fileId };
        });
      },
    );
  };

  writeRoute(
    "/v1/markdown/create",
    "create_markdown",
    createSchema(config.http.maxRequestMarkdownBytes),
    (session, input) => session.createMarkdown(input),
    201,
  );
  writeRoute(
    "/v1/markdown/update",
    "update_markdown",
    updateSchema(config.http.maxRequestMarkdownBytes),
    (session, input) =>
      session.updateMarkdown({
        ...("path" in input
          ? { path: input.path }
          : { fileId: fileId(input.fileId) }),
        expectedRevision: revision(input.expectedRevision),
        content: input.content,
      }),
    200,
  );
  writeRoute(
    "/v1/markdown/archive",
    "archive_markdown",
    archiveSchema(),
    (session, input) =>
      session.archiveMarkdown({
        ...("path" in input
          ? { path: input.path }
          : { fileId: fileId(input.fileId) }),
        expectedRevision: revision(input.expectedRevision),
      }),
    200,
  );

  app.use(
    (
      _error: unknown,
      request: RequestWithContext,
      response: Response,
      _next: NextFunction,
    ) => {
      if (request[requestContext]) {
        respondFailure(request, response, invalidRequest());
        return;
      }
      response.set("Cache-Control", "no-store");
      response
        .type("application/json")
        .status(500)
        .send(
          JSON.stringify({
            ok: false,
            error: { code: "INTERNAL", message: "Internal server error." },
          }),
        );
    },
  );

  return app;
}

function isTimeoutFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "REQUEST_TIMEOUT"
  );
}
