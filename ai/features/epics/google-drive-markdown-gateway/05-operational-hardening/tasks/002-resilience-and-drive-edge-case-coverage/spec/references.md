# Resilience and Drive Edge-Case Coverage — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `tests/drive/google-drive-read-adapter.test.ts` | `FakeDriveApi`, `GoogleDriveReadAdapter` failure/cache/list/read cases | Highest-value local proof for provider normalization, cache invalidation, bounds, duplicate/shortcut retention, moves/renames, and fatal UTF-8. |
| `tests/application/markdown-service.test.ts` | `fixture`, `InMemoryDrivePort`, write session/topology cases | Locks direct-root policy, duplicate ambiguity, stale revisions/moves, byte limits, and unavailable archive. |
| `tests/drive/google-drive-write-adapter.test.ts` | `CapturingHttp`, conditional mutation cases | Proves exact ETag, no retry/fallback, malformed Unicode rejection, and safe non-412 handling. |
| `tests/drive/guarded-drive-write-port.test.ts` | lease-validation and raw-call ordering fakes | Proves no extra mutation dispatch after denied/expired capability or failure path. |
| `tests/http/json-api.test.ts` | injected service/verifier/limiter/audit fakes and deadline cases | Extends one-terminal-response, timeout, rate-limit, public upstream-failure, and bounded UTF-8 response coverage. Coordinate concurrent edits. |
| `tests/http/limiter.test.ts` | `FixedWindowPrincipalRateLimiter` capacity/release/eviction cases | Preserves bounded principal state and release behavior under pressure. |
| `docs/live-drive-capability-harness.md` | optional operator extension protocol | Only if a concrete live-only uncertainty needs a documented, sanitized, cleanup-safe observation. |

## Entry point and call path

```text
GoogleDriveReadAdapter fake API call
  -> root validation/cache, paginated direct-child list, metadata/media verification
  -> MarkdownService direct-root, duplicate, size, revision, write-session policy
  -> createJsonApiApp auth/limiter/deadline/complete()
  -> typed terminal audit/metrics seam + content-free public response

GoogleDriveWriteAdapter captured send -> guarded writer -> one raw conditional mutation or safe unavailable
```

The optional live path is separate:

```text
explicit operator command + external config/credentials
  -> marked dedicated root -> one disposable file -> sanitized exclusive evidence
  -> exact-file archive cleanup only
```

## Contracts, state, and invariants

- `DriveProviderError` carries only the finite `DriveProviderFailure` and `DriveProviderOperation` categories plus optional status. Its raw provider error is never returned, logged, or copied into metric labels.
- `GoogleDriveReadAdapter` bounds read bytes, traversal nodes, pages, and cache TTL. `invalidateRootContext()` clears only cached validation; it does not authorize a stale root.
- `DriveReadPort` preserves duplicate/shortcut facts. `MarkdownService` is the policy owner: public reads/search/list and mutations are direct-root-only; it requires valid Markdown, current root-parent facts, UTF-8 byte limits, and a caller-supplied revision for update.
- `RawDriveWritePort` results are `success`, `conflict`, or `unsupported`. `GoogleDriveWriteAdapter` maps only 412 to `conflict`, sends the supplied raw ETag unchanged, and has no retry loop. `GuardedDriveWritePort` validates the lease immediately before dispatch.
- `createJsonApiApp` starts a deadline before verification and completes each routed request once. Completion clears timer/releases a reservation and emits only typed allowlisted observability facts. A late operation cannot alter the already-classified response.
- `FixedWindowPrincipalRateLimiter` keys internal state from normalized authenticated principal facts, caps stored entries, and releases concurrency once.
- `LiveDriveEvidence` is strict, versioned, and rejects forbidden keys. Stored operator evidence has no raw identifiers, content, credentials, request/response body, URL, error, or stack data; exclusive output prevents accidental overwrite.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `tests/drive/google-drive-read-adapter.test.ts` | injected fake `GoogleDriveApi`, controllable resources/media/pages/errors/ETags | Add deterministic boundary permutations without a token exchange or network. |
| `tests/application/markdown-service.test.ts` | `InMemoryDrivePort`, fixture graph, synthetic guarded test lease | Model duplicate/move/stale/topology state safely in memory. |
| `tests/drive/google-drive-write-adapter.test.ts` | captured raw request and call count | Assert exactly one conditional dispatch and exact ETag transfer. |
| `tests/http/json-api.test.ts` | dependency injection plus hanging/late promises | Test deadline and no-second-response behavior without a real listener/provider. |
| `tests/live-drive/probe.test.ts` | two-actor stale content/parent and cleanup simulation | Supporting design reference only; do not make normal tests execute live logic or treat cleanup fallback as product archive authority. |
| `src/live-drive/evidence.ts` and tests | strict schema, forbidden-key walk, exclusive sanitized output | Reuse if, and only if, an approved optional live check needs additional evidence fields. |

