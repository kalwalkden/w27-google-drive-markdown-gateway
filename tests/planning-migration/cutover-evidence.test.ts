import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoSensitiveEvidence,
  evaluateCutoverPreflight,
  writeCutoverEvidenceExclusively,
} from "../../src/planning-migration/cutover-evidence.js";
import { main as cutoverMain } from "../../src/planning-migration/cutover-preflight-cli.js";
import { buildMigrationPlan } from "../../src/planning-migration/plan.js";

const manifest = {
  schemaVersion: "w27-planning-file-migration-manifest-v1",
  topology: "bounded-nested-v1",
  entries: [
    {
      key: "gateway-handoff",
      classification: "brief",
      sourcePath: "google-drive-markdown-gateway-handoff.md",
      targetPath: "briefs/google-drive-markdown-gateway-handoff.md",
      sourceSha256:
        "d6cca167761bbaa0d73843621b21f7e5b64ca48bd64897050cd00f3fa096d18d",
      collisionPolicy: "fail",
      sourceDisposition: "frozen-bootstrap-reference",
    },
  ],
} as const;
const notStarted = { status: "NOT_STARTED", reason: "NONE" } as const;
const passed = { status: "PASSED", reason: "NONE" } as const;

function config(plan: Awaited<ReturnType<typeof buildMigrationPlan>>) {
  return {
    schemaVersion: "w27-planning-file-cutover-preflight-v1" as const,
    releaseIdentifier: "ref-release",
    environmentIdentifier: "ref-environment",
    clientProfileIdentifier: "ref-client-profile",
    manifestSha256: plan.manifestSha256,
    imageDigest: `sha256:${"0".repeat(64)}`,
    nonSecretRuntimeDigest: `sha256:${"1".repeat(64)}`,
    liveDriveProbeDigest: `sha256:${"2".repeat(64)}`,
    deploymentWriteMode: "default-off" as const,
    gates: {
      write: { status: "BLOCKED", reason: "WRITE_UNAVAILABLE" } as const,
      archive: notStarted,
      destination: notStarted,
      readback: notStarted,
    },
    clients: {
      work: notStarted,
      codex: notStarted,
      macos: notStarted,
      iphone: notStarted,
      ipad: notStarted,
    },
    operations: {
      list: notStarted,
      search: notStarted,
      read: notStarted,
      create: notStarted,
      update: notStarted,
      archive: notStarted,
    },
    duplicateCreate: notStarted,
    staleUpdate: notStarted,
    archiveVerification: notStarted,
    cleanup: notStarted,
    manualRecovery: notStarted,
  };
}

function controlled(base: ReturnType<typeof config>) {
  return {
    ...base,
    deploymentWriteMode: "controlled-write-enabled" as const,
    gates: { ...base.gates, write: passed },
  };
}

