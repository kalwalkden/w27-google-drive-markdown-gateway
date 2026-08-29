# Stateless MCP Tool Adapter — Implementation Plan

## Scope

Add one stateless Streamable HTTP MCP transport that exposes the existing six Markdown operations:
`list_markdown`, `search_markdown`, `read_markdown`, `create_markdown`, `update_markdown`, and
`archive_markdown`. It authenticates the HTTP request through the established principal boundary,
registers exact Zod-backed tool contracts, delegates to the existing application/read-write-session
seams, and proves MCP/JSON semantic parity with fakes.

This is an adapter task. It does not add Drive operations, document policy, a second authorization
model, a listener/deployment bootstrap, plugin-package assets, persistent MCP sessions, or live
Work/Drive calls.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| The six operations already owned by `MarkdownService` are the complete public capability set. | Register precisely the six names below. Each tool calls the corresponding shared service/read method or injected `MarkdownWriteSession`; it must not import a Drive port, Google SDK, path resolver, or raw writer. | Approved task brief/feature; product handoff; current application source |
| MCP is a stateless remote Streamable HTTP adapter. | Mount the official TypeScript SDK's Streamable HTTP handler at one explicit MCP route. Create no session store, in-memory conversation state, resumption state, cookie state, or server-initiated request flow. Treat streaming only as SDK transport mechanics. | Approved task brief/feature; handoff |
| HTTP authentication remains the sole credential/principal boundary. | Pass the incoming `Authorization` value once to `PrincipalVerifier.verify`; accept only normalized `kind: "work-mcp"` principals at the MCP route. Reject missing, invalid, or non-Work principals before tool dispatch with a generic 401 response and no credential/principal details. Never parse JWTs, compare secrets, or forward a gateway credential to Drive. | Auth task spec/source; feature requirement |
| Authentication is not document or write authority. | Principal data is request attribution only. A write tool receives an already-issued, request-local `MarkdownWriteSession` through the same narrow composition seam as JSON; no tool input, result, annotation, header, config flag, or audit entry carries a `WriteLease`, gate evidence, approval, or raw writer. Missing/invalid session maps to the stable unavailable tool error. | JSON API plan/current source; guarded writer source; handoff |
| The application remains the safety-policy owner. | Keep root confinement, ID ancestry, `.md` checks, limits, duplicate-path behavior, revisions, conflict detection, and archive-as-move entirely in `MarkdownService`. MCP schemas only enforce finite wire shape/size and convert opaque ID/revision strings at the boundary. | Drive-core specs/current source; handoff |
| Read-before-write is an agent-facing protocol contract, not a hidden state machine. | Server/tool descriptions tell callers to list/search/read before editing, retain the returned revision, send it unchanged to update/archive, report `CONFLICT` without retry, and seek user confirmation before archive. The adapter does not remember reads or mint revisions. | Product handoff; approved feature |
| Tool annotations must make effects legible to Work. | Read tools set `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: false`. `create_markdown` sets `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: false`; `update_markdown` sets false/true/false/false because it replaces document content; `archive_markdown` sets false/false/false/false because it moves, never deletes. These are hints only: the write-session and guarded writer remain enforcement. | Approved feature requirement; handoff no-permanent-deletion rule; implementation decision recorded here |
| Public MCP output/errors are deterministic and content-safe on failure. | Return result content plus schema-conforming structured content. Successful results preserve the application DTOs. Application failures become `{ ok: false, error: { code, message } }` tool results with `isError: true`, a single JSON text content block, and no context/current metadata. `OUTSIDE_ROOT` becomes `NOT_FOUND`; provider/unknown errors become generic unavailable/internal errors. Never expose thrown messages, Zod issues, paths, revisions, headers, credentials, gate material, or logs. | JSON API error plan/current source; handoff security rules |
| Existing observability is content-free. | If MCP requests are audited in this task, reuse/extend the allowlisted audit model rather than logging request/result/error objects. Never log document content, query/path, revision, authorization, raw claims, tool arguments, or response bodies. Preserve one terminal event per recognized MCP request only if the current HTTP/MCP SDK integration exposes a reliable terminal point. | JSON API plan/current `src/observability/audit.ts`; repository security guidance |

## Visual design

No visual design applies. This is a machine-facing transport. The feature-level source is
`ai/features/epics/google-drive-markdown-gateway/03-chatgpt-work-plugin/feature.md`.

## Exact tool contract

Use the same UTF-8 field bounds as the JSON adapter unless the locked MCP SDK makes a stricter
schema representation necessary: path 1–1,024 bytes; file ID 1–512; expected revision 1–1,024;
query 1–256 nonblank; `content` at most `config.http.maxRequestMarkdownBytes`; and `limit` from
1 through `config.http.maxResultItems`. All object schemas are strict. `fileId`/`path` is an XOR
locator. `recursive` is a boolean; omission preserves the service default.

