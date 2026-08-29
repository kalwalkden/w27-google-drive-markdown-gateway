#!/usr/bin/env node
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const maxContentBytes = 1_048_576;
const maxResponseBytes = 6_295_552;
const secretBytes = 1_024;
const usage = `Usage: md-drive [--timeout-ms 100..30000] <list|search|read|create|update|archive> [options]\n\nEnvironment: MD_DRIVE_GATEWAY_URL and exactly one of MD_DRIVE_BEARER_TOKEN or MD_DRIVE_BEARER_SECRET_FILE\n`;

type Locator = { readonly path: string } | { readonly fileId: string };
type Command =
  | { readonly kind: "list"; readonly path?: string; readonly recursive?: true }
  | {
      readonly kind: "search";
      readonly query: string;
      readonly path?: string;
      readonly limit?: number;
    }
  | { readonly kind: "read"; readonly locator: Locator }
  | { readonly kind: "create"; readonly path: string; readonly file: string }
  | {
      readonly kind: "update";
      readonly locator: Locator;
      readonly revision: string;
      readonly file: string;
    }
  | {
      readonly kind: "archive";
      readonly locator: Locator;
      readonly revision: string;
    };

type CliFailure = "USAGE" | "CREDENTIAL" | "TRANSPORT" | "PROTOCOL";
type Output =
  | {
      readonly ok: true;
      readonly operation: string;
      readonly status: number;
      readonly operationId: string;
      readonly data: unknown;
    }
  | {
      readonly ok: false;
      readonly operation?: string;
      readonly status?: number;
      readonly operationId?: string;
      readonly error: { readonly code: string; readonly message: string };
      readonly recovery?: {
        readonly action: "read";
        readonly locator: Locator;
      };
    };

export interface CliDependencies {
  readonly fetch?: typeof fetch;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  /** Test-only seam. Production parsing accepts HTTPS origins only. */
  readonly allowInsecureEndpoint?: boolean;
}

const fail = (code: CliFailure): never => {
  throw new Error(code);
};
const byteLength = (value: string) => Buffer.byteLength(value, "utf8");
const bounded = (value: string, minimum: number, maximum: number): string => {
  if (byteLength(value) < minimum || byteLength(value) > maximum) fail("USAGE");
  return value;
};
const nonblank = (value: string) =>
  value.trim().length === 0 ? fail("USAGE") : value;
const opaque = (value: string, maximum: number) => bounded(value, 1, maximum);
const wellFormed = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
};
const safeText = (
  value: unknown,
  minimum: number,
  maximum: number,
): value is string =>
  typeof value === "string" &&
  wellFormed(value) &&
  byteLength(value) >= minimum &&
  byteLength(value) <= maximum;

