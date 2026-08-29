import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { main } from "../../src/planning-migration/cli.js";
import {
  buildMigrationPlan,
  parseManifestForPlan,
} from "../../src/planning-migration/plan.js";
import { readBoundedRepositoryFile } from "../../src/planning-migration/repository.js";

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

describe("planning migration plan", () => {
  it("creates a deterministic, content-free verified plan", async () => {
    const root = process.cwd();
    const first = await buildMigrationPlan(root, manifest);
    const second = await buildMigrationPlan(root, manifest);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      topology: "bounded-nested-v1",
      entryCount: 1,
      entries: [
        {
          targetPath: "briefs/google-drive-markdown-gateway-handoff.md",
          digestState: "verified",
        },
      ],
    });
    expect(JSON.stringify(first)).not.toContain(
      "Google Drive Markdown Gateway",
    );
  });

  it.each([
    { targetPath: "brief--handoff.md" },
    { targetPath: "briefs/../handoff.md" },
    { targetPath: "briefs/extra/handoff.md" },
    { targetPath: "briefs/STRASSE.md" },
    { targetPath: "briefs/straße.md" },
    { targetPath: "drafts/handoff.md" },
    { sourcePath: "src/domain/markdown.ts" },
    { sourcePath: "DOCS/handbook.md" },
    { sourcePath: "package.json" },
    { sourcePath: "/tmp/source.md" },
    { sourcePath: "C:\\source.md" },
    { sourcePath: "../google-drive-markdown-gateway-handoff.md" },
    { sourceSha256: "0".repeat(64) },
  ])("rejects unsafe or stale manifest state: %o", async (override) => {
    const candidate = {
      ...manifest,
      entries: [{ ...manifest.entries[0], ...override }],
    };
    if ("sourceSha256" in override)
      await expect(
        buildMigrationPlan(process.cwd(), candidate),
      ).rejects.toThrow();
    else expect(() => parseManifestForPlan(candidate)).toThrow();
  });

  it("rejects duplicate keys, duplicate case targets, and unknown fields", () => {
    const duplicateKey = {
      ...manifest,
      entries: [manifest.entries[0], { ...manifest.entries[0] }],
    };
    const duplicateCaseTargets = {
      ...manifest,
      entries: [
        { ...manifest.entries[0], key: "first", targetPath: "briefs/foo.md" },
        {
          ...manifest.entries[0],
          key: "second",
          targetPath: "briefs/FOO.md",
        },
      ],
    };
    expect(() => parseManifestForPlan(duplicateKey)).toThrow();
    expect(() => parseManifestForPlan(duplicateCaseTargets)).toThrow();
    expect(() =>
      parseManifestForPlan({ ...manifest, unexpected: "rejected" }),
    ).toThrow();
    expect(() =>
      parseManifestForPlan({
        ...manifest,
        entries: [{ ...manifest.entries[0], unexpected: "rejected" }],
      }),
    ).toThrow();
  });

  it("accepts the exact 1024-byte ASCII target boundary and rejects overflow", () => {
    const target = `briefs/${"a".repeat(1_014)}.md`;
    expect(Buffer.byteLength(target, "utf8")).toBe(1_024);
    expect(() =>
      parseManifestForPlan({
        ...manifest,
        entries: [{ ...manifest.entries[0], targetPath: target }],
      }),
    ).not.toThrow();
    expect(() =>
      parseManifestForPlan({
        ...manifest,
        entries: [
          {
            ...manifest.entries[0],
            targetPath: `briefs/${"a".repeat(1_015)}.md`,
          },
        ],
      }),
    ).toThrow();
  });

  it("allows a bounded nested Git source outside protected roots", () => {
    expect(
      parseManifestForPlan({
        ...manifest,
        entries: [
          {
            ...manifest.entries[0],
            sourcePath: "planning/bootstrap/handoff.md",
          },
        ],
      }),
    ).toMatchObject({
      entries: [{ sourcePath: "planning/bootstrap/handoff.md" }],
    });
  });

  it("keeps the policy and checked-in manifest aligned", async () => {
    const [policy, checkedIn] = await Promise.all([
      readFile(
        new URL("../../docs/planning-file-source-of-truth.md", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../../config/planning-file-migration.manifest.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
    expect(policy).toContain("never trash or permanent deletion");
    expect(policy).toContain("never retry, overwrite, delete, trash");
    expect(checkedIn).toContain(manifest.entries[0].sourceSha256);
    expect(checkedIn).toContain(manifest.entries[0].targetPath);
  });

  it("rejects nonregular, symlinked, oversized, and repository-escaping files", async () => {
    const root = await mkdtemp(join(tmpdir(), "migration-plan-"));
    const source = join(root, "source.md");
    const link = join(root, "link.md");
    const folder = join(root, "folder");
    const linkedFolder = join(root, "linked-folder");
    try {
      await writeFile(source, "safe", "utf8");
      await symlink(source, link);
      await mkdir(folder);
      await symlink(folder, linkedFolder);
      await expect(
        readBoundedRepositoryFile(root, source, 3),
      ).rejects.toThrow();
      await expect(readBoundedRepositoryFile(root, link, 10)).rejects.toThrow();
      await expect(
        readBoundedRepositoryFile(root, folder, 10),
      ).rejects.toThrow();
      await expect(
        readBoundedRepositoryFile(root, join(root, "..", "outside.md"), 10),
      ).rejects.toThrow();
      await expect(
        readBoundedRepositoryFile(root, join(linkedFolder, "source.md"), 10),
      ).rejects.toThrow();
      await expect(
        readBoundedRepositoryFile(root, source, 0),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an in-place same-size mutation after descriptor read", async () => {
    const root = await mkdtemp(join(tmpdir(), "migration-race-"));
    const source = join(root, "source.md");
    try {
      await writeFile(source, "first", "utf8");
      await expect(
        readBoundedRepositoryFile(root, source, 10, {
          afterRead: async () => writeFile(source, "other", "utf8"),
        }),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses exact CLI grammar and fixed redacted diagnostics", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const originalStdout = process.stdout.write;
    const originalStderr = process.stderr.write;
    process.stdout.write = ((value: string) => {
      stdout.push(value);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((value: string) => {
      stderr.push(value);
      return true;
    }) as typeof process.stderr.write;
    try {
      await expect(
        main(["--manifest", "config/planning-file-migration.manifest.json"]),
      ).resolves.toBe(0);
      await expect(main(["--manifest", "../unsafe.json"])).resolves.toBe(2);
      expect(stdout.join("")).toContain('"entryCount":1');
      expect(stderr).toEqual([
        "migration plan: invalid local manifest or source state\n",
      ]);
      expect(`${stdout}${stderr}`).not.toContain(
        "Google Drive Markdown Gateway",
      );
    } finally {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    }
  });

  it("keeps planning migration isolated from clients and mutation boundaries", async () => {
    const files = await Promise.all(
      ["cli.ts", "manifest.ts", "plan.ts", "repository.ts"].map((name) =>
        readFile(
          new URL(`../../src/planning-migration/${name}`, import.meta.url),
          "utf8",
        ),
      ),
    );
    expect(files.join("\n")).not.toMatch(
      /(?:\.\.\/drive\/|\.\.\/http\/|\.\.\/mcp\/|\.\.\/auth\/|\.\.\/write-gate\/|node:child_process)/u,
    );
  });
});