| Tool | Exact input schema | Exact successful `data` schema | Delegation |
| --- | --- | --- | --- |
| `list_markdown` | `{ path?: string, recursive?: boolean }` | `{ items: MarkdownFileMetadata[] }` | `service.listMarkdown` |
| `search_markdown` | `{ query: string, path?: string, limit?: integer }` | `{ items: SearchMarkdownResult[] }`, where an item may include `excerpt` | `service.searchMarkdown` |
| `read_markdown` | exactly one of `{ path: string }`, `{ fileId: string }` | `MarkdownDocument` | `service.readMarkdown` |
| `create_markdown` | `{ path: string, content: string }` | `MarkdownFileMetadata` | supplied `MarkdownWriteSession.createMarkdown` |
| `update_markdown` | exactly one locator plus `{ expectedRevision: string, content: string }` | `MarkdownFileMetadata` | supplied `MarkdownWriteSession.updateMarkdown` |
| `archive_markdown` | exactly one locator plus `{ expectedRevision: string }` | `MarkdownFileMetadata` | supplied `MarkdownWriteSession.archiveMarkdown` |

`MarkdownFileMetadata`, `SearchMarkdownResult`, and `MarkdownDocument` retain their current
domain fields: relative path, opaque file ID, opaque revision, ISO modified time, size, optional
excerpt, and read content only. Do not create a second metadata/result model.

For every successful tool call, return a structured payload shaped as
`{ ok: true, data: ... }` and one `text` content item containing its JSON representation. For a
tool-level failure, return `{ ok: false, error: { code, message } }` with `isError: true` and one
JSON text content item. Declare an output schema that permits those two explicitly bounded payload
shapes, so result validation cannot silently discard an error. Tool annotations/descriptions must
not claim that write approval is guaranteed by MCP; the target Work platform owns any approval UI.

Transport/protocol failures that occur before a recognized tool invocation (bad MCP framing,
unsupported protocol method, authentication failure, or a handler setup error) use the official
SDK's compatible Streamable HTTP behavior. Do not serialize SDK/Zod/provider internals. The exact
SDK error envelope and handler factory API are deliberately deferred to version verification below.

## Detailed implementation approach

1. Add and lock the official `@modelcontextprotocol/sdk` TypeScript dependency at a deliberately
   selected compatible version. Inspect its installed type declarations before selecting import
   paths, server construction, Streamable HTTP handler API, Zod/Standard Schema support, output
   schema support, annotation field names, and Express integration. Do not invent a version or
   copy an unpinned online example into the code.
2. Add a focused `src/mcp/` transport module and export an injected factory/route middleware from
   `src/index.ts` or the final HTTP composition seam. Its dependencies are only the read subset of
   `MarkdownService`, `PrincipalVerifier`, validated `ServiceConfig`, an optional narrow
   `WriteSessionProvider`, and narrow audit/clock/ID seams if the current JSON transport exposes
   reusable safe ones. Do not require a concrete `MarkdownService` class if a structural read pick
   is sufficient for fakes.
3. Authenticate before constructing/dispatching an MCP tool invocation. Call `PrincipalVerifier`
   exactly once from the received authorization value, require `work-mcp`, and use the normalized
   principal only for allowlisted attribution. Preserve the existing JSON transport unchanged;
   factor only genuinely transport-neutral helpers after confirming concurrent task-002 ownership.
4. Register the six schemas, descriptions, results, and annotations above. Convert only validated
   opaque strings to `fileId()` / `revision()` domain values. Delegate once, serialize bounded
   result content once, and never retry service or write-session calls. Keep create/update/archive
   dependent on a separately supplied write session; no session means a tool error `UNSUPPORTED`.
5. Map known `MarkdownGatewayError` and `GoogleDriveProviderError` categories using the same safe
   public vocabulary as JSON. In particular, a conflict must tell the agent to reread and retry
   only with a newly observed revision, while omitting current file metadata/content. Do not turn
   a stale update/archive into a successful read or retry.
6. Keep the adapter truly stateless across Cloud Run instances: no resume token cache, transport
   session map, durable token/principal capture, per-client read cache, or request-derived global
   state. Any SDK-required handler instance/configuration must be safe to share only if its docs
   and fake concurrency tests establish that; otherwise create request-local protocol objects while
   retaining no state after response completion.

## Expected control flow and invariants

```text
HTTPS Streamable HTTP MCP request
  -> one PrincipalVerifier.verify(Authorization)
  -> require normalized work-mcp principal
  -> official SDK protocol/input validation
  -> one registered tool handler
  -> MarkdownService read method
     OR independently supplied MarkdownWriteSession
  -> bounded MCP content + structured result / safe tool error
```

Write capability remains outside the MCP transport:

```text
operator/deployment-owned WriteGate decision -> private WriteLease
  -> MarkdownService.openWriteSession(lease)
  -> injected WriteSessionProvider -> MCP write handler
  -> GuardedDriveWritePort validates lease immediately before raw mutation
```

