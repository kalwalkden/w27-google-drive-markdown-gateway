import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const readAsset = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const procedureKinds = [
  "work-jwt-rotation",
  "codex-bearer-rotation",
  "google-my-drive-rotation",
  "google-shared-drive-rotation",
  "drive-version-recovery",
  "outage-timeout-recovery",
  "cleanup-retention-review",
] as const;
const environmentClasses = ["non-production", "production"] as const;
const outcomes = ["not-executed", "succeeded", "stopped", "escalated"] as const;
const ownerRoles = [
  "service-operator",
  "identity-owner",
  "drive-administrator",
  "deployment-administrator",
] as const;
const stepNames = [
  "authorize",
  "provision-replacement",
  "validate",
  "rollback",
  "revoke-or-retire",
  "recover",
  "record-outcome",
] as const;
const stepStatuses = [
  "not-started",
  "completed",
  "stopped",
  "escalated",
] as const;
const reasonCodes = [
  "template",
  "approved",
  "validated",
  "rollback-required",
  "access-uncertain",
  "recovery-uncertain",
] as const;
const followUpStates = ["none", "open", "closed"] as const;

type ExerciseRecord = Readonly<{
  schemaVersion: 1;
  exerciseReference: string;
  procedureKind: (typeof procedureKinds)[number];
  environmentClass: (typeof environmentClasses)[number];
  recordedAt: string;
  outcome: (typeof outcomes)[number];
  ownerRole: (typeof ownerRoles)[number];
  approvalReferenceDigest: string;
  steps: readonly Readonly<{
    name: (typeof stepNames)[number];
    status: (typeof stepStatuses)[number];
    reasonCode: (typeof reasonCodes)[number];
  }>[];
  redaction: Readonly<{
    rawIdentifiersStored: false;
    documentContentStored: false;
    credentialsStored: false;
    requestResponseBodiesStored: false;
    urlsStored: false;
    errorsOrStacksStored: false;
    secretReferencesStored: false;
  }>;
  followUp: Readonly<{
    state: (typeof followUpStates)[number];
    reference: string;
  }>;
}>;

const hasOnlyKeys = (value: object, expected: readonly string[]) =>
  Object.keys(value).length === expected.length &&
  Object.keys(value).every((key) => expected.includes(key));

const isBoundedText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

const isOneOf = <T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] => typeof value === "string" && allowed.includes(value);

/** Parses only the closed, synthetic operator exercise-record shape. */
function parseExerciseRecord(value: unknown): ExerciseRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("record must be an object");
  const record = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(record, [
      "schemaVersion",
      "exerciseReference",
      "procedureKind",
      "environmentClass",
      "recordedAt",
      "outcome",
      "ownerRole",
      "approvalReferenceDigest",
      "steps",
      "redaction",
      "followUp",
    ]) ||
    record.schemaVersion !== 1 ||
    !isBoundedText(record.exerciseReference) ||
    !isOneOf(record.procedureKind, procedureKinds) ||
    !isOneOf(record.environmentClass, environmentClasses) ||
    typeof record.recordedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(record.recordedAt) ||
    !isOneOf(record.outcome, outcomes) ||
    !isOneOf(record.ownerRole, ownerRoles) ||
    !isBoundedText(record.approvalReferenceDigest) ||
    !Array.isArray(record.steps) ||
    record.steps.length < 1 ||
    record.steps.length > stepNames.length ||
    !record.redaction ||
    typeof record.redaction !== "object" ||
    Array.isArray(record.redaction) ||
    !record.followUp ||
    typeof record.followUp !== "object" ||
    Array.isArray(record.followUp)
  ) {
    throw new Error("record is not a closed exercise template");
  }

  if (
    !hasOnlyKeys(record.redaction, [
      "rawIdentifiersStored",
      "documentContentStored",
      "credentialsStored",
      "requestResponseBodiesStored",
      "urlsStored",
      "errorsOrStacksStored",
      "secretReferencesStored",
    ]) ||
    Object.values(record.redaction).some((stored) => stored !== false)
  ) {
    throw new Error("record redaction must explicitly reject raw material");
  }

  const followUp = record.followUp as Record<string, unknown>;
  if (
    !hasOnlyKeys(followUp, ["state", "reference"]) ||
    !isOneOf(followUp.state, followUpStates) ||
    !isBoundedText(followUp.reference)
  ) {
    throw new Error("record follow-up must be closed and bounded");
  }

  for (const step of record.steps) {
    if (
      !step ||
      typeof step !== "object" ||
      Array.isArray(step) ||
      !hasOnlyKeys(step, ["name", "status", "reasonCode"]) ||
      !isOneOf(step.name, stepNames) ||
      !isOneOf(step.status, stepStatuses) ||
      !isOneOf(step.reasonCode, reasonCodes)
    ) {
      throw new Error("record step must be closed and bounded");
    }
  }

  return record as unknown as ExerciseRecord;
}

