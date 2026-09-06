# JSON API and Redacted Audit Events — Implementation Plan

## Scope

Add the authenticated JSON transport around the completed `MarkdownService` contract. The
transport exposes exactly the six Markdown operations, validates every external value with strict
Zod schemas, applies finite request/result/time/rate controls, maps all failures to a stable JSON
envelope, and emits one content-free Pino audit event for each API attempt.

This task does not add an MCP endpoint, CLI, UI, server listener, Docker/Terraform, runtime secret
loading, or any direct Drive call in a route. It also does not evaluate write-gate evidence or
approvals. Deployment composition and write-capability evaluation remain separate work.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| The six existing application operations are the transport contract. | Register only the six exact `/v1/markdown/*` routes below. Each handler calls one `MarkdownService` read method or one separately supplied `MarkdownWriteSession` method; it never accesses a Drive port or Google SDK. | Approved task brief; handoff; `src/application/markdown-service.ts` |
| Authentication normalizes identity but grants no document authority. | Every API route runs the completed `PrincipalVerifier` first. Its `AuthenticatedPrincipal` is request attribution only. The write handlers must additionally obtain an already-issued, separately supplied `MarkdownWriteSession`; absence is `UNSUPPORTED` and makes zero service mutation calls. | User direction; task 001 auth spec; guarded-write spec/source |
| A `WriteLease` is private process-local capability. | No route schema, header, query, JSON response, audit event, error, or API dependency exposes a lease. A trusted outer composition may turn an independently obtained live lease into `MarkdownService.openWriteSession(lease)` and supply that session through the narrow provider seam. The default provider returns no session. | User direction; `src/write-gate/gate.ts`; `src/application/markdown-service.ts` |
| The guarded writer remains the last write check. | Supplying a session does not bypass `GuardedDriveWritePort.validateLease`: each actual create/update/archive still revalidates the private lease immediately before the raw mutation. A stale/invalid session therefore remains unavailable. | `src/drive/guarded-drive-write-port.ts`; guarded-write spec |
| Public validation and errors must be deterministic and non-sensitive. | Parse route-local query/body values with `.strict()` Zod schemas, convert only known safe values to domain DTOs, and return the exact versioned envelopes and status map in this plan. Do not return Zod internals, stack traces, provider errors, paths outside the root, authorization data, or document text in an error. | Task brief; handoff safety/logging rules; auth contract |
| All work is bounded before or around dispatch. | Authenticate before JSON body parsing, apply a bounded per-principal limiter, enforce JSON/body/value/result limits, use a shared response deadline, and pass only service-configured result limits into `MarkdownService`. No handler retries a service operation. | Approved feature; handoff; `src/config/service-config.ts` |
| Audit data is allowlisted, not redacted after arbitrary logging. | Add Pino as a production dependency and log only a constructed audit record. Never pass `req`, `res`, an error object, a Zod issue, a domain input/result object, or arbitrary provider data to Pino. Configure defensive Pino redaction for authorization/token/content paths as a second guard. | Task brief; `src/write-gate/audit.ts`; repository security guidance |
| Health is safe for Cloud Run probes. | `GET /healthz` is unauthenticated and has no Drive/auth/secret I/O. It reports only readiness of the already composed application dependencies; it does not prove a Google credential, root folder, or write lease is live and emits no document audit event. | Feature scope; upcoming infrastructure brief; no-I/O composition convention |

## Visual design

No visual design applies. This task is a machine-facing JSON interface. The approved feature has no
visual artifact to reproduce.

## Exact HTTP contract

All API success and error replies set `content-type: application/json; charset=utf-8`, set
`cache-control: no-store`, and include an internally generated UUID operation ID. Clients cannot
supply or override that ID. The opaque `operationId` is returned only to correlate a client reply
with its safe audit event; it is not a credential or write capability.

### Routes

