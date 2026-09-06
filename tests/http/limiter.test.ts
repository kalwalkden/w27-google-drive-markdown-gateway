import { describe, expect, it } from "vitest";

import type { AuthenticatedPrincipal } from "../../src/auth/principal.js";
import type { ServiceConfig } from "../../src/config/service-config.js";
import { FixedWindowPrincipalRateLimiter } from "../../src/http/limiter.js";

const limits: ServiceConfig["http"] = {
  maxRequestMarkdownBytes: 1,
  maxJsonBodyBytes: 4_096,
  maxResultItems: 1,
  maxJsonResponseBytes: 4_096,
  requestTimeoutMs: 100,
  rateLimitWindowMs: 1_000,
  maxRequestsPerWindow: 2,
  maxConcurrentRequestsPerPrincipal: 1,
  maxRateLimitPrincipals: 1,
};

const first: AuthenticatedPrincipal = {
  kind: "codex",
  subject: "first",
  issuer: "gateway-codex-bearer",
};
const second: AuthenticatedPrincipal = {
  kind: "work-mcp",
  subject: "second",
  issuer: "https://issuer.invalid",
};

describe("FixedWindowPrincipalRateLimiter", () => {
  it("limits rate/concurrency, releases once, expires, and evicts bounded idle state", () => {
    const limiter = new FixedWindowPrincipalRateLimiter(limits);
    const initial = limiter.reserve(first, 0);
    expect(initial.accepted).toBe(true);
    const concurrent = limiter.reserve(first, 0);
    expect(concurrent).toMatchObject({ accepted: false, retryAfterSeconds: 1 });

    initial.release();
    initial.release();
    const secondRequest = limiter.reserve(first, 1);
    expect(secondRequest.accepted).toBe(true);
    secondRequest.release();
    expect(limiter.reserve(first, 2)).toMatchObject({ accepted: false });

    const nextWindow = limiter.reserve(first, 1_000);
    expect(nextWindow.accepted).toBe(true);
    nextWindow.release();
    expect(limiter.reserve(second, 1_000).accepted).toBe(true);
  });
});
