# Resilience and Drive Edge-Case Coverage — Implementation Plan

## Scope

Add focused, fake-only regression coverage for failure handling at the existing Drive adapter, application policy, HTTP deadline/rate-limit boundary, and guarded mutation adapter. Document an optional operator-only extension to the existing dedicated-root capability harness when a real deployment needs to observe an otherwise unprovable Drive behavior.

This task is coverage and narrowly necessary failure classification only. It does not add retries, background work, new Drive operations, a broad crawler, a load-test platform, production write composition, or a live run. The direct-root-only read/mutation surface and unavailable archive remain deliberate safety controls.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| Public reads and mutations are direct-root only; nested/recursive reads and nested writes fail closed. Archive is unavailable pending an atomic destination-topology proof. | Edge tests must lock this behavior in. Do not make renamed/moved/nested folders work by adding traversal, retries, caching, or a read-then-move sequence. | `src/application/markdown-service.ts`; task 001 threat plan; task 003 Drive-core plan. |
| Google Drive names are non-unique and shortcuts are not trusted targets. | Preserve all sibling facts until `MarkdownService` rejects duplicate names; never choose a duplicate, dereference a shortcut, rename around a collision, delete it, or hide an incomplete list. | Handoff; `src/drive/google-drive-read-adapter.ts`; `src/application/markdown-service.ts`. |
| A Drive ETag is the only observed conditional write precondition. | Stale content/move failures remain one attempted mutation and conflict only for HTTP 412. No automatic retry, re-read/retry, unconditional fallback, or revision synthesized from version/head-revision data. | Platform harness; `src/drive/google-drive-write-adapter.ts`; Drive-core task 003. |
| Request timeout completes the client response but cannot cancel an already dispatched provider promise. | Test that HTTP produces exactly one timeout response/audit outcome, releases the reservation once, and does not redispatch work when the late promise settles. Do not claim cancellation or add retry. | `src/http/json-api.ts`; existing timeout tests. |
| Routine code and evidence must be content- and credential-free. | Fakes may use harmless sentinels, but assertions must prove provider payloads/tokens/content do not become public or observability output. No real credentials, output evidence, or live request belongs in normal tests. | `AGENTS.md`; task 001 observability spec; live-harness docs. |
| The reader has explicit byte, traversal, page, search, and root-cache bounds. | Exercise exact failure behavior at each bound; never convert an exceeded bound into a partial/ambiguous successful response. | `src/drive/google-drive-read-adapter.ts`; `MarkdownService` limits; service config. |
| Existing live harness is opt-in and uses a marked dedicated root plus direct-child archive. | Any live extension remains separately invoked, external-configured, schema-validated, sanitized, and cleanup-first. Its result remains an environmental observation, never a switch that widens the product surface. | `docs/live-drive-capability-harness.md`; `src/live-drive/**`. |

## Visual design

No visual design applies. This is resilience behavior and operator documentation.

## Current-tree alignment

The current implementation already covers many baseline cases: fatal UTF-8 decoding, read-size checks, root-cache invalidation, page/traversal limits, duplicate retention, direct-root validation, safe Drive error categories, one-attempt write behavior, stale conflict handling, HTTP deadlines, and sanitised live evidence. Shape additions as missing high-value combinations and regressions, not a second resilience layer.

`GoogleDriveReadAdapter` currently permits diagnostic descendant enumeration at the port level but its public search is direct-root-only; `MarkdownService` rejects recursive/nested public operations. Do not mistake a fake adapter test for approval to expose descendants. `GoogleDriveWriteAdapter` maps all non-412/non-2xx mutation results to `unsupported`; do not turn status codes into retriable write policy without separately approved idempotency and atomicity proof.

The shared working tree has concurrent changes in application/domain/HTTP files and related tests. Re-read those files immediately before implementation and preserve the completed threat/observability contract.

## Detailed implementation approach

### 1. Strengthen Drive-reader fake coverage at provider seams

Extend `tests/drive/google-drive-read-adapter.test.ts` and its local `FakeDriveApi`; keep injected `GoogleDriveApi` calls fully local.

