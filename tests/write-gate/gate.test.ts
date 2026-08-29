import { describe, expect, it } from "vitest";

import {
  WriteGate,
  maxCompactJwsBytes,
  maxEvidenceBytes,
  type WriteGateDependencies,
} from "../../src/write-gate/gate.js";
import { InMemoryConsumedApprovalStore } from "../../src/write-gate/replay-store.js";
import {
  compactHeader,
  evidenceBytes,
  validApproval,
  validEvidence,
  validTrust,
} from "./fixtures.js";

function dependencies(
  approval = validApproval(evidenceBytes(validEvidence())),
): WriteGateDependencies {
  return {
    trust: validTrust(),
    replayStore: new InMemoryConsumedApprovalStore(() =>
      Date.parse("2026-01-01T00:03:00.000Z"),
    ),
    clock: { now: () => new Date("2026-01-01T00:03:00.000Z") },
    verifier: { verify: async () => approval },
    randomBytes: () => new Uint8Array(32).fill(7),
  };
}

function input() {
  const evidence = validEvidence();
  return {
    evidence,
    evidenceBytes: evidenceBytes(evidence),
    approvalJws: compactHeader(),
  };
}

describe("write gate", () => {
  it("fails closed until trusted evidence and a matching approval are present", async () => {
    const gate = new WriteGate(dependencies());
    const decision = await gate.evaluate(input());
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error("expected a lease");
    expect(decision.audit).toEqual({
      event: "write-gate-evaluated",
      decision: "allowed",
      reason: "approved",
    });
    expect(gate.validateLease(decision.lease).allowed).toBe(true);
  });

  it("denies byte-level evidence changes even when the parsed object is unchanged", async () => {
    const value = input();
    const modifiedBytes = new TextEncoder().encode(
      ` ${new TextDecoder().decode(value.evidenceBytes)}`,
    );
    const decision = await new WriteGate(dependencies()).evaluate({
      ...value,
      evidenceBytes: modifiedBytes,
    });
    expect(decision).toMatchObject({
      allowed: false,
      reason: "approval-digest-mismatch",
    });
  });

  it("denies evidence that does not exactly match the parsed caller value", async () => {
    const value = input();
    const decision = await new WriteGate(dependencies()).evaluate({
      ...value,
      evidence: { ...value.evidence, outcome: "UNSUPPORTED" },
    });
    expect(decision).toMatchObject({
      allowed: false,
      reason: "evidence-bytes-mismatch",
    });

    await expect(
      new WriteGate(dependencies()).evaluate({
        ...value,
        evidenceBytes: new TextEncoder().encode("not JSON"),
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "evidence-malformed",
    });

    await expect(
      new WriteGate(dependencies()).evaluate({
        ...value,
        evidenceBytes: new Uint8Array(maxEvidenceBytes + 1),
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "evidence-malformed",
    });
    await expect(
      new WriteGate(dependencies()).evaluate({
        ...value,
        approvalJws: "a".repeat(maxCompactJwsBytes + 1),
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "approval-header-invalid",
    });
  });

  it("binds approval to environment, topology, and a configured fingerprint", async () => {
    const value = input();
    const approval = validApproval(value.evidenceBytes);
    approval.gatewayEnvironment = "other-environment";
    const decision = await new WriteGate(dependencies(approval)).evaluate(
      value,
    );
    expect(decision).toMatchObject({
      allowed: false,
      reason: "approval-binding-mismatch",
    });
  });

  it("rejects malformed headers, unknown keys, expired approvals, and replay", async () => {
    const value = input();
    await expect(
      new WriteGate(dependencies()).evaluate({
        ...value,
        approvalJws: compactHeader({ alg: "none" }),
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "approval-header-invalid",
    });

    await expect(
      new WriteGate(dependencies()).evaluate({
        ...value,
        approvalJws: compactHeader({ kid: "retired-key" }),
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "approval-key-unknown",
    });

    const expired = validApproval(value.evidenceBytes);
    expired.issuedAt = "2026-01-01T00:00:00.000Z";
    expired.expiresAt = "2026-01-01T00:02:00.000Z";
    await expect(
      new WriteGate(dependencies(expired)).evaluate(value),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "approval-expired",
    });

    const future = validApproval(value.evidenceBytes);
    future.issuedAt = "2026-01-01T00:04:00.000Z";
    future.expiresAt = "2026-01-01T00:05:00.000Z";
    await expect(
      new WriteGate(dependencies(future)).evaluate(value),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "approval-issued-in-future",
    });

    const longLived = validApproval(value.evidenceBytes);
    longLived.expiresAt = "2026-01-01T00:13:00.001Z";
    await expect(
      new WriteGate(dependencies(longLived)).evaluate(value),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "approval-lifetime-invalid",
    });

    const sharedDependencies = dependencies();
    const gate = new WriteGate(sharedDependencies);
    expect((await gate.evaluate(value)).allowed).toBe(true);
    await expect(gate.evaluate(value)).resolves.toMatchObject({
      allowed: false,
      reason: "approval-replayed",
    });
  });

  it("requires an atomic replay store and expires opaque leases", async () => {
    const storeFailure = new WriteGate({
      ...dependencies(),
      replayStore: {
        consumeOnce: async () => Promise.reject(new Error("no store")),
      },
    });
    await expect(storeFailure.evaluate(input())).resolves.toMatchObject({
      allowed: false,
      reason: "approval-store-unavailable",
    });

    let now = new Date("2026-01-01T00:03:00.000Z");
    const gate = new WriteGate({
      ...dependencies(),
      clock: { now: () => now },
      trust: { ...validTrust(), leaseLifetimeMs: 1 },
    });
    const decision = await gate.evaluate(input());
    if (!decision.allowed) throw new Error("expected lease");
    now = new Date("2026-01-01T00:03:00.001Z");
    expect(gate.validateLease(decision.lease)).toMatchObject({
      allowed: false,
      reason: "lease-expired",
    });
    expect(gate.validateLease({ value: "fabricated" })).toMatchObject({
      allowed: false,
      reason: "lease-invalid",
    });
    expect(
      gate.validateLease(undefined as unknown as { readonly value: string }),
    ).toMatchObject({ allowed: false, reason: "lease-invalid" });

    const malformedRandom = new WriteGate({
      ...dependencies(),
      randomBytes: () => new Uint8Array(31),
    });
    await expect(malformedRandom.evaluate(input())).resolves.toMatchObject({
      allowed: false,
      reason: "lease-generation-failed",
    });
  });

  it("fails closed for throwing or invalid clocks without retaining a usable lease", async () => {
    const expired = validApproval(evidenceBytes(validEvidence()));
    expired.expiresAt = "2026-01-01T00:02:00.000Z";
    const throwing = new WriteGate({
      ...dependencies(expired),
      clock: {
        now: () => {
          throw new Error("clock unavailable");
        },
      },
    });
    await expect(throwing.evaluate(input())).resolves.toMatchObject({
      allowed: false,
      reason: "clock-invalid",
    });

    const invalid = new WriteGate({
      ...dependencies(),
      clock: { now: () => new Date(Number.NaN) },
    });
    await expect(invalid.evaluate(input())).resolves.toMatchObject({
      allowed: false,
      reason: "clock-invalid",
    });

    let now = new Date("2026-01-01T00:03:00.000Z");
    const gate = new WriteGate({
      ...dependencies(),
      clock: { now: () => now },
    });
    const decision = await gate.evaluate(input());
    if (!decision.allowed) throw new Error("expected lease");
    now = new Date(Number.NaN);
    expect(gate.validateLease(decision.lease)).toMatchObject({
      allowed: false,
      reason: "clock-invalid",
    });
  });

  it("never lets a lease outlive the signed approval", async () => {
    let now = new Date("2026-01-01T00:03:00.000Z");
    const value = input();
    const approval = validApproval(value.evidenceBytes);
    approval.expiresAt = "2026-01-01T00:03:10.000Z";
    const gate = new WriteGate({
      ...dependencies(approval),
      clock: { now: () => now },
      trust: { ...validTrust(), leaseLifetimeMs: 60_000 },
    });
    const decision = await gate.evaluate(value);
    if (!decision.allowed) throw new Error("expected lease");
    now = new Date("2026-01-01T00:03:10.000Z");
    expect(gate.validateLease(decision.lease)).toMatchObject({
      allowed: false,
      reason: "lease-expired",
    });
  });

  it("denies capability evidence older than deployment policy", async () => {
    const evidence = validEvidence();
    evidence.startedAt = "2025-01-01T00:00:00.000Z";
    evidence.finishedAt = "2025-01-01T00:01:00.000Z";
    const bytes = evidenceBytes(evidence);
    await expect(
      new WriteGate(dependencies(validApproval(bytes))).evaluate({
        evidence,
        evidenceBytes: bytes,
        approvalJws: compactHeader(),
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "evidence-too-old",
    });
  });

  it("denies malformed deployment trust rather than throwing", async () => {
    const gate = new WriteGate({
      ...dependencies(),
      trust: undefined as unknown as WriteGateDependencies["trust"],
    });
    await expect(gate.evaluate(input())).resolves.toMatchObject({
      allowed: false,
      reason: "runtime-trust-invalid",
    });
    await expect(
      new WriteGate({
        ...dependencies(),
        trust: { ...validTrust(), verificationKeys: {} },
      }).evaluate(input()),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "runtime-trust-invalid",
    });
  });
});
