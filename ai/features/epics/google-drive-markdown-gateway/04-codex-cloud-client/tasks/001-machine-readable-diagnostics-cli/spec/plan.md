# Machine-Readable Diagnostics CLI — Implementation Plan

## Scope

Add the smallest checked-in Node 24 CLI that calls the six existing authenticated JSON API routes. It is a diagnostics and fallback client only: it reads a scoped Codex bearer from an injected environment secret or a mounted secret-file reference, builds bounded requests, validates bounded replies, and emits one stable JSON result on stdout for every operation attempt.

This task adds no Drive client, Google authentication, server route, write-gate bridge, cloud environment setup, allowlist, live gateway call, runbook, or `AGENTS.md` change. Cloud configuration and deployed-service verification belong exclusively to task 002.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| The JSON API is the only service contract. | Map the six commands one-for-one to the existing `/v1/markdown/list`, `search`, `read`, `create`, `update`, and `archive` routes. The CLI has no Google, Drive-port, `MarkdownService`, write-session, or write-gate imports. | Approved task brief/feature; `src/http/json-api.ts` |
| Node 24 and the existing ESM/TypeScript build are the runtime baseline. | Add a small `src/codex-cli/` module tree compiled by the existing NodeNext build, and package `dist/codex-cli/cli.js` as the `md-drive` bin. Do not add a command-framework dependency. | `package.json`; `tsconfig*.json`; task brief |
| Normal command output is machine-readable and stable. | Each dispatched command writes exactly one newline-terminated JSON object to stdout, for both success and known failure. Human diagnostics go only to stderr and use fixed labels without request values, response bodies, URLs, file paths, or credential material. Help/version are the intentional non-operation stdout exceptions. | Approved task brief; feature success criteria; handoff |
| Codex uses only its scoped gateway bearer. | Accept exactly one of `MD_DRIVE_BEARER_TOKEN` (environment-secret value) or `MD_DRIVE_BEARER_SECRET_FILE` (absolute mounted-file reference). Never accept bearer values in flags, positional arguments, config files, output, errors, or logs. If both/neither/invalid, fail before networking with a generic credential error. | User direction; handoff; `src/auth/principal-verifier.ts` |
| The server owns content and document authority. | CLI syntax validates only finite wire form, local file readability/UTF-8/size, and API envelope shape. It does not duplicate root, traversal, `.md`, revision, or archive policy, and forwards server-safe public errors only after strict validation. | `src/http/json-api.ts`; `src/domain/markdown.ts` |
| Writes must never retry or silently recover. | Make one HTTP request per invocation, with no retry policy for any command. In particular, never retry create/update/archive after timeout, transport failure, malformed reply, or `CONFLICT`; never automatically reread after a conflict. | User direction; JSON API deadline/write comments; handoff |
| Conflict recovery must be useful but content-safe. | A recognized `CONFLICT` failure returns a stable `recovery` object containing only `action: "read"` and the caller-selected locator (`path` or opaque `fileId`), plus the server operation ID when supplied. It contains no document content, expected/current revision, request file name, bearer, raw status/body, or server diagnostics. | User direction; handoff optimistic-concurrency workflow; JSON API error contract |
| Client work is finite. | Enforce local argument byte limits matching the API wire schema, a 1 MiB local content-file bound, one bounded timeout (default 30 s; accepted `--timeout-ms` range 100–30,000), and streamed response reading capped at 6,295,552 UTF-8 bytes. Abort on timeout and discard oversized/non-JSON/unrecognized replies. | User direction; `src/http/json-api.ts`; `src/config/service-config.ts` |

## Visual design

No visual design applies. This is a machine-facing command-line interface; the feature has no visual artifacts.

## Command and output contract

The executable is `md-drive`. The production endpoint comes from required `MD_DRIVE_GATEWAY_URL`; it must be an absolute HTTPS URL with no username, password, query, or fragment. Normalize one optional trailing slash and append fixed route paths only. A dependency-injected local HTTP URL is test-only; the production parser never permits it.

`MD_DRIVE_BEARER_TOKEN` is an injected secret value. `MD_DRIVE_BEARER_SECRET_FILE` is an absolute path to a mounted regular file, read as at most 1,024 bytes and normalized by removing one terminal LF or CRLF. Token form matches the existing Codex verifier: canonical base64url, decoded size 16–512 bytes. A secret-file path/value is never echoed, including on read, validation, or permission failure.