function parse(
  args: readonly string[],
):
  | { readonly command: Command; readonly timeout: number }
  | "help"
  | "version" {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "help"))
    return "help";
  if (args.length === 1 && args[0] === "--version") return "version";
  let index = 0;
  let timeout = 30_000;
  if (args[index] === "--timeout-ms") {
    const value = args[index + 1];
    if (!value || !/^[1-9][0-9]*$/u.test(value)) fail("USAGE");
    timeout = Number(value);
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 30_000)
      fail("USAGE");
    index += 2;
  }
  const name = args[index++];
  if (!name) fail("USAGE");
  const rest = args.slice(index);
  const values = new Map<string, string | true>();
  const positional: string[] = [];
  for (let cursor = 0; cursor < rest.length; cursor += 1) {
    const token = rest[cursor];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    if (token === "--recursive") {
      if (values.has(token)) fail("USAGE");
      values.set(token, true);
      continue;
    }
    if (
      !["--path", "--file-id", "--limit", "--file", "--revision"].includes(
        token,
      ) ||
      values.has(token)
    )
      fail("USAGE");
    const value = rest[++cursor];
    if (!value || value.startsWith("--")) fail("USAGE");
    values.set(token, value);
  }
  const only = (...allowed: string[]) => {
    for (const key of values.keys()) if (!allowed.includes(key)) fail("USAGE");
  };
  const locator = (): Locator => {
    const path = values.get("--path");
    const fileId = values.get("--file-id");
    if (typeof path === "string" && fileId === undefined)
      return { path: bounded(path, 1, 1024) };
    if (typeof fileId === "string" && path === undefined)
      return { fileId: opaque(fileId, 512) };
    return fail("USAGE");
  };
  if (name === "list") {
    only("--path", "--recursive");
    if (positional.length) fail("USAGE");
    const path = values.get("--path");
    return {
      timeout,
      command: {
        kind: "list",
        ...(typeof path === "string" ? { path: bounded(path, 1, 1024) } : {}),
        ...(values.has("--recursive") ? { recursive: true } : {}),
      },
    };
  }
  if (name === "search") {
    only("--path", "--limit");
    if (positional.length !== 1) fail("USAGE");
    const query = bounded(nonblank(positional[0]), 1, 256);
    const path = values.get("--path");
    const rawLimit = values.get("--limit");
    if (
      rawLimit !== undefined &&
      (typeof rawLimit !== "string" ||
        !/^[1-9][0-9]*$/u.test(rawLimit) ||
        Number(rawLimit) > 100)
    )
      fail("USAGE");
    return {
      timeout,
      command: {
        kind: "search",
        query,
        ...(typeof path === "string" ? { path: bounded(path, 1, 1024) } : {}),
        ...(typeof rawLimit === "string" ? { limit: Number(rawLimit) } : {}),
      },
    };
  }
  if (name === "read") {
    only("--path", "--file-id");
    if (positional.length) fail("USAGE");
    return { timeout, command: { kind: "read", locator: locator() } };
  }
  if (name === "create") {
    only("--file");
    const file = values.get("--file");
    const targetPath = positional[0];
    if (positional.length !== 1 || targetPath === undefined) fail("USAGE");
    if (typeof file !== "string" || file === "-") fail("USAGE");
    const contentFile = file as string;
    const destinationPath = targetPath as string;
    return {
      timeout,
      command: {
        kind: "create",
        path: bounded(destinationPath, 1, 1024),
        file: contentFile,
      },
    };
  }
  if (name === "update") {
    only("--path", "--file-id", "--file", "--revision");
    const file = values.get("--file");
    const revision = values.get("--revision");
    if (positional.length) fail("USAGE");
    if (typeof file !== "string" || file === "-") fail("USAGE");
    if (typeof revision !== "string") fail("USAGE");
    const contentFile = file as string;
    const expectedRevision = revision as string;
    return {
      timeout,
      command: {
        kind: "update",
        locator: locator(),
        revision: opaque(expectedRevision, 1024),
        file: contentFile,
      },
    };
  }
  if (name === "archive") {
    only("--path", "--file-id", "--revision");
    if (positional.length || typeof values.get("--revision") !== "string")
      fail("USAGE");
    return {
      timeout,
      command: {
        kind: "archive",
        locator: locator(),
        revision: opaque(values.get("--revision") as string, 1024),
      },
    };
  }
  return fail("USAGE");
}

function endpoint(value: string | undefined, allowInsecure: boolean): URL {
  if (!value) return fail("USAGE");
  const source = value;
  const url = (() => {
    try {
      return new URL(source);
    } catch {
      return fail("USAGE");
    }
  })();
  if (
    (!allowInsecure && url.protocol !== "https:") ||
    (allowInsecure && !["https:", "http:"].includes(url.protocol)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    fail("USAGE");
  url.pathname = url.pathname.replace(/\/$/u, "");
  return url;
}

function validBearer(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) fail("CREDENTIAL");
  const decoded = (() => {
    try {
      return Buffer.from(value, "base64url");
    } catch {
      return fail("CREDENTIAL");
    }
  })();
  if (
    decoded.length < 16 ||
    decoded.length > 512 ||
    decoded.toString("base64url") !== value
  )
    fail("CREDENTIAL");
  return value;
}

async function credential(environment: NodeJS.ProcessEnv): Promise<string> {
  const token = environment.MD_DRIVE_BEARER_TOKEN;
  const path = environment.MD_DRIVE_BEARER_SECRET_FILE;
  if ((token === undefined) === (path === undefined)) fail("CREDENTIAL");
  if (token !== undefined) return validBearer(token);
  if (!path || !isAbsolute(path)) return fail("CREDENTIAL");
  try {
    return validBearer(
      new TextDecoder("utf-8", { fatal: true })
        .decode(await readOpenedFile(path, secretBytes))
        .replace(/(?:\r\n|\n)$/u, ""),
    );
  } catch {
    return fail("CREDENTIAL");
  }
}

async function content(path: string): Promise<string> {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await readOpenedFile(path, maxContentBytes),
    );
  } catch {
    return fail("USAGE");
  }
}

/** Opens once with no-follow semantics, then verifies and bounds that descriptor. */
async function readOpenedFile(
  path: string,
  limit: number,
): Promise<Uint8Array> {
  const noFollow = constants.O_NOFOLLOW;
  if (typeof noFollow !== "number" || noFollow === 0)
    throw new Error("no-follow-unavailable");
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error("unsafe-file");
    const bytes = Buffer.allocUnsafe(info.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) throw new Error("unexpected-truncation");
      offset += bytesRead;
    }
    const extra = Buffer.allocUnsafe(1);
    if ((await handle.read(extra, 0, 1, bytes.byteLength)).bytesRead !== 0)
      throw new Error("file-grew");
    return bytes;
  } finally {
    await handle.close();
  }
}

