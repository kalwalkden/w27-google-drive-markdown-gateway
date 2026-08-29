import pino from "pino";

import type { AuthenticatedPrincipal } from "../auth/principal.js";

export type MarkdownApiOperation =
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
  readonly resultCount?: number;
}

/** This narrow seam prevents routes from passing arbitrary objects to Pino. */
export interface AuditLogger {
  info(event: MarkdownApiAuditEvent): void;
}

const pinoOptions = {
  redact: {
    paths: [
      "authorization",
      "token",
      "content",
      "password",
      "*.authorization",
      "*.token",
      "*.content",
      "*.password",
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
    value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= 512 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || (codePoint >= 127 && codePoint <= 159);
    })
  );
}

/** Returns an opaque file ID only when it is safe for the bounded audit schema. */
export function auditFileId(value: string | undefined): string | undefined {
  return value !== undefined && isSafeAuditString(value) ? value : undefined;
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