describe("operator runbooks", () => {
  it("keeps the exercise template closed, synthetic, and explicitly redacted", async () => {
    const source = await readAsset(
      "docs/operations-exercise-record.example.json",
    );
    const record = parseExerciseRecord(JSON.parse(source));

    expect(record).toMatchObject({
      schemaVersion: 1,
      exerciseReference: "template-exercise-reference",
      procedureKind: "codex-bearer-rotation",
      environmentClass: "non-production",
      recordedAt: "2000-01-01T00:00:00.000Z",
      outcome: "not-executed",
      ownerRole: "service-operator",
      approvalReferenceDigest: "template-approval-digest",
      followUp: { state: "none", reference: "template-follow-up-reference" },
    });
    expect(record.steps).toEqual([
      { name: "authorize", status: "not-started", reasonCode: "template" },
    ]);
    expect(record.redaction).toEqual({
      rawIdentifiersStored: false,
      documentContentStored: false,
      credentialsStored: false,
      requestResponseBodiesStored: false,
      urlsStored: false,
      errorsOrStacksStored: false,
      secretReferencesStored: false,
    });
    expect(() =>
      parseExerciseRecord({ ...record, credential: "not-allowed" }),
    ).toThrow();
    expect(() =>
      parseExerciseRecord({
        ...record,
        redaction: { ...record.redaction, credentialsStored: true },
      }),
    ).toThrow();
    expect(source).not.toMatch(
      /accessToken|refreshToken|clientSecret|authorization|https?:\/\/|\/folders\//iu,
    );
  });

  it("covers the independent rotation, alert, and recovery boundaries", async () => {
    const document = await readAsset("docs/operations.md");

    for (const requiredText of [
      "operator-only",
      "Work JWT / Codex Work",
      "Codex bearer",
      "Google Drive credentials",
      "my-drive-refresh-token",
      "shared-drive-adc",
      "revoke",
      "gateway_http_requests_total",
      "gateway_http_request_duration_ms",
      "gateway_request_timeouts_total",
      "gateway_dependency_failures_total",
      "gateway_rate_limit_rejections_total",
      "Sustained authentication failures",
      "Drive dependency degradation",
      "Deadline/latency degradation",
      "Rate-limit pressure",
      "Drive version-history recovery",
      "root-confined Markdown file",
      "archive is disabled",
      "six JSON operations",
      "Exclude `mcp` and `/healthz`",
      "no equivalent application-level deadline or limiter",
      "bounded, root-confined nested/recursive read surface",
      "15-minute acknowledgement target",
      "service operator",
      "identity owner",
      "Drive administrator",
      "deployment administrator",
    ]) {
      expect(document).toContain(requiredText);
    }
    expect(document).toMatch(/no\s+live drill/iu);
    expect(document).toMatch(/do not retry or\s+replay a mutation/iu);
    expect(document).toMatch(/never delete or trash versions/iu);
    expect(document).toContain("Drive delete");
    expect(document).toMatch(/Drive\s+trash/iu);
    expect(document).toMatch(
      /no monitoring backend.*deployed alert policy exists/iu,
    );
    expect(document).toContain("at least 10 in 5 minutes");
    expect(document).toContain("at least 20% of routed terminal requests");
    expect(document).toContain("at least 80% of configured `requestTimeoutMs`");
    expect(document).toContain(
      "at least 20 completed matching JSON routed requests",
    );
  });

  it("does not embed sensitive examples or operationally unsafe assertions", async () => {
    const [document, template] = await Promise.all([
      readAsset("docs/operations.md"),
      readAsset("docs/operations-exercise-record.example.json"),
    ]);
    const checkedInAssets = `${document}\n${template}`;

    expect(checkedInAssets).not.toMatch(/-----BEGIN [A-Z ]+-----/u);
    expect(checkedInAssets).not.toMatch(
      /authorization\s*:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=:-]{12,}/iu,
    );
    expect(checkedInAssets).not.toMatch(
      /(?:access|refresh)[_-]?token\s*[:=]\s*["'][^"']+/iu,
    );
    expect(checkedInAssets).not.toMatch(
      /(?:client[_-]?secret|credential)\s*[:=]\s*["'][^"']+/iu,
    );
    expect(checkedInAssets).not.toMatch(/https?:\/\/[^\s)]+/iu);
    expect(checkedInAssets).not.toMatch(/drive\.google\.com|\/folders\//iu);
    expect(checkedInAssets).not.toMatch(
      /(?:provider[- ]?error|stack trace)\s*[:=]\s*["'][^"']+/iu,
    );
  });
});