function request(
  command: Command,
  base: URL,
  markdown?: string,
): {
  readonly url: URL;
  readonly init: RequestInit;
  readonly operation: string;
} {
  const path = (suffix: string) =>
    new URL(
      `${base.pathname}/v1/markdown/${suffix}`.replace(/^\/\//u, "/"),
      base,
    );
  if (command.kind === "list") {
    const url = path("list");
    if (command.path) url.searchParams.set("path", command.path);
    if (command.recursive) url.searchParams.set("recursive", "true");
    return { url, init: { method: "GET" }, operation: "list_markdown" };
  }
  if (command.kind === "search") {
    const url = path("search");
    url.searchParams.set("query", command.query);
    if (command.path) url.searchParams.set("path", command.path);
    if (command.limit) url.searchParams.set("limit", String(command.limit));
    return { url, init: { method: "GET" }, operation: "search_markdown" };
  }
  if (command.kind === "read") {
    const url = path("read");
    for (const [key, value] of Object.entries(command.locator))
      url.searchParams.set(key, value);
    return { url, init: { method: "GET" }, operation: "read_markdown" };
  }
  const suffix = command.kind;
  const body =
    command.kind === "create"
      ? { path: command.path, content: markdown }
      : command.kind === "update"
        ? {
            ...command.locator,
            expectedRevision: command.revision,
            content: markdown,
          }
        : { ...command.locator, expectedRevision: command.revision };
  return {
    url: path(suffix),
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    operation: `${command.kind}_markdown`,
  };
}

async function responseJson(response: Response): Promise<unknown> {
  const body = response.body;
  if (!body) return fail("PROTOCOL");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxResponseBytes) {
        await reader.cancel();
        fail("PROTOCOL");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      ["USAGE", "CREDENTIAL", "TRANSPORT", "PROTOCOL"].includes(error.message)
    )
      throw error;
    fail("TRANSPORT");
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    fail("PROTOCOL");
  }
}

const errorPairs = new Map<string, readonly [number, string]>([
  ["UNAUTHENTICATED", [401, "Authentication failed."]],
  ["UNSUPPORTED_MEDIA_TYPE", [415, "Request must use application/json."]],
  ["INVALID_REQUEST", [400, "Request validation failed."]],
  ["INVALID_PATH", [400, "Path is invalid."]],
  ["NOT_MARKDOWN", [400, "Only Markdown files are supported."]],
  ["INVALID_CONTENT", [400, "Markdown content is invalid."]],
  ["INVALID_ARCHIVE", [400, "Archive operation is invalid."]],
  ["FILE_TOO_LARGE", [413, "Markdown content exceeds the configured limit."]],
  [
    "RESULT_LIMIT_EXCEEDED",
    [413, "Result exceeds the configured response limit."],
  ],
  ["NOT_FOUND", [404, "Markdown file was not found."]],
  ["AMBIGUOUS_PATH", [409, "Markdown path is ambiguous."]],
  ["CONFLICT", [409, "Markdown revision conflict."]],
  ["UNSUPPORTED", [503, "Operation is unavailable."]],
  ["RATE_LIMITED", [429, "Request rate limit exceeded."]],
  ["REQUEST_TIMEOUT", [504, "Request timed out."]],
  ["UPSTREAM_UNAVAILABLE", [503, "Service dependency is unavailable."]],
  ["INTERNAL", [500, "Internal server error."]],
]);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const metadata = (
  value: unknown,
  excerpt = false,
): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys =
    excerpt && record.excerpt !== undefined
      ? [
          "relativePath",
          "fileId",
          "revision",
          "modifiedTime",
          "size",
          "excerpt",
        ]
      : ["relativePath", "fileId", "revision", "modifiedTime", "size"];
  return (
    exactKeys(record, keys) &&
    safeText(record.relativePath, 1, 1024) &&
    safeText(record.fileId, 1, 512) &&
    safeText(record.revision, 1, 1024) &&
    safeText(record.modifiedTime, 1, 128) &&
    Number.isSafeInteger(record.size) &&
    (record.size as number) >= 0 &&
    (record.size as number) <= 10_000_000 &&
    (record.excerpt === undefined ||
      (excerpt && safeText(record.excerpt, 0, 4_096)))
  );
};
function successData(operation: string, data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  if (operation === "list_markdown")
    return (
      exactKeys(record, ["items"]) &&
      Array.isArray(record.items) &&
      record.items.length <= 1_000 &&
      record.items.every((item) => metadata(item))
    );
  if (operation === "search_markdown")
    return (
      exactKeys(record, ["items"]) &&
      Array.isArray(record.items) &&
      record.items.length <= 100 &&
      record.items.every((item) => metadata(item, true))
    );
  if (operation === "read_markdown") {
    const { content, ...document } = record;
    return (
      exactKeys(record, [
        "relativePath",
        "fileId",
        "revision",
        "modifiedTime",
        "size",
        "content",
      ]) &&
      metadata(document) &&
      safeText(content, 0, maxResponseBytes)
    );
  }
  return metadata(record);
}
function output(
  value: unknown,
  status: number,
  operation: string,
  locator?: Locator,
): Output {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("PROTOCOL");
  const record = value as Record<string, unknown>;
  const expectedStatus = operation === "create_markdown" ? 201 : 200;
  if (
    record.ok === true &&
    status === expectedStatus &&
    exactKeys(record, ["ok", "operationId", "data"]) &&
    safeText(record.operationId, 1, 512) &&
    successData(operation, record.data)
  )
    return {
      ok: true,
      operation,
      status,
      operationId: record.operationId,
      data: record.data,
    };
  if (
    record.ok === false &&
    exactKeys(record, ["ok", "operationId", "error"]) &&
    safeText(record.operationId, 1, 512) &&
    record.error &&
    typeof record.error === "object" &&
    !Array.isArray(record.error)
  ) {
    const error = record.error as Record<string, unknown>;
    if (
      !exactKeys(error, ["code", "message"]) ||
      typeof error.code !== "string" ||
      typeof error.message !== "string"
    )
      return fail("PROTOCOL");
    const pair = errorPairs.get(error.code);
    if (!pair || pair[0] !== status || pair[1] !== error.message)
      return fail("PROTOCOL");
    return {
      ok: false,
      operation,
      status,
      operationId: record.operationId,
      error: { code: error.code, message: error.message },
      ...(error.code === "CONFLICT" && locator
        ? { recovery: { action: "read", locator } }
        : {}),
    };
  }
  return fail("PROTOCOL");
}