| Operation | Exact route | External input | Success response |
| --- | --- | --- | --- |
| `list_markdown` | `GET /v1/markdown/list` | Query: `{ path?: string, recursive?: "true" | "false" }` | `200 { ok: true, operationId, data: { items: MarkdownFileMetadata[] } }` |
| `search_markdown` | `GET /v1/markdown/search` | Query: `{ query: string, path?: string, limit?: decimal-string }` | `200 { ok: true, operationId, data: { items: SearchMarkdownResult[] } }` |
| `read_markdown` | `GET /v1/markdown/read` | Query: exactly one of `{ path: string }` or `{ fileId: string }` | `200 { ok: true, operationId, data: MarkdownDocument }` |
| `create_markdown` | `POST /v1/markdown/create` | JSON body: `{ path: string, content: string }` | `201 { ok: true, operationId, data: MarkdownFileMetadata }` |
| `update_markdown` | `POST /v1/markdown/update` | JSON body: exactly one locator plus `{ expectedRevision: string, content: string }` | `200 { ok: true, operationId, data: MarkdownFileMetadata }` |
| `archive_markdown` | `POST /v1/markdown/archive` | JSON body: exactly one locator plus `{ expectedRevision: string }` | `200 { ok: true, operationId, data: MarkdownFileMetadata }` |

`fileId` and `expectedRevision` are converted at the route boundary to the existing opaque domain
brands only after schema validation. `recursive` and `limit` are decoded from their exact query
wire forms; no coercion accepts arrays, objects, blanks, floats, signs, or alternate booleans.
Absent optional values remain absent so `MarkdownService` retains its conservative defaults.

The JSON parser accepts only `application/json` (with an optional charset parameter) for the three
write routes. Missing or another media type is `415 UNSUPPORTED_MEDIA_TYPE`; malformed JSON,
unknown keys, wrong scalar types, an invalid locator XOR, and out-of-bound values are
`400 INVALID_REQUEST`. Authenticate and rate-limit before parsing a request body so an anonymous
caller cannot make the process parse Markdown content.

### Strict schemas and bounds

Create route-local schema helpers under `src/http/` rather than modifying domain parsing policy.
The schemas must be `.strict()` and enforce UTF-8 byte length, not only JavaScript code-unit length:

| Value | Bound / accepted form |
| --- | --- |
| `path` | string of 1–1,024 UTF-8 bytes; domain policy still decides traversal, Markdown suffix, ambiguity, and root confinement. |
| `fileId` | string of 1–512 UTF-8 bytes; opaque only, with no path interpretation. |
| `expectedRevision` | string of 1–1,024 UTF-8 bytes; opaque only. |
| search `query` | nonblank string of 1–256 UTF-8 bytes. |
| `recursive` | only the literal query values `"true"` or `"false"`. |
| `limit` | an ASCII decimal string representing an integer from 1 through configured `maxResultItems`; no leading `+`, `-`, decimal, exponent, array, or duplicate key. |
| create/update `content` | string whose UTF-8 byte size is at most configured `maxRequestMarkdownBytes`; this is an API bound in addition to `MarkdownService`'s configured file-size policy. |

Extend the deployment-owned, non-secret `ServiceConfig` with a strict `http` object; do not read it
from the environment in this task. It contains the following finite values and cross-field checks:

| Field | Allowed range / required relationship |
| --- | --- |
| `maxRequestMarkdownBytes` | integer 1–1,048,576 and no greater than `drive.maxMarkdownBytes`. |
| `maxJsonBodyBytes` | integer 4,096–6,295,552 and at least `(6 * maxRequestMarkdownBytes) + 4,096`, accounting for worst-case JSON string escaping plus envelope overhead. |
| `maxResultItems` | integer 1–100 and no greater than `drive.maxResults`; use it as the `MarkdownService` maximum list/search result bound at composition. |
| `maxJsonResponseBytes` | integer 4,096–6,295,552. Serialize the selected success envelope to UTF-8 once before sending; replace an oversized result with the stable result-limit error rather than streaming an unbounded response. |
| `requestTimeoutMs` | integer 100–30,000. |
| `rateLimitWindowMs` | integer 1,000–60,000. |
| `maxRequestsPerWindow` | integer 1–120, per authenticated principal and rolling fixed window. |
| `maxConcurrentRequestsPerPrincipal` | integer 1–16. |
| `maxRateLimitPrincipals` | integer 1–10,000. Expire old entries and apply deterministic bounded eviction so verified but numerous principal subjects cannot make the limiter unbounded. |

