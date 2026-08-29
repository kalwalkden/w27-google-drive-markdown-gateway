import { describe, expect, it } from "vitest";

import {
  auditFileId,
  auditPrincipal,
  type MarkdownApiAuditEvent,
  type MarkdownMetricObservation,
} from "../../src/observability/audit.js";

const forbidden = [
  "docs/private-plan.md",
  "folder-identifier",
  "revision-etag-123",
  "document excerpt secret",
  "Bearer credential-value",
  "oauth-client-secret",
  "/var/run/secrets/drive-oauth",
  '{"provider":"payload"}',
  "Error: provider stack",
];

describe("audit allowlist", () => {
  it("retains only a bounded, well-formed opaque file ID", () => {
    expect(auditFileId("safe-opaque-file-id")).toBe("safe-opaque-file-id");
    expect(auditFileId("x".repeat(513))).toBeUndefined();
    expect(auditFileId("lone-\ud800-surrogate")).toBeUndefined();
    expect(auditFileId("unsafe\nfile-id")).toBeUndefined();
    expect(auditFileId("../SENTINEL-PROVIDER-PATH")).toBeUndefined();
    expect(auditFileId("/var/run/secrets/SENTINEL-CREDENTIAL")).toBeUndefined();
    expect(auditFileId("https://provider.invalid/SENTINEL-ID")).toBeUndefined();
  });

  it("keeps authenticated identity facts audit-only and bounded", () => {
    expect(
      auditPrincipal({
        kind: "work-mcp",
        subject: "work-subject",
        issuer: "https://issuer.invalid",
      }),
    ).toEqual({
      kind: "work-mcp",
      subject: "work-subject",
      issuer: "https://issuer.invalid",
    });
    expect(
      auditPrincipal({
        kind: "codex",
        subject: "x".repeat(513),
        issuer: "gateway-codex-bearer",
      }),
    ).toEqual({ kind: "unauthenticated" });
  });

  it("serializes only the closed audit and metric schemas", () => {
    const audit: MarkdownApiAuditEvent = {
      event: "markdown-api-request",
      operationId: "00000000-0000-4000-8000-000000000001",
      operation: "read_markdown",
      principal: {
        kind: "codex",
        subject: "codex-subject",
        issuer: "gateway-codex-bearer",
      },
      result: "upstream_unavailable",
      statusCode: 503,
      durationMs: 12,
      fileId: "safe-opaque-file-id",
      dependency: "drive",
      dependencyFailure: "transient",
    };
    const metrics: readonly MarkdownMetricObservation[] = [
      {
        metric: "gateway_http_requests_total",
        operation: "read_markdown",
        principalKind: "codex",
        result: "upstream_unavailable",
      },
      {
        metric: "gateway_http_request_duration_ms",
        operation: "read_markdown",
        result: "upstream_unavailable",
        value: 12,
      },
      {
        metric: "gateway_http_in_flight",
        operation: "read_markdown",
        value: -1,
      },
      {
        metric: "gateway_dependency_failures_total",
        operation: "read_markdown",
        dependency: "drive",
        failure: "transient",
      },
    ];

    expect(Object.keys(audit).sort()).toEqual([
      "dependency",
      "dependencyFailure",
      "durationMs",
      "event",
      "fileId",
      "operation",
      "operationId",
      "principal",
      "result",
      "statusCode",
    ]);
    expect(JSON.stringify({ audit, metrics })).toContain("safe-opaque-file-id");
    expect(JSON.stringify(metrics)).not.toContain("safe-opaque-file-id");
    for (const value of forbidden) {
      expect(JSON.stringify({ audit, metrics })).not.toContain(value);
    }
  });

  it("allows outcome_unknown as a terminal result without extra labels", () => {
    const metric: MarkdownMetricObservation = {
      metric: "gateway_http_requests_total",
      operation: "archive_markdown",
      principalKind: "codex",
      result: "outcome_unknown",
    };
    expect(Object.keys(metric).sort()).toEqual([
      "metric",
      "operation",
      "principalKind",
      "result",
    ]);
  });
});