| Command | Strict accepted input | JSON API request |
| --- | --- | --- |
| `list` | optional `--path <relative-folder>`; optional `--recursive` | `GET /v1/markdown/list` with only supplied query values; `--recursive` sends `recursive=true` |
| `search <query>` | one nonblank query; optional `--path`; optional decimal `--limit <1..100>` | `GET /v1/markdown/search` |
| `read` | exactly one of `--path <relative-file>` / `--file-id <opaque-id>` | `GET /v1/markdown/read` |
| `create <relative-file> --file <local-file>` | one path and one regular local file | `POST /v1/markdown/create` JSON `{ path, content }` |
| `update --revision <opaque-revision> --file <local-file>` | exactly one locator, nonempty revision, one regular local file | `POST /v1/markdown/update` JSON locator plus `expectedRevision` and `content` |
| `archive --revision <opaque-revision>` | exactly one locator and nonempty revision | `POST /v1/markdown/archive` JSON locator plus `expectedRevision` |

Every ordinary command also accepts a single global `--timeout-ms <integer>` before the command. No short flags, positional aliases, `--` passthrough, duplicate options, unknown options, repeated option values, implicit booleans, stdin content (`--file -`), or ambient config files are accepted. `--help`/`help` returns fixed usage text and `--version` returns the package version without resolving credentials or making a request. The help text documents command grammar and variable *names* only; task 002 owns environment/runbook instructions.

Validate API-sized scalar values before network I/O: `path` 1–1,024 UTF-8 bytes; `fileId` 1–512; `expectedRevision` 1–1,024; query 1–256 nonblank bytes; `limit` ASCII decimal 1–100. Read `--file` only after command/config/credential validation; require a non-symlink regular file, reject data above 1,048,576 bytes before decoding, and decode UTF-8 with fatal decoding and well-formed UTF-16 checks. Never include local filesystem errors, file content, or filenames in output diagnostics.

For all dispatched operations, stdout is exactly one of:

```json
{"ok":true,"operation":"read_markdown","status":200,"operationId":"opaque-id","data":{}}
```

```json
{"ok":false,"operation":"update_markdown","status":409,"operationId":"opaque-id","error":{"code":"CONFLICT","message":"Markdown revision conflict."},"recovery":{"action":"read","locator":{"path":"docs/example.md"}}}
```

`operation`, `status`, and `operationId` appear only when safely known. Success forwards the strictly validated API `data` unchanged (including read content, which was explicitly requested). For a validated gateway failure, forward only the API's stable `code` and fixed `message`; otherwise emit one CLI-owned fixed code: `USAGE`, `CREDENTIAL`, `TRANSPORT`, or `PROTOCOL`. Do not pass through arbitrary JSON fields, `details`, raw bodies, headers, URLs, error strings, or response snippets. Stderr uses a fixed one-line `md-drive: <CODE>` diagnostic and never duplicates stdout JSON.

Exit codes are stable: `0` success; `2` `USAGE`; `3` `CREDENTIAL`; `4` `TRANSPORT` (including local timeout); `5` `PROTOCOL` (oversized, invalid, or unrecognized API reply); `6` validated `UNAUTHENTICATED`; `7` other validated gateway failure; `8` validated `CONFLICT`. HTTP `429` remains gateway failure exit `7`; the CLI must not retry from `Retry-After`.

## Detailed implementation approach

1. Add a focused `src/codex-cli/` boundary: typed parsed command union, strict parser/help renderer, bounded environment/secret loader, bounded content-file reader, HTTP transport, API-envelope validator/mapper, and thin executable `cli.ts`. Keep exported seams explicit so unit tests can supply process arguments, environment, files, clock/abort, and transport without manipulating real secrets or egress.
2. Implement parsing as a closed grammar rather than coercing `process.argv`. Decide command before reading files or contacting the endpoint; reject conflicting locators and every unknown/duplicate/missing value. Build query strings with `URLSearchParams`; JSON-serialize only the exact route body fields.
3. Implement one `fetch` transport with `Authorization: Bearer <credential>`, `Accept: application/json`, and `Content-Type: application/json` only for writes. Combine the command deadline with caller cancellation where injected. Read the response stream incrementally to its absolute byte limit before JSON parsing; make no request retry, redirect-following policy, or background work.
4. Validate status/body correspondence against the current JSON API contract. Success must be a bounded JSON object with `ok: true`, a string operation ID, and the route-appropriate `data` shape. Failure must be `ok: false` with a recognized public error code/message pair and (when supplied) a bounded operation ID. Treat an HTML page, malformed JSON, mismatched envelope, unknown field/value, or over-limit response as `PROTOCOL`, never echoing it. Keep recognized 401 and conflict classifications distinct for exit/recovery.
5. Add package metadata `bin: { "md-drive": "dist/codex-cli/cli.js" }` and any narrow script/test adjustments needed by the existing compile pipeline. Do not make the CLI a service-runtime entry point or alter the JSON API package composition.
6. Add fake local HTTP contract tests under `tests/codex-cli/`. Start only loopback fixture servers in test process, inject non-secret sentinel values, and assert observed method/path/query/headers/body as well as stdout/stderr/exit behavior. No test uses DNS, the gateway, Drive, Google auth, a mounted secret, or the live probe.