`MarkdownService` must be composed with `maxSearchLimit` no greater than
`http.maxResultItems`; this is the pre-dispatch result-count bound for both list and search. The
transport's byte check is the final result-size bound. A read that is valid for the Drive service
but cannot fit the configured HTTP response budget returns the result-limit error and never logs
its content.

### Stable error envelope and status map

Every non-health failure returns exactly:

```json
{
  "ok": false,
  "operationId": "uuid",
  "error": {
    "code": "STABLE_CODE",
    "message": "Stable public message."
  }
}
```

Do not include `details`, validation issues, error context, current document metadata, stack traces,
or a cause. Use this exact mapping:

| Source / condition | HTTP | `error.code` | Public message |
| --- | --- | --- | --- |
| `AuthenticationError`, missing or invalid bearer | 401 | `UNAUTHENTICATED` | `Authentication failed.` |
| Incorrect JSON media type | 415 | `UNSUPPORTED_MEDIA_TYPE` | `Request must use application/json.` |
| Malformed JSON, body/query schema rejection | 400 | `INVALID_REQUEST` | `Request validation failed.` |
| `INVALID_PATH`, `NOT_MARKDOWN`, `INVALID_CONTENT`, `INVALID_ARCHIVE` | 400 | same domain code | the corresponding fixed domain-safe message, selected by code rather than reusing a thrown message |
| `FILE_TOO_LARGE` | 413 | `FILE_TOO_LARGE` | `Markdown content exceeds the configured limit.` |
| `NOT_FOUND` | 404 | `NOT_FOUND` | `Markdown file was not found.` |
| `OUTSIDE_ROOT` | 404 | `NOT_FOUND` | `Markdown file was not found.` |
| `AMBIGUOUS_PATH` or `CONFLICT` | 409 | same domain code | fixed code-specific message |
| `UNSUPPORTED`, absent write session, or guarded lease denial | 503 | `UNSUPPORTED` | `Operation is unavailable.` |
| finite rate limit reached | 429 | `RATE_LIMITED` | `Request rate limit exceeded.` |
| response deadline reached | 504 | `REQUEST_TIMEOUT` | `Request timed out.` |
| selected success envelope exceeds `maxJsonResponseBytes` | 413 | `RESULT_LIMIT_EXCEEDED` | `Result exceeds the configured response limit.` |
| `GoogleDriveProviderError` or any other upstream provider failure | 503 | `UPSTREAM_UNAVAILABLE` | `Service dependency is unavailable.` |
| unknown error | 500 | `INTERNAL` | `Internal server error.` |

Set `WWW-Authenticate: Bearer` only on the 401 response and a bounded integer `Retry-After` only
on 429. Do not expose rate counters, timeout configuration, provider status, root configuration,
or whether an opaque ID was outside the allowed root.

### Authentication, limiting, deadline, and write flow

Compose the protected API in this order:

```text
named route + generated operation ID
  -> PrincipalVerifier.verify(one Authorization value)
  -> normalized principal attached only to request-local state
  -> bounded per-principal rate/concurrency reservation
  -> JSON media-type/body parser for writes, then strict Zod parsing
  -> read: MarkdownService.list/search/read
     write: independently supplied MarkdownWriteSession, or unavailable
  -> bounded success serialization
  -> one allowlisted audit event + response
```

The rate limiter runs after principal verification and before any JSON parsing or service call. It
releases its concurrency reservation exactly once on every completion path, including parser error,
timeout, and thrown error. Authentication failures do not create arbitrary limiter keys.

Use a monotonic clock (`performance.now()` or an injected equivalent) for duration and a shared
deadline helper. The helper returns the timeout envelope at `requestTimeoutMs`, never retries, and
marks the audit outcome `timeout`. The current `MarkdownService`/Drive-port contract has no abort
signal; therefore this is a response deadline, not proof that a previously dispatched provider
promise was cancelled. Do not treat a timed-out write as failed or retry it: the guarded writer may
still finish its one permitted conditional mutation. Keep this limitation explicit in the code and
in tests until a later, cross-layer cancellation design is approved.

Define a narrow, injected `WriteSessionProvider`/capability seam owned by HTTP composition. It may
return a session only from separately evaluated deployment/operator write authority, not from an
authorization header, route/body/query input, a principal kind, a config flag, or an environment
toggle. The default implementation returns `undefined`. The HTTP task must not import or call
`WriteGate.evaluate`, read evidence/approvals/trust/replay state, or manufacture a `WriteLease`.
Route tests must demonstrate that a valid Codex or Work principal still receives 503 for all three
writes until the test explicitly supplies a fake session.

