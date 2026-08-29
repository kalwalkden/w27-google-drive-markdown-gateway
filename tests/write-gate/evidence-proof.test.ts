import { describe, expect, it } from "vitest";

import { validateAtomicDriveProof } from "../../src/write-gate/evidence-proof.js";
import { validEvidence } from "./fixtures.js";

describe("atomic Drive evidence proof", () => {
  it("accepts only the complete successful two-stale-operation proof", () => {
    expect(validateAtomicDriveProof(validEvidence())).toEqual({ valid: true });
  });

  it.each(["UNSUPPORTED", "INCONCLUSIVE"] as const)(
    "denies %s outcomes",
    (outcome) => {
      expect(validateAtomicDriveProof({ ...validEvidence(), outcome })).toEqual(
        {
          valid: false,
          reason: "evidence-not-supported",
        },
      );
    },
  );

  it("requires a separately successful operation and readback for every non-stale proof", () => {
    for (const id of [
      "create",
      "fresh-content-update",
      "fresh-content-update-second",
    ]) {
      const evidence = validEvidence();
      const check = evidence.checks.find((entry) => entry.id === id);
      if (!check) throw new Error("fixture missing check");
      delete check.operationStatus;
      expect(validateAtomicDriveProof(evidence)).toEqual({
        valid: false,
        reason: "evidence-atomic-proof-missing",
      });
    }

    for (const id of [
      "create-download",
      "actor-b-s0",
      "fresh-content-update",
    ]) {
      const evidence = validEvidence();
      const check = evidence.checks.find((entry) => entry.id === id);
      if (!check?.readback) throw new Error("fixture missing readback");
      check.readback.downloadStatus = 500;
      expect(validateAtomicDriveProof(evidence)).toEqual({
        valid: false,
        reason: "evidence-atomic-proof-missing",
      });
    }
  });

  it("requires the recorded current If-Match and unchanged readback, not passed flags", () => {
    const wrongIfMatch = validEvidence();
    const fresh = wrongIfMatch.checks.find(
      (check) => check.id === "fresh-content-update",
    );
    if (!fresh) throw new Error("fixture missing fresh content check");
    fresh.ifMatchEtag = '"not-current"';
    expect(validateAtomicDriveProof(wrongIfMatch)).toEqual({
      valid: false,
      reason: "evidence-atomic-proof-missing",
    });

    const changedReadback = validEvidence();
    const stale = changedReadback.checks.find(
      (check) => check.id === "stale-content-update",
    );
    if (!stale?.readback) throw new Error("fixture missing stale readback");
    stale.readback.payloadSha256 = "e".repeat(64);
    expect(validateAtomicDriveProof(changedReadback)).toEqual({
      valid: false,
      reason: "evidence-atomic-proof-missing",
    });
  });

  it("requires exact stale 412 operations, compatible topology, and verified cleanup", () => {
    const stale = validEvidence();
    const staleParent = stale.checks.find(
      (check) => check.id === "stale-parent-move",
    );
    if (!staleParent) throw new Error("fixture missing stale parent check");
    staleParent.operationStatus = 409;
    expect(validateAtomicDriveProof(stale)).toEqual({
      valid: false,
      reason: "evidence-atomic-proof-missing",
    });

    expect(
      validateAtomicDriveProof({
        ...validEvidence(),
        cleanup: { status: "FAILED", reason: "archive-verification-failed" },
      }),
    ).toEqual({ valid: false, reason: "evidence-cleanup-not-archived" });

    const noPreflight = validEvidence();
    noPreflight.checks = noPreflight.checks.filter(
      (check) => check.id !== "preflight-root",
    );
    expect(validateAtomicDriveProof(noPreflight)).toEqual({
      valid: false,
      reason: "evidence-atomic-proof-missing",
    });
  });
});