## Expected control flow and invariants

```text
argv + injected environment
  -> closed command/options grammar
  -> HTTPS endpoint + exactly one scoped credential source
  -> bounded local content read (write commands only)
  -> exactly one bounded HTTP request to fixed JSON API route
  -> bounded API-envelope validation
  -> one JSON stdout record + fixed stderr diagnostic + stable exit code
```

- The CLI neither stores state nor retains document content beyond the active request/response.
- A gateway bearer is sent only as the `Authorization` header to the validated configured origin. It never appears in a URL, child-process argument, stdout, stderr, error, test fixture, or log.
- The API remains the owner of authentication, root confinement, Markdown policy, revisions, archive/no-delete policy, write availability, rate limits, and audit logging.
- A conflict is a terminal client result. The recovery object instructs the caller to reread, retain the new server revision, and issue a new explicit update; it never claims a write was absent after a timeout.
- Read responses may contain requested content only in successful JSON stdout. Errors, diagnostics, and recovery data contain no content.

## Current-tree evidence and unchanged boundaries

Task 002 of the authenticated-service feature already implements the exact six routes, stable success/error envelopes, one-request deadline behavior, response cap, authentication, and default-disabled writes in `src/http/json-api.ts`. Its public conflict reply intentionally contains no current metadata or document content. `src/auth/principal-verifier.ts` defines the Codex bearer's canonical base64url form and bounded mounted-secret behavior, which this CLI mirrors only for local credential validation—not server authentication.

`src/live-drive/cli.ts` and `src/live-drive/http.ts` show the repository's ESM executable and `AbortSignal.timeout` pattern, but are a live Google capability harness and must not be reused as a Drive/auth client or run during this task. The target task currently has no `spec/` directory or CLI source. Concurrent uncommitted HTTP/observability/package edits are outside this task and must be preserved.

Do not change `src/http/**`, `src/application/**`, `src/domain/**`, `src/auth/**`, `src/drive/**`, `src/write-gate/**`, `src/live-drive/**`, deployment assets, cloud-preflight guidance, or `AGENTS.md`. In particular, a current service may return `UNSUPPORTED` for archive/writes when its independently supplied write capability is absent; the CLI still implements the route contract and reports that safe gateway result.

## Test strategy and validation

Use fake-only tests to cover:

- every command's exact method, route, query/body shape, bearer header presence (without ever recording its value), one request count, parsed success stdout, empty stderr, and exit `0`;
- parser rejection for absent/unknown/duplicate flags, unexpected positionals, conflicting/missing locators, malformed bounds/booleans/limits, invalid endpoint, both/neither credential source, invalid credential form, and help/version no-I/O behavior;
- content-file regularity, symlink rejection, UTF-8 failure, byte boundary, and proof that filenames/content/sentinel bearer never appear in stdout/stderr;
- timeout/network failure, over-limit stream, non-JSON, malformed/mismatched/unknown envelope, and no automatic retry—including a request counter for every write failure mode;
- recognized stable gateway errors, with 401 exit `6`, 409 `CONFLICT` exit `8`, all other safe errors exit `7`, and conflict recovery locator without expected revision/content/bearer leakage;
- local loopback-only API fixtures for all six routes, including one write request each. No test calls a real endpoint or imports Google/Drive modules.

Run focused tests once present, then the canonical repository suite:

```bash
CI=true pnpm test -- tests/codex-cli
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

Do not run the live Drive probe, contact a deployed gateway, load a real secret, or alter cloud/network configuration.

## Risks and careful checks

- Do not let `fetch` follow a redirect to a different origin with the bearer attached. Set manual redirect handling and classify every redirect as `PROTOCOL`.
- A response-size cap must apply while consuming the stream, not after `response.text()` has already buffered it.
- Do not print thrown `Error.message`, validation issues, OS messages, status text, or a response body. Each can carry content, a secret reference, or upstream diagnostics.
- Do not use a CLI-side 409 reread or retry. A new revision must originate from an explicit later `read` invocation.
- Recheck the committed JSON API contract immediately before implementation: this spec follows the current `src/http/json-api.ts` public envelopes; client changes must be adjusted only if that binding contract changes through its own reviewed task.

## Open questions

None. Task 002 decides the actual Cloud endpoint, secret injection mechanism, egress allowlist, and live verification procedure.