- Assert 401/403 map to the finite `authentication` category; 429 maps to `throttled`; 5xx, transport rejection, and timeout-shaped errors map to `transient`; malformed successful payloads remain `malformed`. Each assertion must avoid provider body/message/URL/token leakage.
- Test a throttled or transient root/list/media request does not create a retry loop: count the exact attempted fake call(s), reject once with the safe category, and require a later independently invoked operation to reattempt normally.
- Cover a cache lifecycle with injected clock: concurrent initial callers coalesce validation; a valid root is reused only before TTL; explicit invalidation and TTL expiry force fresh validation; a moved/renamed/trashed/wrong-drive root or a failed refresh never leaves the old cache authorized as success. A file renamed/moved between pre-media metadata and post-media verification must be rejected without returning stale content.
- At pagination/traversal limits, verify an extra continuation/page or child over the configured bound throws `limit`, rather than yielding partial results. Preserve the exact parent-scoped query, `supportsAllDrives`, My Drive/Shared Drive corpus behavior, and no global/full-text query.
- Verify direct-root duplicate files and shortcuts are returned as facts to the service but not followed. Root-level duplicate names must lead to `AMBIGUOUS_PATH` at service resolution; no arbitrary winner, retry, or suppression.
- Cover metadata-declared oversize and actual-media oversize before content escapes; reject malformed/non-numeric size, malformed UTF-8 bytes, unpaired/ill-formed Unicode at the relevant input boundary, and excerpts that would split a surrogate pair. Use multi-byte UTF-8 (for example accented text and emoji) to prove byte—not UTF-16-code-unit—limits.

Do not add an adapter retry helper. Read retry/backoff policy, if ever justified, needs an explicit idempotency/deadline/observability design outside this task.

### 2. Lock application topology, duplicate, and revision invariants with in-memory fakes

Extend `tests/application/markdown-service.test.ts` or a focused adjacent fake-only test. Reuse `InMemoryDrivePort`, guarded test capability fixtures, and call counters rather than touching Google code.

- Create sees any existing same-leaf direct-root sibling as failure; multiple matching siblings remain ambiguous. A concurrent externally introduced duplicate is not repaired and later path access stays ambiguous.
- File IDs remain stable while an external actor renames or moves a file. An update resolved before an external direct-root move/rename must fail closed when the returned/postcondition node no longer proves direct-root topology; it must not mutate a renamed/moved target or redirect by name.
- Two actors use the original revision: one successful update changes the revision; the stale request returns `CONFLICT` with state unchanged. Repeat for a source-parent move fake to prove a stale parent request cannot relocate the file.
- Oversized multi-byte content, malformed UTF-16, and invalid paths fail before any provider/write dispatch. Valid Unicode survives the exact configured byte limit; one additional encoded byte fails.
- `listMarkdown`/`searchMarkdown` enforce configured default/max result limits and reject malformed limits before port work. The service never turns recursive/path requests into a nested traversal and never enables archive; explicitly preserve `UNSUPPORTED` for both unavailable boundaries.

If a proposed test discovers an actual postcondition gap, make the smallest local correction in the existing policy owner. Do not add a nested topology cache, a destination-folder assertion composed from separate reads, or an archive move; those cannot supply the required atomic proof.

### 3. Prove HTTP deadline, rate-limit, and public-failure behavior

Coordinate with concurrent work in `tests/http/json-api.test.ts`; do not overwrite its telemetry changes.

- A provider `DriveProviderError` of authentication, throttled, transient, malformed, or configuration remains one content-free `UPSTREAM_UNAVAILABLE` public response. Confirm the classified audit/metric seam receives only closed categories mandated by task 001, not the provider's status/message/body.
- A request that times out before authentication, while parsing the JSON body, or while a service promise is outstanding has one 504 response, one terminal outcome, and at most one reservation release. A late resolution/rejection must not send a second response, call the service again, retry a write, or undo a timeout.
- Rate-limit rejection stays bounded by the fixed-window limiter, returns only the existing retry-after behavior, does not execute the service/write-session provider, and state releases correctly after completed/timeout work. Test limiter capacity/eviction with normalized fake principals; do not log or expose principal keys.
- Bound request body, result count, and serialized response behavior with multi-byte content. Oversize or malformed body encoding must fail before Drive dispatch; response/result limits must return the existing bounded failure rather than truncate document metadata/content.

No server-wide cancellation, load generator, queue, retry scheduler, HTTP client, or public error-schema expansion is in scope.

### 4. Preserve one-attempt guarded mutation behavior

Extend `tests/drive/google-drive-write-adapter.test.ts` and, if needed, `tests/drive/guarded-drive-write-port.test.ts` with captured local HTTP/write fakes.