## Tests and fixtures

All routine coverage is fake-only and should extend existing files rather than create broad integration infrastructure.

| Area | Required cases |
| --- | --- |
| Reader/provider | 401/403, 429, 5xx/transport/timeout classification; exact no-retry count; cache coalescing/expiry/invalidation; root rename/move/invalid topology; pages/traversal bounds; duplicate/shortcut retention; post-media move/rename rejection; oversize/malformed size/fatal UTF-8/surrogate-safe excerpt. |
| Service | root-level duplicate create/path ambiguity; stale update and stale source-parent move state unchanged; direct-root-only rejection; multibyte byte limit and malformed UTF-16 rejection before dispatch; bounded result input/output; archive remains unavailable. |
| HTTP/limiter | upstream response redaction; timeout pre-auth/body/in-flight; one response/audit/release; late completion has no effect; rate-limit denies before service and stays bounded. |
| Writer | exact `If-Match`, 412-only conflict, non-412/auth/throttle/transient/timeout safe result, one mutation max, malformed ETag/Unicode zero dispatch. |
| Optional live extension | explicit opt-in only; marked external dedicated root/direct archive, sanitized schema evidence, exact-ID no-delete cleanup, all uncertain results fail closed. |

Use inert sentinel strings for provider payload/credential/content assertions. Do not put a real token, folder ID, document body, or production output into tests, fixtures, evidence, or commands.

## Expected unchanged boundaries

- `src/application/markdown-service.ts` keeps direct-root reads/mutations and unavailable archive unless a narrow test demonstrates a real regression requiring a local safety correction.
- `src/drive/drive-port.ts`, `src/drive/provider-error.ts`, Google authentication, write-gate policy, auth/principal verification, API operation inventory, MCP/CLI, runtime composition, deployment assets, Terraform, Docker, and credentials should remain unchanged.
- `src/live-drive/**`, live config/example evidence, and deployment docs stay untouched unless a concrete, approved optional live extension requires a minimal evidence/documentation change. Never record an actual live run.
- Task 001 telemetry contract and task 003 rotation/recovery/alert/runbook work are outside this task.

## Validation commands

```bash
CI=true pnpm test -- tests/drive/google-drive-read-adapter.test.ts
CI=true pnpm test -- tests/drive/google-drive-write-adapter.test.ts
CI=true pnpm test -- tests/application/markdown-service.test.ts
CI=true pnpm test -- tests/drive/guarded-drive-write-port.test.ts
CI=true pnpm test -- tests/http/limiter.test.ts tests/http/json-api.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

The authoritative commands are `package.json`, `ARCHITECTURE.md`, and `AGENTS.md`. Do not run the opt-in Drive probe, Docker, Terraform, `gcloud`, remote OAuth/JWKS, or a live endpoint while implementing this task.

## Selected external material

None. Repository artifacts, existing source/tests, and the approved feature/task briefs are the binding inputs. The optional live harness remains a repository-owned operator procedure, not external guidance.

## Uncertainties to verify

- Re-read the final dirty `src/application/markdown-service.ts`, `src/domain/markdown.ts`, `src/http/json-api.ts`, and their tests before editing; concurrent work may have moved the exact seams.
- Confirm a named fake case is not already covered before adding it; prefer coverage of a new combination, call-count assertion, or safety invariant over a duplicate assertion.
- If a real Drive behavior cannot be deterministically simulated, leave the implementation fail-closed and propose the narrow operator-only harness extension. Do not infer atomic ancestor/destination guarantees from a fake or a single live observation.
- If a public-error/telemetry test needs changed category fields, coordinate with task 001’s completed allowlisted contract rather than adding provider-derived details.
