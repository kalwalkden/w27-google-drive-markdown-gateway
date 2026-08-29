import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const asset = (name: string) =>
  readFile(
    new URL(`../../plugin/chatgpt-work/${name}`, import.meta.url),
    "utf8",
  );

const tools = [
  "list_markdown",
  "search_markdown",
  "read_markdown",
  "create_markdown",
  "update_markdown",
  "archive_markdown",
];

describe("ChatGPT Work private package", () => {
  it("is an explicit tenant-profile input template with only the six MCP tools", async () => {
    const template = JSON.parse(await asset("private-package.template.json"));
    expect(template).toMatchObject({
      templateKind: "operator-input-record-not-a-work-manifest",
      platformProfile: { status: "operator-must-verify-current-tenant-format" },
      mcp: { httpsOriginPlaceholder: "https://example-mcp-origin.invalid" },
    });
    expect(template.mcp.requiredToolNames).toEqual(tools);
    expect(template.safety).toMatchObject({
      tenantValuesRemainOutsideGit: true,
      endpointMustUseHttpsWithoutCredentialsQueryOrFragment: true,
      packageDoesNotGrantWriteAuthority: true,
    });
    expect(template.mcp.httpsOriginPlaceholder).not.toMatch(/[?#@]/u);
  });

  it("contains read-before-write, stale-conflict, archive-confirmation, and fail-closed guidance", async () => {
    const [instructions, checklist, readme] = await Promise.all([
      asset("instructions.md"),
      asset("live-validation-checklist.md"),
      asset("README.md"),
    ]);
    for (const tool of tools)
      expect(instructions + checklist + readme).toContain(tool);
    expect(instructions).toMatch(/Read before a mutation/u);
    expect(instructions).toMatch(/retain the opaque `revision`/u);
    expect(instructions).toMatch(/On `CONFLICT`, stop, reread/u);
    expect(instructions).toMatch(/Never silently retry or overwrite/u);
    expect(instructions).toMatch(
      /Before\s+`archive_markdown`, request explicit user confirmation/u,
    );
    expect(readme).toMatch(
      /never issue a\s+write lease or bypass the write gate/u,
    );
    expect(checklist).toMatch(/Never delete, trash, share/u);
  });

  it("keeps the evidence template sanitized and non-authoritative", async () => {
    const evidence = JSON.parse(await asset("release-evidence.template.json"));
    expect(evidence).toMatchObject({
      writeApprovalBehavior: "not-run",
      cleanupStatus: "incomplete",
      writeGateDecisionInput: false,
    });
    expect(Object.keys(evidence.operationOutcomes)).toEqual([
      "list_markdown",
      "search_markdown",
      "read_markdown",
      "create_markdown",
      "update_markdown",
      "staleUpdateConflict",
      "archive_markdown",
    ]);
    const committed = await Promise.all([
      asset("private-package.template.json"),
      asset("README.md"),
      asset("instructions.md"),
      asset("live-validation-checklist.md"),
      asset("release-evidence.template.json"),
    ]);
    expect(committed.join("\n")).not.toMatch(
      /Bearer [A-Za-z0-9._-]{16,}|refresh_token[=:][^\s]+|client_secret[=:][^\s]+|BEGIN (?:RSA |EC )?PRIVATE KEY|cookie=[^\s]+/iu,
    );
  });
});
