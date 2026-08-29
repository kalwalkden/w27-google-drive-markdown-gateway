import pino from "pino";

import type { AuthenticatedPrincipal } from "../auth/principal.js";
import { isWellFormedUtf16 } from "../domain/markdown.js";
import type { DriveProviderFailure } from "../drive/provider-error.js";

export type MarkdownApiOperation =
  | "mcp"
  | "list_markdown"
  | "search_markdown"
  | "read_markdown"
  | "create_markdown"
  | "update_markdown"
  | "archive_markdown";

export type MarkdownApiAuditResult =
  | "succeeded"
  | "unauthenticated"
  | "invalid_request"
  | "unsupported_media_type"
  | "invalid_path"
  | "not_markdown"
  | "invalid_content"
  | "file_too_large"
  | "not_found"
  | "ambiguous_path"
  | "conflict"
  | "unsupported"
  | "rate_limited"
  | "timeout"
  | "result_limit_exceeded"
  | "upstream_unavailable"
  | "internal";

export type AuditPrincipal =
  | Readonly<{
      readonly kind: "unauthenticated";
    }>
  | Readonly<{
      readonly kind: AuthenticatedPrincipal["kind"];
      readonly subject: string;
      readonly issuer: string;
    }>;

export interface MarkdownApiAuditEvent {
  readonly event: "markdown-api-request";
  readonly operationId: string;
  readonly operation: MarkdownApiOperation;
  readonly principal: AuditPrincipal;
  readonly result: MarkdownApiAuditResult;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly fileId?: string;
  readonly dependency?: "drive";
  readonly dependencyFailure?: DriveProviderFailure;
  readonly resultCount?: number;
}

/** This narrow seam prevents routes from passing arbitrary objects to Pino. */
export interface AuditLogger {
  info(event: MarkdownApiAuditEvent): void;
}

export type MarkdownMetricObservation =
  | Readonly<{
      readonly metric: "gateway_http_requests_total";
      readonly operation: MarkdownApiOperation;
      readonly principalKind: AuditPrincipal["kind"];
      readonly result: MarkdownApiAuditResult;
    }>
  | Readonly<{
      readonly metric: "gateway_http_request_duration_ms";
      readonly operation: MarkdownApiOperation;
      readonly result: MarkdownApiAuditResult;
      readonly value: number;
    }>
  | Readonly<{
      readonly metric: "gateway_http_in_flight";
      readonly operation: MarkdownApiOperation;
      readonly value: -1 | 1;
    }>
  | Readonly<{
      readonly metric: "gateway_rate_limit_rejections_total";
      readonly operation: MarkdownApiOperation;
      readonly principalKind: AuditPrincipal["kind"];
    }>
  | Readonly<{
      readonly metric: "gateway_request_timeouts_total";
      readonly operation: MarkdownApiOperation;
    }>
  | Readonly<{
      readonly metric: "gateway_dependency_failures_total";
      readonly operation: MarkdownApiOperation;
      readonly dependency: "drive";
      readonly failure: DriveProviderFailure;
    }>;

/** A typed seam with no labels API; composition chooses any future backend. */
export interface MetricRecorder {
  record(observation: MarkdownMetricObservation): void;
}

export const noOpMetricRecorder: MetricRecorder = {
  record: () => undefined,
};

/** Records a request start without allowing recorder availability to affect it. */
export function recordOperationInFlight(
  metricRecorder: MetricRecorder,
  operation: MarkdownApiOperation,
): void {
  try {
    metricRecorder.record({
      metric: "gateway_http_in_flight",
      operation,
      value: 1,
    });
  } catch {
    // Telemetry availability cannot affect request handling.
  }
}

/** Emits the closed terminal telemetry set after an operation has been classified. */
export function recordOperationTerminal(
  auditLogger: AuditLogger,
  metricRecorder: MetricRecorder,
  event: MarkdownApiAuditEvent,
): void {
  try {
    auditLogger.info(event);
  } catch {
    // Telemetry availability cannot affect an already-classified response.
  }
  try {
    metricRecorder.record({
      metric: "gateway_http_requests_total",
      operation: event.operation,
      principalKind: event.principal.kind,
      result: event.result,
    });
    metricRecorder.record({
      metric: "gateway_http_request_duration_ms",
      operation: event.operation,
      result: event.result,
      value: event.durationMs,
    });
    metricRecorder.record({
      metric: "gateway_http_in_flight",
      operation: event.operation,
      value: -1,
    });
    if (event.result === "rate_limited") {
      metricRecorder.record({
        metric: "gateway_rate_limit_rejections_total",
        operation: event.operation,
        principalKind: event.principal.kind,
      });
    }
    if (event.result === "timeout") {
      metricRecorder.record({
        metric: "gateway_request_timeouts_total",
        operation: event.operation,
      });
    }
    if (event.dependencyFailure !== undefined) {
      metricRecorder.record({
        metric: "gateway_dependency_failures_total",
        operation: event.operation,
        dependency: "drive",
        failure: event.dependencyFailure,
      });
    }
  } catch {
    // Telemetry availability cannot affect an already-classified response.
  }
}

const pinoOptions = {
  redact: {
    paths: [
      "authorization",
      "token",
      "secret",
      "content",
      "password",
      "path",
      "query",
      "revision",
      "*.authorization",
      "*.token",
      "*.secret",
      "*.content",
      "*.password",
      "*.path",
      "*.query",
      "*.revision",
    ],
    censor: "[REDACTED]",
  },
};

/** Creates a logger only when application composition explicitly requests one. */
export function createPinoAuditLogger(
  destination?: Parameters<typeof pino>[1],
): AuditLogger {
  return destination === undefined
    ? pino(pinoOptions)
    : pino(pinoOptions, destination);
}

function isSafeAuditString(value: string): boolean {
  return (
    isWellFormedUtf16(value) &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= 512 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || (codePoint >= 127 && codePoint <= 159);
    })
  );
}

/** Returns a canonical opaque provider ID only when it is safe for the audit schema. */
export function auditFileId(value: string | undefined): string | undefined {
  return value !== undefined && /^[A-Za-z0-9_-]{1,256}$/u.test(value)
    ? value
    : undefined;
}

/** Converts only already-normalized principal facts into an audit-safe identity. */
export function auditPrincipal(
  principal: AuthenticatedPrincipal | undefined,
): AuditPrincipal {
  if (
    principal === undefined ||
    !isSafeAuditString(principal.subject) ||
    !isSafeAuditString(principal.issuer)
  ) {
    return { kind: "unauthenticated" };
  }
  return {
    kind: principal.kind,
    subject: principal.subject,
    issuer: principal.issuer,
  };
}
