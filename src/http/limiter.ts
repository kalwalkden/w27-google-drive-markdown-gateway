import type { AuthenticatedPrincipal } from "../auth/principal.js";
import type { ServiceConfig } from "../config/service-config.js";

export interface RateLimitReservation {
  readonly accepted: boolean;
  readonly retryAfterSeconds?: number;
  release(): void;
}

export interface PrincipalRateLimiter {
  reserve(principal: AuthenticatedPrincipal, now: number): RateLimitReservation;
}

interface Entry {
  windowStartedAt: number;
  requestCount: number;
  concurrent: number;
}

const denied = (retryAfterSeconds: number): RateLimitReservation => ({
  accepted: false,
  retryAfterSeconds,
  release() {},
});

/** Fixed-window, bounded state limiter keyed only by normalized principals. */
export class FixedWindowPrincipalRateLimiter implements PrincipalRateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly config: ServiceConfig["http"]) {}

  reserve(
    principal: AuthenticatedPrincipal,
    now: number,
  ): RateLimitReservation {
    this.expire(now);
    const key = `${principal.kind}\u0000${principal.issuer}\u0000${principal.subject}`;
    let entry = this.entries.get(key);
    if (!entry) {
      this.evictOneIfNeeded();
      if (this.entries.size >= this.config.maxRateLimitPrincipals)
        return denied(1);
      entry = { windowStartedAt: now, requestCount: 0, concurrent: 0 };
      this.entries.set(key, entry);
    }
    if (now - entry.windowStartedAt >= this.config.rateLimitWindowMs) {
      entry.windowStartedAt = now;
      entry.requestCount = 0;
    }
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(
        (this.config.rateLimitWindowMs - (now - entry.windowStartedAt)) / 1_000,
      ),
    );
    if (
      entry.requestCount >= this.config.maxRequestsPerWindow ||
      entry.concurrent >= this.config.maxConcurrentRequestsPerPrincipal
    ) {
      return denied(retryAfterSeconds);
    }
    entry.requestCount += 1;
    entry.concurrent += 1;
    let released = false;
    return {
      accepted: true,
      release: () => {
        if (released) return;
        released = true;
        entry.concurrent = Math.max(0, entry.concurrent - 1);
      },
    };
  }

  private expire(now: number): void {
    for (const [key, entry] of this.entries) {
      if (
        entry.concurrent === 0 &&
        now - entry.windowStartedAt >= this.config.rateLimitWindowMs
      ) {
        this.entries.delete(key);
      }
    }
  }

  private evictOneIfNeeded(): void {
    if (this.entries.size < this.config.maxRateLimitPrincipals) return;
    const candidate = [...this.entries.entries()]
      .filter(([, entry]) => entry.concurrent === 0)
      .sort(
        ([leftKey, left], [rightKey, right]) =>
          left.windowStartedAt - right.windowStartedAt ||
          leftKey.localeCompare(rightKey),
      )[0];
    if (candidate) this.entries.delete(candidate[0]);
  }
}