- For 412, assert exact opaque `If-Match` is sent once and the result is `conflict`; no second request or read/conditional fallback follows.
- For throttled/transient/auth/timeout-like send failures and all non-412 mutation responses, assert one request at most and `unsupported`/safe unavailable behavior. The test must not imply that a caller should retry a mutation.
- Reject stale/malformed/missing ETags and malformed/unpaired UTF-16 before dispatch. Preserve literal UTF-8 encoding for well-formed Unicode and require success metadata to prove the expected direct parent/name/size/revision facts before it can be accepted by service policy.
- Keep archive unavailable in `MarkdownService`; test-only raw `moveFile` behavior is evidence for stale-source semantics, not authority to expose `archive_markdown` or unconditional cleanup behavior.

### 5. Document only an optional live-harness extension

Update `docs/live-drive-capability-harness.md` only if an operator has a concrete need to observe a gap that fakes cannot settle. The normal test suite must not invoke it, require config, or use credentials.

Any extension must:

1. require the existing explicit confirmation, external config/output paths, marked dedicated root, direct-child archive, least-privilege external credentials, and one unique disposable Markdown blob;
2. define a small additional check vocabulary/schema before execution, with operation response and independent metadata/download readback separated;
3. store only status categories, ETags/revision observations already permitted by the evidence schema, byte lengths/digests, and per-run opaque references—never names, raw IDs, paths, URLs, request/response bodies, document content, tokens, secret references, or error/stack text;
4. verify cleanup moves only the exact generated file to the dedicated archive, report `FAILED`/manual-cleanup direction without broad cleanup, and never delete/trash; and
5. treat `UNSUPPORTED`, `INCONCLUSIVE`, malformed evidence, non-412 stale behavior, topology mismatch, interrupted cleanup, or missing proof as fail-closed. A live result may document environment behavior; it must not unlock nested reads/writes, archive, retries, or production writes.

Do not execute the probe, edit example evidence with real data, add a live result, or change credentials/configuration/deployment during this task.

## Expected control flow and invariants

```text
fake API/provider result -> typed Drive failure or verified bounded node/read
  -> MarkdownService direct-root + revision/topology policy
  -> JSON API deadline/rate-limit single terminal response

optional operator probe -> marked disposable root -> sanitized evidence -> exact-file archive cleanup
```

- Failure classification is finite and never transports provider payload data.
- A timeout/rate-limit/retry-like failure cannot dispatch a second mutation.
- Limits fail explicitly; they do not silently truncate a safety-sensitive directory/search result.
- File paths are convenience locators only. Stable IDs plus current parent/revision facts govern safety.
- Renames/moves/duplicates/shortcuts cannot escape root policy or cause a selected arbitrary document.
- UTF-8 is complete, fatal-decoded, byte-bounded, and Unicode-safe at output boundaries.
- No atomic ancestor/destination topology proof means no nested or archive expansion.

## Expected unchanged boundaries

- Do not modify public operation inventory, MCP/CLI contracts, auth modes, runtime write composition, credentials, Terraform, Docker, Cloud Run deployment behavior, secret rotation, alert thresholds, dashboards, runbooks, task status, tasks list, or build log.
- Do not run or alter normal-validation behavior to call Google Drive. Keep `src/live-drive/**`, `config/live-drive-probe.example.json`, and `docs/live-drive-capability-evidence.example.json` unchanged unless the narrowly documented opt-in extension is approved by the concrete implementation evidence need.
- Do not alter write-gate trust/replay/approval semantics or use an in-memory test capability as production authority.

## Validation

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

Inspect fakes for exact call counts and serialized responses/events for every sensitive sentinel. Do not run `pnpm drive:probe`, Docker, Terraform, `gcloud`, remote JWKS/OAuth, or a live service.

## Risks and careful checks

- The adapter's root cache is a performance cache, never authority that survives an invalidation/expiry verification failure.
- HTTP response timeout is not provider cancellation. Do not represent a late provider result as a second outcome or permission to retry a write.
- Google-name and folder topology behavior is not fully deterministic from fakes. Keep a live check opt-in and evidence-backed, rather than coding assumptions into broader capabilities.
- Re-read current concurrent HTTP/application files before editing. Task 001 owns typed telemetry; task 003 owns recovery, rotation, alerts, and operator runbooks.

## Open questions

None. Any proposed nested/archive behavior requires a separately approved provider atomicity proof and task, not a test adjustment.
