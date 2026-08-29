import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { main } from "../../src/codex-cli/cli.js";

const bearer = Buffer.alloc(16, 7).toString("base64url");

function run(
  args: string[],
  fetcher: typeof fetch,
  environment: NodeJS.ProcessEnv = {},
) {
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
        ...environment,
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
  it("keeps the executable shebang and post-build permission verifier", async () => {
    const source = await readFile(
      new URL("../../src/codex-cli/cli.ts", import.meta.url),
      "utf8",
    );
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { build?: string; scripts?: { build?: string } };
    expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(packageJson.scripts?.build).toContain("mark-cli-executable.mjs");
  });
  it("ships a Node shebang for the package bin", async () => {
    const [source, manifest] = await Promise.all([
      readFile(new URL("../../src/codex-cli/cli.ts", import.meta.url), "utf8"),
      readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ]);
    expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(JSON.parse(manifest)).toMatchObject({
      bin: { "md-drive": "dist/codex-cli/cli.js" },
    });
  });

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

  it("accepts only one valid mounted credential source without leaking its path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "md-drive-secret-"));
    const secret = join(directory, "bearer");
    const link = join(directory, "link");
    await writeFile(secret, `${bearer}\n`, "utf8");
    await symlink(secret, link);
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          ok: true,
          operationId: "operation",
          data: { items: [] },
        }),
        { status: 200 },
      );
    };
    try {
      const valid = run(["list"], fetcher, {
        MD_DRIVE_BEARER_TOKEN: undefined,
        MD_DRIVE_BEARER_SECRET_FILE: secret,
      });
      await expect(valid.code).resolves.toBe(0);
      for (const environment of [
        {
          MD_DRIVE_BEARER_TOKEN: undefined,
          MD_DRIVE_BEARER_SECRET_FILE: undefined,
        },
        { MD_DRIVE_BEARER_SECRET_FILE: secret },
        { MD_DRIVE_BEARER_TOKEN: "not-a-token" },
        { MD_DRIVE_BEARER_TOKEN: undefined, MD_DRIVE_BEARER_SECRET_FILE: link },
        {
          MD_DRIVE_BEARER_TOKEN: undefined,
          MD_DRIVE_BEARER_SECRET_FILE: directory,
        },
      ]) {
        const result = run(["list"], fetcher, environment);
        await expect(result.code).resolves.toBe(3);
        expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(calls).toBe(1);
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

  it("rejects unsafe, oversized, and invalid UTF-8 content files before dispatch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "md-drive-content-"));
    const valid = join(directory, "valid.md");
    const invalid = join(directory, "invalid.md");
    const large = join(directory, "large.md");
    const link = join(directory, "link.md");
    await writeFile(valid, "content", "utf8");
    await writeFile(invalid, new Uint8Array([0xc3, 0x28]));
    await writeFile(large, Buffer.alloc(1_048_577));
    await symlink(valid, link);
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      throw new Error("must not dispatch unsafe content");
    };
    try {
      for (const file of [invalid, large, link, directory]) {
        const result = run(["create", "file.md", "--file", file], fetcher);
        await expect(result.code).resolves.toBe(2);
        expect(`${result.stdout}${result.stderr}`).not.toContain(file);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(calls).toBe(0);
  });

  it("classifies timeout, network, redirects, oversized streams, and non-JSON without retrying", async () => {
    const directory = await mkdtemp(join(tmpdir(), "md-drive-transport-"));
    const file = join(directory, "content.md");
    await writeFile(file, "content", "utf8");
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6_295_553));
        controller.close();
      },
    });
    try {
      const cases: ReadonlyArray<readonly [number, () => Promise<Response>]> = [
        [4, () => Promise.reject(new Error("network"))],
        [
          5,
          () =>
            Promise.resolve(
              new Response("", {
                status: 302,
                headers: { location: "https://elsewhere.invalid" },
              }),
            ),
        ],
        [5, () => Promise.resolve(new Response(oversized))],
        [
          5,
          () =>
            Promise.resolve(
              new Response("<html>unsafe</html>", { status: 200 }),
            ),
        ],
      ];
      for (const [expected, response] of cases) {
        let calls = 0;
        const result = run(["create", "file.md", "--file", file], async () => {
          calls += 1;
          return response();
        });
        await expect(result.code).resolves.toBe(expected);
        expect(calls).toBe(1);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("times out one write request without retrying", async () => {
    const directory = await mkdtemp(join(tmpdir(), "md-drive-timeout-"));
    const file = join(directory, "content.md");
    await writeFile(file, "content", "utf8");
    let calls = 0;
    try {
      const result = run(
        ["--timeout-ms", "100", "create", "file.md", "--file", file],
        async (_input, init) => {
          calls += 1;
          return new Promise<Response>((_resolve, reject) => {
            (init?.signal as AbortSignal | null)?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
            );
          });
        },
      );
      await expect(result.code).resolves.toBe(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(calls).toBe(1);
  });

  it("does not retry conflicts for each write command", async () => {
    const directory = await mkdtemp(join(tmpdir(), "md-drive-conflict-"));
    const file = join(directory, "content.md");
    await writeFile(file, "content", "utf8");
    try {
      for (const args of [
        ["create", "file.md", "--file", file],
        [
          "update",
          "--path",
          "file.md",
          "--revision",
          "revision",
          "--file",
          file,
        ],
        ["archive", "--file-id", "file", "--revision", "revision"],
      ]) {
        let calls = 0;
        const result = run(args, async () => {
          calls += 1;
          return new Response(
            JSON.stringify({
              ok: false,
              operationId: "operation",
              error: {
                code: "CONFLICT",
                message: "Markdown revision conflict.",
              },
            }),
            { status: 409 },
          );
        });
        await expect(result.code).resolves.toBe(8);
        expect(calls).toBe(1);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

  it("uses the create caller path as conflict recovery locator", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "md-drive-create-conflict-"),
    );
    const file = join(directory, "content.md");
    await writeFile(file, "content", "utf8");
    try {
      const result = run(
        ["create", "docs/new.md", "--file", file],
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              operationId: "operation",
              error: {
                code: "CONFLICT",
                message: "Markdown revision conflict.",
              },
            }),
            { status: 409 },
          ),
      );
      await expect(result.code).resolves.toBe(8);
      expect(JSON.parse(result.stdout[0])).toMatchObject({
        recovery: { action: "read", locator: { path: "docs/new.md" } },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("caps list output at 100 metadata records", async () => {
    const item = {
      relativePath: "file.md",
      fileId: "file",
      revision: "revision",
      modifiedTime: "2026-01-01T00:00:00.000Z",
      size: 0,
    };
    for (const count of [100, 101]) {
      const result = run(
        ["list"],
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              operationId: "operation",
              data: { items: Array.from({ length: count }, () => item) },
            }),
            { status: 200 },
          ),
      );
      await expect(result.code).resolves.toBe(count === 100 ? 0 : 5);
    }
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