### Audit events

Create `src/observability/` (or an equivalently focused HTTP-owned module) with a Pino logger
factory/interface and an allowlisted audit-event builder. Add `pino` to production dependencies;
keep its destination/configuration injectable and create no logger, secret read, or network activity
at import time.

Emit exactly one `markdown-api-request` event for every recognized API route attempt, including
authentication, validation, rate, timeout, and internal failures. Health checks do not emit this
event. The event shape is limited to:

```text
event: "markdown-api-request"
operationId: UUID
operation: list_markdown | search_markdown | read_markdown | create_markdown | update_markdown | archive_markdown
principal: { kind: "work-mcp" | "codex" | "unauthenticated", subject?: safe normalized subject, issuer?: safe normalized issuer }
result: succeeded | unauthenticated | invalid_request | unsupported_media_type | invalid_path | not_markdown | invalid_content | file_too_large | not_found | ambiguous_path | conflict | unsupported | rate_limited | timeout | result_limit_exceeded | upstream_unavailable | internal
statusCode: integer
durationMs: nonnegative integer
fileId?: opaque returned/resolved identifier
resultCount?: integer
```

For list/search, include only `resultCount`; never log the query, path, excerpts, or a list of file
IDs. For read/create/update/archive, include only the opaque file ID when safely known. Never log
relative paths, content, revisions, headers, bearer values, tokens, raw JWT claims, Zod issues,
error objects, request/response objects, URLs, or provider payloads. The Pino configuration must
also redact common nested `authorization`, `token`, `content`, and `password` keys defensively, but
the allowlisted event construction is the enforceable control.

## Detailed implementation approach

1. Add the `ServiceConfig.http` schema/type and focused configuration tests. Preserve strict
   parsing/no-I/O behavior from task 001. Validate all numeric ranges and cross-field relationships
   above; do not add a secret, token, write-enable switch, or environment parser.
2. Add `src/http/` modules for API DTO schemas, operation/error mapping, operation context,
   bounded rate limiting, deadline/response serialization helpers, principal middleware, and an
   injectable `createJsonApiApp` factory. Keep `src/index.ts` as a thin export/composition entry
   only after rechecking its current test expectations; no module listens on a port in this task.
3. Implement the named six routes plus `GET /healthz`. Attach authentication/limiting ahead of the
   JSON parser, validate inputs once, construct existing domain DTOs, and delegate only to the
   service/session boundary. Route code must have no Google imports and no path/root/Markdown
   validation logic beyond its wire-size/schema role.
4. Add Pino-backed, injected observability. Generate one operation ID per attempt, measure duration
   with a monotonic clock, record one allowlisted audit event, and use the same fixed outcome for
   response and log mapping without serializing untrusted objects.
5. Add fake-only HTTP contract tests. Use an in-memory `MarkdownService`/write session, a fake
   `PrincipalVerifier`, fake session provider, fake clock/deadline, fake rate limiter where needed,
   and a capturing Pino destination/logger. No test loads a secret, creates a real JWT, calls Drive,
   contacts an issuer/JWKS endpoint, or invokes the live probe.

## Expected control flow and invariants

```text
authenticated HTTPS caller
  -> Express route named for one operation
  -> PrincipalVerifier (Work JWT or separate Codex bearer)
  -> bounded principal rate/concurrency gate
  -> strict wire DTO schema
  -> MarkdownService read operation
     OR separately supplied MarkdownWriteSession operation
  -> stable envelope + one redacted Pino audit event
```

Invariants:

- An HTTP route never calls a Drive SDK/port/raw writer and never repeats document policy.
- All six application operations retain their established root, Markdown, ambiguity, byte-size,
  revision, and no-permanent-deletion rules.
- Valid authentication can read but cannot create/update/archive without separate live capability;
  the default API composition has no write session and is therefore write-disabled.
- A lease is absent from every external API and log shape and is still checked immediately before a
  provider mutation by the guarded writer.
- Each protected attempt receives one opaque operation ID, one terminal envelope, and one
  allowlisted audit event. API payloads and audit payloads never contain Markdown content or bearer
  material.