Invariants:

- No request may access a Drive SDK/port/raw writer, Google credential, gate evidence, approval,
  lease, or a client-provided identity through MCP code.
- Reads and writes retain precisely the service's root, Markdown, size, path ambiguity, revision,
  conflict, and archive/no-delete semantics.
- The only principal accepted at this endpoint is `work-mcp`; Codex bearer behavior remains a JSON/
  later-client boundary.
- The adapter holds no session state and never makes server-initiated MCP requests.
- Success may contain requested Markdown content only for `read_markdown`; no failure/audit/protocol
  diagnostic may contain content or credential material.
- The adapter never performs external calls in its tests or during import/construction.

## Current-tree evidence and boundaries

At shaping time, the official MCP SDK is absent from `package.json`, `pnpm-lock.yaml`, and
`node_modules`; no `src/mcp/` module or MCP test exists. The committed baseline has the completed
application/auth/Drive contracts; the working tree also has uncommitted JSON transport and audit
work under `src/http/`, `src/observability/`, `src/index.ts`, and related files. That concurrent
work is evidence for seams, not authorization to overwrite it. Re-read its final exports and tests
immediately before implementation.

Leave unchanged: `src/domain/**`, `src/application/markdown-service.ts` document policy,
`src/drive/**`, `src/write-gate/**`, `src/live-drive/**`, deployment/container infrastructure,
plugin packaging/private-install assets (task 002), and all feature/task/build statuses. Do not
run live Drive probes, remote issuers/JWKS, Work installation, or external MCP calls.

## Test strategy and validation

Add fake-only tests under `tests/mcp/` (and only narrowly extend shared HTTP/auth tests if a
transport-neutral seam is extracted):

- use an in-process HTTP/Express harness plus the official SDK's compatible in-process client or
  request fixture to exercise the actual Streamable HTTP protocol; do not hand-roll a different
  JSON-RPC protocol implementation;
- fake `PrincipalVerifier`, read service, write-session provider/session, audit sink, clock, and
  deterministic operation-ID seam; use deterministic metadata/content fixtures;
- assert each tool's exact input/output schema, description-visible safe workflow guidance, and
  annotation object; reject unknown keys, bad byte bounds, invalid XOR locators, blank search,
  invalid boolean/integer forms, and oversized content before a service call;
- assert list/search/read/create/update/archive MCP results match the same fake service outcomes
  as the JSON API DTOs, including stable IDs/revisions and read content;
- assert authentication is invoked once before dispatch; malformed/failed and non-Work principal
  requests make no service/session call and reveal no token/issuer/secret;
- assert default/no write session makes all writes `UNSUPPORTED` with zero mutation calls; supplied
  fake session is the only success path; lease/gate/raw-writer objects never appear in schemas,
  results, logs, or serialized failures;
- assert stale update/archive returns `CONFLICT`, makes no retry, preserves fake content/revision,
  and tells the caller to read again; archive success remains a move and does not expose a delete;
- assert `OUTSIDE_ROOT`, provider, unknown, and SDK-facing validation failures are safely mapped;
  sentinel document text/path/query/revision/bearer/credential values are absent from every error
  and audit record;
- assert sequential and overlapping requests do not share request/principal/read/write state and
  the fake transport has no persistent sessions; tests make no network, Drive, OAuth, JWT/JWKS,
  file-secret, live Work, or `pnpm drive:probe` call.

Run focused tests after they exist, then the authoritative suite:

```bash
CI=true pnpm test -- tests/mcp
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

## Open questions and risky edges to verify before editing

- Verify the current target ChatGPT Work MCP/OAuth profile with the operator in task 002: issuer,
  audience, JWKS URL, JWT claims/algorithms, exact endpoint discovery/registration shape, and
  whether/how Work renders tool annotations and asks for writes. Existing config deliberately has
  no platform default for these values.
- Verify the exact locked MCP SDK version and its API/types for Streamable HTTP, stateless handling,
  Zod v4/Standard Schema interoperability, tool output schemas, annotations, Express adaptation,
  content/error response encoding, and protocol error behavior. The repository contains no selected
  SDK revision yet.
- Verify whether the SDK's Streamable HTTP implementation requires a per-request server/transport
  object to avoid session state, and how it supports concurrent calls. Do not add a compatibility
  session map merely to match an example.
- Recheck final task-002 JSON API exports and audit model before sharing helpers. In particular,
  current `WriteSessionProvider` is synchronous and JSON-specific; retain or extract it only when
  the concurrent owner has finalized the boundary without exposing `WriteLease`.
- Confirm an MCP-native structured error can conform to the locked SDK's declared output schema.
  If it cannot, preserve safe `isError` text content and record the constrained output contract in
  a focused compatibility test rather than claiming unsupported structured-error behavior.