describe("planning cutover evidence reducer", () => {
  it("records default-off as blocked without a source-of-truth claim", async () => {
    const plan = await buildMigrationPlan(process.cwd(), manifest);
    expect(
      evaluateCutoverPreflight(config(plan), plan, "2026-01-01T00:00:00.000Z"),
    ).toMatchObject({
      overall: "BLOCKED",
      sourceOfTruth: "not-declared",
      clients: { work: notStarted },
      operations: { create: notStarted },
    });
  });

  it("enforces closed identifiers, gate reasons, default-off stops, and client blocking", async () => {
    const plan = await buildMigrationPlan(process.cwd(), manifest);
    const base = config(plan);
    expect(() =>
      evaluateCutoverPreflight(
        { ...base, releaseIdentifier: "example-release" },
        plan,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toThrow();
    expect(() =>
      evaluateCutoverPreflight(
        {
          ...base,
          operations: { ...base.operations, list: passed },
        },
        plan,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toThrow();
    const enabled = controlled(base);
    expect(() =>
      evaluateCutoverPreflight(
        {
          ...enabled,
          clients: {
            ...enabled.clients,
            work: { status: "BLOCKED", reason: "WRITE_UNAVAILABLE" },
          },
        },
        plan,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toThrow("client");
    expect(() =>
      evaluateCutoverPreflight(
        {
          ...enabled,
          gates: {
            ...enabled.gates,
            destination: { status: "PASSED", reason: "CONFLICT" },
          },
        },
        plan,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toThrow("gate");
  });

  it("requires ordered prerequisites and manual recovery for uncertain primary mutations", async () => {
    const plan = await buildMigrationPlan(process.cwd(), manifest);
    const enabled = controlled(config(plan));
    expect(() =>
      evaluateCutoverPreflight(
        {
          ...enabled,
          operations: { ...enabled.operations, create: passed },
        },
        plan,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toThrow("create-readiness");
    const uncertain = {
      ...enabled,
      gates: { ...enabled.gates, destination: passed, archive: passed },
      operations: {
        ...enabled.operations,
        create: { status: "FAILED", reason: "OUTCOME_UNKNOWN" } as const,
      },
      manualRecovery: {
        status: "INCONCLUSIVE",
        reason: "MANUAL_RECOVERY_REQUIRED",
      } as const,
    };
    expect(
      evaluateCutoverPreflight(uncertain, plan, "2026-01-01T00:00:00.000Z"),
    ).toMatchObject({ overall: "INCONCLUSIVE" });
    expect(() =>
      evaluateCutoverPreflight(
        {
          ...uncertain,
          operations: { ...uncertain.operations, update: passed },
        },
        plan,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toThrow();
  });

  it("gives archive and cleanup failures manual-recovery priority", async () => {
    const plan = await buildMigrationPlan(process.cwd(), manifest);
    const enabled = controlled(config(plan));
    const progressed = {
      ...enabled,
      gates: {
        ...enabled.gates,
        archive: passed,
        destination: passed,
        readback: passed,
      },
      operations: {
        ...enabled.operations,
        create: passed,
        update: passed,
        archive: passed,
      },
      duplicateCreate: { status: "FAILED", reason: "CONFLICT" } as const,
      staleUpdate: { status: "FAILED", reason: "CONFLICT" } as const,
      archiveVerification: {
        status: "FAILED",
        reason: "ARCHIVE_VERIFICATION_FAILED",
      } as const,
      manualRecovery: {
        status: "INCONCLUSIVE",
        reason: "MANUAL_RECOVERY_REQUIRED",
      } as const,
    };
    expect(
      evaluateCutoverPreflight(progressed, plan, "2026-01-01T00:00:00.000Z"),
    ).toMatchObject({ manualRecovery: { reason: "MANUAL_RECOVERY_REQUIRED" } });
    expect(() =>
      evaluateCutoverPreflight(
        { ...progressed, manualRecovery: notStarted },
        plan,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toThrow("recovery");
    expect(() =>
      evaluateCutoverPreflight(
        {
          ...progressed,
          operations: {
            ...progressed.operations,
            archive: {
              status: "FAILED",
              reason: "ARCHIVE_VERIFICATION_FAILED",
            },
          },
          archiveVerification: notStarted,
          manualRecovery: notStarted,
        },
        plan,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toThrow("recovery");
    expect(() =>
      evaluateCutoverPreflight(
        {
          ...progressed,
          operations: {
            ...progressed.operations,
            archive: {
              status: "INCONCLUSIVE",
              reason: "MANUAL_RECOVERY_REQUIRED",
            },
          },
          archiveVerification: notStarted,
          manualRecovery: notStarted,
        },
        plan,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toThrow("recovery");
  });

  it("requires recovery after uncertain conflict and verification proofs", async () => {
    const plan = await buildMigrationPlan(process.cwd(), manifest);
    const enabled = controlled(config(plan));
    const ready = {
      ...enabled,
      gates: {
        ...enabled.gates,
        archive: passed,
        destination: passed,
        readback: passed,
      },
      operations: { ...enabled.operations, create: passed },
      manualRecovery: {
        status: "INCONCLUSIVE",
        reason: "MANUAL_RECOVERY_REQUIRED",
      } as const,
    };
    expect(
      evaluateCutoverPreflight(
        {
          ...ready,
          duplicateCreate: { status: "FAILED", reason: "TRANSPORT_UNCERTAIN" },
        },
        plan,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toMatchObject({ manualRecovery: { status: "INCONCLUSIVE" } });
    expect(() =>
      evaluateCutoverPreflight(
        {
          ...ready,
          duplicateCreate: { status: "FAILED", reason: "OUTCOME_UNKNOWN" },
          operations: { ...ready.operations, update: passed },
        },
        plan,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toThrow("transition");
    const archived = {
      ...ready,
      operations: { ...ready.operations, update: passed, archive: passed },
      duplicateCreate: { status: "FAILED", reason: "CONFLICT" } as const,
      staleUpdate: { status: "FAILED", reason: "CONFLICT" } as const,
      archiveVerification: {
        status: "FAILED",
        reason: "TRANSPORT_UNCERTAIN",
      } as const,
    };
    expect(
      evaluateCutoverPreflight(archived, plan, "2026-01-01T00:00:00.000Z"),
    ).toMatchObject({ manualRecovery: { reason: "MANUAL_RECOVERY_REQUIRED" } });
  });

  it("redacts nested raw identifiers, paths, and OAuth-looking values", () => {
    for (const input of [
      { nested: { id: "raw" } },
      { nested: { locator: "raw" } },
      { nested: { value: "/private/data" } },
      { nested: { value: "ya29.unsafe-token" } },
    ])
      expect(() => assertNoSensitiveEvidence(input)).toThrow("redaction");
  });
});

describe("planning cutover evidence publication", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function directory(): Promise<string> {
    const path = await mkdtemp(join(await realpath(tmpdir()), "w27-cutover-"));
    directories.push(path);
    return path;
  }

  async function evidence() {
    const plan = await buildMigrationPlan(process.cwd(), manifest);
    return evaluateCutoverPreflight(
      config(plan),
      plan,
      "2026-01-01T00:00:00.000Z",
    );
  }

  async function parent(path: string) {
    const facts = await lstat(path, { bigint: true });
    return { path, dev: facts.dev, ino: facts.ino };
  }

  it("uses one owner-only, no-overwrite output and rejects arbitrary data", async () => {
    const outputDirectory = await directory();
    const output = join(outputDirectory, "evidence.json");
    const valid = await evidence();
    await writeCutoverEvidenceExclusively(
      output,
      valid,
      await parent(outputDirectory),
    );
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(await readdir(outputDirectory)).toEqual(["evidence.json"]);
    await expect(
      writeCutoverEvidenceExclusively(
        output,
        valid,
        await parent(outputDirectory),
      ),
    ).rejects.toThrow();
    await expect(
      writeCutoverEvidenceExclusively(
        join(outputDirectory, "unknown.json"),
        { ...valid, id: "raw" },
        await parent(outputDirectory),
      ),
    ).rejects.toThrow();
    await expect(
      writeCutoverEvidenceExclusively(
        join(outputDirectory, "path.json"),
        { ...valid, releaseIdentifier: "ref/unsafe" },
        await parent(outputDirectory),
      ),
    ).rejects.toThrow();
    await expect(
      writeCutoverEvidenceExclusively(
        join(outputDirectory, "token.json"),
        { ...valid, clientProfileIdentifier: "ya29.unsafe-token" },
        await parent(outputDirectory),
      ),
    ).rejects.toThrow();
  });

  it("does not publish through a parent swap before linking", async () => {
    const original = await directory();
    const replacement = await directory();
    const moved = join(await directory(), "moved");
    const output = join(original, "evidence.json");
    await expect(
      writeCutoverEvidenceExclusively(
        output,
        await evidence(),
        await parent(original),
        {
          beforeLink: async () => {
            await rename(original, moved);
            await rename(replacement, original);
          },
        },
      ),
    ).rejects.toThrow();
    await expect(
      readFile(join(original, "evidence.json"), "utf8"),
    ).rejects.toThrow();
    await expect(
      readFile(join(moved, "evidence.json"), "utf8"),
    ).rejects.toThrow();
    const stranded = await readdir(moved);
    expect(stranded).toHaveLength(1);
    expect((await stat(join(moved, stranded[0] as string))).size).toBe(0);
  });

  it("removes only its own linked final after a post-link replacement", async () => {
    const outputDirectory = await directory();
    const output = join(outputDirectory, "evidence.json");
    await expect(
      writeCutoverEvidenceExclusively(
        output,
        await evidence(),
        await parent(outputDirectory),
        {
          afterLink: async () => {
            await unlink(output);
            await writeFile(output, "attacker", "utf8");
          },
        },
      ),
    ).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe("attacker");
    expect(await readdir(outputDirectory)).toEqual(["evidence.json"]);
  });
});

describe("planning cutover CLI boundaries", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it("rejects repository-local, symlinked, and existing external paths", async () => {
    const directory = await mkdtemp(
      join(await realpath(tmpdir()), "w27-cutover-"),
    );
    directories.push(directory);
    const plan = await buildMigrationPlan(
      process.cwd(),
      JSON.parse(
        await readFile("config/planning-file-migration.manifest.json", "utf8"),
      ),
    );
    const externalConfig = join(directory, "config.json");
    const output = join(directory, "evidence.json");
    await writeFile(externalConfig, JSON.stringify(config(plan)), "utf8");
    const command = [
      "run",
      "--manifest",
      "config/planning-file-migration.manifest.json",
      "--config",
      externalConfig,
      "--output",
      output,
      "--confirm",
      "W27_PLANNING_CUTOVER_PREFLIGHT_ONLY",
    ];
    expect(await cutoverMain(command)).toBe(11);
    expect(await cutoverMain(command)).toBe(2);
    const linked = join(directory, "linked.json");
    await symlink(externalConfig, linked);
    expect(
      await cutoverMain([...command.slice(0, 4), linked, ...command.slice(5)]),
    ).toBe(2);
    const nestedTarget = join(directory, "nested-target");
    await mkdir(nestedTarget);
    const nestedConfig = join(nestedTarget, "config.json");
    await writeFile(nestedConfig, JSON.stringify(config(plan)), "utf8");
    const nestedLink = join(directory, "nested-link");
    await symlink(nestedTarget, nestedLink);
    expect(
      await cutoverMain([
        ...command.slice(0, 4),
        join(nestedLink, "config.json"),
        ...command.slice(5),
      ]),
    ).toBe(2);
    expect(
      await cutoverMain([
        ...command.slice(0, 6),
        join(nestedLink, "evidence.json"),
        ...command.slice(7),
      ]),
    ).toBe(2);
    expect(
      await cutoverMain([
        ...command.slice(0, 6),
        join(process.cwd(), "evidence.json"),
        ...command.slice(7),
      ]),
    ).toBe(2);
  });

  it("keeps preflight modules free of transport and mutation imports", async () => {
    for (const path of [
      "src/planning-migration/cutover-evidence.ts",
      "src/planning-migration/cutover-preflight-cli.ts",
    ]) {
      const source = await readFile(path, "utf8");
      expect(source).not.toMatch(
        /(?:\bfetch\b|\bchild_process\b|from\s+["'][^"']*(?:mcp|drive|md-drive|write-gate)[^"']*["'])/iu,
      );
    }
  });
});