- Error and success replies are finite JSON; no unbounded request, output, rate-limiter state, or
  retry path is introduced.

## Current-tree evidence and unchanged boundaries

The current tree has the prerequisites this task needs: `src/auth/principal-verifier.ts` exposes a
strict, no-fallback `PrincipalVerifier`; `src/config/service-config.ts` parses non-secret config;
`src/application/markdown-service.ts` owns all six document operations; and
`src/drive/guarded-drive-write-port.ts` is default-deny and validates a lease directly before raw
writes. `src/index.ts` currently constructs a route-free Express app, so this task must replace or
extend that shallow factory with injected HTTP composition and update its narrow test accordingly.

`pino` is not currently declared in `package.json` or `pnpm-lock.yaml`; this task must add and lock
the production dependency rather than emulate Pino with `console` or a handwritten logger. Existing
Express and Zod dependencies are already locked. No existing HTTP route/test module exists.

Keep `src/domain/**`, `src/application/markdown-service.ts` document policy, `src/drive/**`,
`src/write-gate/**`, `src/live-drive/**`, provider adapters, live-probe files, credentials, Docker,
Terraform, MCP, CLI, and client/plugin work outside scope except for the narrowly necessary
`ServiceConfig.http` extension and package lock update. Do not alter write-gate semantics or create
an auth-to-write bridge.

## Test strategy and validation

Add focused fake-only tests, likely under `tests/http/` and `tests/observability/`, covering:

- all six routes delegate exactly once to the correct fake service/session method and return their
  stable success envelope/status; list/search result caps and byte-cap rejection are exercised;
- missing/bad auth returns 401 before JSON parsing/service work; Work and Codex principals are both
  attributed safely; no credential/header appears in a captured response or audit output;
- strict unknown-key, XOR locator, array/duplicate query, boolean/limit wire form, size boundary,
  malformed JSON, and wrong media-type cases return their exact stable code/status;
- each domain/provider/unexpected error maps to the exact table without its original message,
  context, stack, or provider status leaking; `OUTSIDE_ROOT` is indistinguishable from not found;
- rate/concurrency limits reject before parsing/service calls, expire/evict bounded state, and always
  release reservations; deadline behavior has one 504/audit outcome and no retry;
- a valid principal cannot write with the default session provider; only an explicitly supplied fake
  session reaches fake mutation methods; no body/header can supply a lease; a guarded denied lease
  continues to surface `UNSUPPORTED`;
- health remains unauthenticated, deterministic, no-audit, and makes no Drive/auth/session call;
- captured Pino records have exactly the allowlisted fields and never contain unique sentinel
  Markdown text, query/path/excerpt, file revision, bearer value, JWT-like string, authorization
  key, or arbitrary thrown-error text.

Run focused tests while implementing, then the repository-required suite:

```bash
CI=true pnpm test -- tests/http
CI=true pnpm test -- tests/observability
CI=true pnpm test -- tests/config/service-config.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

Run only focused paths that exist. Do not run `pnpm drive:probe`, contact a JWT issuer/JWKS, load a
mounted secret, or make a live Drive call. Inspect the final dependency diff and generated audit
test output for credential-shaped strings and document content before review.

## Risks and careful checks

- Express timeout/race logic cannot cancel the current Drive-port contract. Never turn a 504 into a
  retryable write and never claim it proves no mutation occurred. A future cancellation change must
  be designed through the application/port boundary, not improvised in a route.
- Do not accept a user-provided correlation/operation ID, arbitrary Pino bindings, or raw error
  object: each can become an audit-data injection path.
- Do not relax query parsing through Express coercion. A duplicate or array locator/limit must fail,
  not select a value.
- Do not serialize an `AuthenticationError`, `MarkdownGatewayError`, or
  `GoogleDriveProviderError` directly. Those classes remain useful internal classifications, not
  public response bodies.
- Do not use a valid Codex/Work principal as a condition to call `openWriteSession`, evaluate a
  gate, or read approval/evidence data. The separately supplied session/capability is mandatory.

## Open questions

None. Deployment chooses the concrete finite `http` values and provides any future independently
evaluated write-session provider; this task supplies no permissive defaults for that authority.
