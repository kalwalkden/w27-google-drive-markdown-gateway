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

  it("requires successful archival and stale readback after HTTP 412", () => {
    expect(
      validateAtomicDriveProof({
        ...validEvidence(),
        cleanup: { status: "FAILED", reason: "archive-verification-failed" },
      }),
    ).toEqual({ valid: false, reason: "evidence-cleanup-not-archived" });

    const evidence = validEvidence();
    const stale = evidence.checks.find(
      (check) => check.id === "stale-content-update",
    );
    if (!stale) throw new Error("fixture missing stale content check");
    stale.opaqueParentRefs = [];
    expect(validateAtomicDriveProof(evidence)).toEqual({
      valid: false,
      reason: "evidence-atomic-proof-missing",
    });
  });

  it("accepts optional revision metadata and no ETag on an HTTP 412 response", () => {
    const evidence = validEvidence();
    for (const check of evidence.checks) delete check.headRevisionId;
    for (const id of ["stale-content-update", "stale-parent-move"]) {
      const check = evidence.checks.find((entry) => entry.id === id);
      if (!check) throw new Error("fixture missing stale check");
      delete check.responseEtag;
    }
    expect(validateAtomicDriveProof(evidence)).toEqual({ valid: true });
  });

  it("compares each claimed unchanged readback rather than trusting passed flags", () => {
    const evidence = validEvidence();
    const staleContent = evidence.checks.find(
      (check) => check.id === "stale-content-update",
    );
    if (!staleContent) throw new Error("fixture missing stale content check");
    staleContent.payloadSha256 = "e".repeat(64);
    expect(validateAtomicDriveProof(evidence)).toEqual({
      valid: false,
      reason: "evidence-atomic-proof-missing",
    });

    const changedFreshPayload = validEvidence();
    const fresh = changedFreshPayload.checks.find(
      (check) => check.id === "fresh-content-update",
    );
    if (!fresh) throw new Error("fixture missing fresh content check");
    fresh.payloadSha256 = "a".repeat(64);
    expect(validateAtomicDriveProof(changedFreshPayload)).toEqual({
      valid: false,
      reason: "evidence-atomic-proof-missing",
    });

    const changedFile = validEvidence();
    const secondFresh = changedFile.checks.find(
      (check) => check.id === "fresh-content-update-second",
    );
    if (!secondFresh) throw new Error("fixture missing second fresh check");
    secondFresh.opaqueFileRef = "f".repeat(64);
    const staleParent = changedFile.checks.find(
      (check) => check.id === "stale-parent-move",
    );
    if (!staleParent) throw new Error("fixture missing stale parent check");
    staleParent.opaqueFileRef = "f".repeat(64);
    expect(validateAtomicDriveProof(changedFile)).toEqual({
      valid: false,
      reason: "evidence-atomic-proof-missing",
    });

    const regressedVersion = validEvidence();
    for (const id of ["fresh-content-update-second", "stale-parent-move"]) {
      const check = regressedVersion.checks.find((entry) => entry.id === id);
      if (!check) throw new Error("fixture missing second update check");
      check.version = "1";
    }
    expect(validateAtomicDriveProof(regressedVersion)).toEqual({
      valid: false,
      reason: "evidence-atomic-proof-missing",
    });
  });

  it("requires cleanup status and reason to agree", () => {
    expect(
      validateAtomicDriveProof({
        ...validEvidence(),
        cleanup: { status: "ARCHIVED", reason: "already-archived" },
      }),
    ).toEqual({ valid: false, reason: "evidence-cleanup-not-archived" });
  });

  it("does not accept a version or revision as a substitute for the stale proof", () => {
    const evidence = validEvidence();
    evidence.checks = evidence.checks.filter(
      (check) => check.id !== "stale-parent-move",
    );
    expect(validateAtomicDriveProof(evidence)).toEqual({
      valid: false,
      reason: "evidence-atomic-proof-missing",
    });
  });
});