export async function main(
  args = process.argv.slice(2),
  environment = process.env,
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? ((text) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text) => process.stderr.write(text));
  try {
    const parsed = parse(args);
    if (parsed === "help") {
      stdout(usage);
      return 0;
    }
    if (parsed === "version") {
      stdout("0.1.0\n");
      return 0;
    }
    const base = endpoint(
      environment.MD_DRIVE_GATEWAY_URL,
      dependencies.allowInsecureEndpoint === true,
    );
    const bearer = await credential(environment);
    const markdown =
      "file" in parsed.command ? await content(parsed.command.file) : undefined;
    const call = request(parsed.command, base, markdown);
    const signal = AbortSignal.timeout(parsed.timeout);
    const response = await (dependencies.fetch ?? fetch)(call.url, {
      ...call.init,
      signal,
      redirect: "manual",
      headers: {
        authorization: `Bearer ${bearer}`,
        accept: "application/json",
        ...(call.init.headers ?? {}),
      },
    }).catch(() => fail("TRANSPORT"));
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400)
    )
      fail("PROTOCOL");
    const result = output(
      await responseJson(response),
      response.status,
      call.operation,
      "locator" in parsed.command ? parsed.command.locator : undefined,
    );
    stdout(`${JSON.stringify(result)}\n`);
    if (result.ok) return 0;
    stderr(`md-drive: ${result.error.code}\n`);
    return result.error.code === "UNAUTHENTICATED"
      ? 6
      : result.error.code === "CONFLICT"
        ? 8
        : 7;
  } catch (error) {
    const code: CliFailure =
      error instanceof Error &&
      ["USAGE", "CREDENTIAL", "TRANSPORT", "PROTOCOL"].includes(error.message)
        ? (error.message as CliFailure)
        : "TRANSPORT";
    stdout(
      `${JSON.stringify({ ok: false, error: { code, message: code === "USAGE" ? "Command usage is invalid." : code === "CREDENTIAL" ? "Credential configuration is invalid." : code === "TRANSPORT" ? "Gateway request failed." : "Gateway response is invalid." } })}\n`,
    );
    stderr(`md-drive: ${code}\n`);
    return code === "USAGE"
      ? 2
      : code === "CREDENTIAL"
        ? 3
        : code === "TRANSPORT"
          ? 4
          : 5;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  void main().then((code) => {
    process.exitCode = code;
  });
