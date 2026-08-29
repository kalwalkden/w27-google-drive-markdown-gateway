import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { main } from "../../src/codex-cli/cli.js";

const bearer = Buffer.alloc(16, 7).toString("base64url");

function run(args: string[], fetcher: typeof fetch) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    code: main(
      args,
      {
        MD_DRIVE_GATEWAY_URL: "http://loopback.invalid",
        MD_DRIVE_BEARER_TOKEN: bearer,
      },
      {
        fetch: fetcher,
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
        allowInsecureEndpoint: true,
      },
    ),
  };
}

describe("md-drive", () => {
  it("maps every read command to one authenticated request and emits a stable success record", async () => {
    const calls: Request[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      const pathname = new URL(request.url).pathname;
      const data = pathname.endsWith("/read")
        ? {
            relativePath: "read.md",
            fileId: "file",
            revision: "revision",
            modifiedTime: "2026-01-01T00:00:00.000Z",
            size: 0,
            content: "",
          }
        : { items: [] };
      return new Response(
        JSON.stringify({ ok: true, operationId: "operation", data }),
        { status: 200 },
      );
    };
    for (const [args, path] of [
      [
        ["list", "--path", "folder", "--recursive"],
        "/v1/markdown/list?path=folder&recursive=true",
      ],
      [
        ["search", "term", "--limit", "2"],
        "/v1/markdown/search?query=term&limit=2",
      ],
      [["read", "--file-id", "opaque"], "/v1/markdown/read?fileId=opaque"],
    ] as const) {
      const result = run([...args], fetcher);
      await expect(result.code).resolves.toBe(0);
      expect(JSON.parse(result.stdout[0])).toMatchObject({
        ok: true,
        status: 200,
      });
      expect(result.stderr).toEqual([]);
      const observed = new URL(calls.at(-1)?.url ?? "");
      expect(`${observed.pathname}${observed.search}`).toBe(path);
      expect(calls.at(-1)?.headers.has("authorization")).toBe(true);
    }
    expect(calls).toHaveLength(3);
  });

  it("does not perform I/O for usage or credential failures and keeps failure output redacted", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      throw new Error("must not run");
    };
    const result = run(["update", "--path", "x.md"], fetcher);
    await expect(result.code).resolves.toBe(2);
    expect(result.stdout[0]).toContain('"USAGE"');
    expect(result.stderr).toEqual(["md-drive: USAGE\n"]);
    expect(calls).toBe(0);
  });

  it.each([
    ["create", "new.md", "--file", "-"],
    ["read", "--path", "a.md", "--file-id", "opaque"],
    ["search", "term", "--limit", "101"],
    ["list", "--unknown"],
  ])("rejects closed CLI grammar before a request: %j", async (...args) => {
    let calls = 0;
    const result = run(args, async () => {
      calls += 1;
      throw new Error("unexpected");
    });
    await expect(result.code).resolves.toBe(2);
    expect(calls).toBe(0);
  });

  it("rejects unrecognized, mismatched, and extra gateway fields as protocol failures", async () => {
    for (const body of [
      { ok: true, operationId: "operation", data: { items: [] }, extra: true },
      { ok: true, operationId: "operation", data: {} },
      {
        ok: false,
        operationId: "operation",
        error: { code: "CONFLICT", message: "unsafe" },
      },
      {
        ok: false,
        operationId: "operation",
        error: { code: "CONFLICT", message: "Markdown revision conflict." },
      },
    ]) {
      const result = run(
        ["list"],
        async () =>
          new Response(JSON.stringify(body), { status: body.ok ? 200 : 400 }),
      );
      await expect(result.code).resolves.toBe(5);
      expect(result.stderr).toEqual(["md-drive: PROTOCOL\n"]);
    }
  });

  it("classifies a conflict once and supplies only the caller locator for recovery", async () => {
    let calls = 0;
    const result = run(["read", "--path", "docs/example.md"], async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          ok: false,
          operationId: "operation",
          error: { code: "CONFLICT", message: "Markdown revision conflict." },
        }),
        { status: 409 },
      );
    });
    await expect(result.code).resolves.toBe(8);
    expect(JSON.parse(result.stdout[0])).toMatchObject({
      recovery: { action: "read", locator: { path: "docs/example.md" } },
    });
    expect(calls).toBe(1);
  });

  it("maps create, update, and archive exactly once with their JSON request bodies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "md-drive-cli-"));
    const file = join(directory, "content.md");
    await writeFile(file, "content", "utf8");
    const bodies: unknown[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      bodies.push(request.method === "POST" ? await request.json() : undefined);
      const created = new URL(request.url).pathname.endsWith("/create");
      return new Response(
        JSON.stringify({
          ok: true,
          operationId: "operation",
          data: {
            relativePath: "file.md",
            fileId: "file",
            revision: "revision",
            modifiedTime: "2026-01-01T00:00:00.000Z",
            size: 7,
          },
        }),
        { status: created ? 201 : 200 },
      );
    };
    try {
      await expect(
        run(["create", "file.md", "--file", file], fetcher).code,
      ).resolves.toBe(0);
      await expect(
        run(
          [
            "update",
            "--path",
            "file.md",
            "--revision",
            "revision",
            "--file",
            file,
          ],
          fetcher,
        ).code,
      ).resolves.toBe(0);
      await expect(
        run(["archive", "--file-id", "file", "--revision", "revision"], fetcher)
          .code,
      ).resolves.toBe(0);
      expect(bodies).toEqual([
        { path: "file.md", content: "content" },
        { path: "file.md", expectedRevision: "revision", content: "content" },
        { fileId: "file", expectedRevision: "revision" },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
