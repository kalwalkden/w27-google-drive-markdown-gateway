# Bounded Tree Read Model — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `src/application/markdown-service.ts` | `MarkdownService`, direct-root guards, resolution helpers, list/search/read | Owns the policy being replaced. It currently rejects nested input and applies independent direct-child work. It should own complete traversal, scoped budget use, snapshots, output sorting, and stable domain errors. |
| `src/drive/drive-port.ts` | `DriveReadPort`, `DriveListOptions`, descendant/search helpers | Current contract exposes independent direct-child/list-descendant/search methods. It needs one scoped primitive-read contract and a typed shared-budget overflow signal without changing raw write contracts. |
| `src/drive/google-drive-read-adapter.ts` | `GoogleDriveReadAdapter`, root cache, `listChildren`, `readFile` | Owns fresh root/Shared Drive validation, Drive pagination, raw child accounting, metadata/media facts, fatal UTF-8, and safe provider failures. Its direct-root media check and per-call page limits are the main obsolete restrictions. |
| `src/drive/in-memory-drive-port.ts` | `InMemoryDrivePort` fixtures, list/read helpers | Test-only topology model. It needs scoped counters and deterministic timing/race hooks so service tests can prove full-tree completeness without a network. |
| `src/config/service-config.ts` | drive Zod shapes and cross-limit validation | Deployment-owned source for the new depth, metadata, and content-search budgets and their safe compatibility check. |
| `src/runtime/server.ts` | `readAdapterConfig`, `composeRuntime` | Injects all read limits into the one adapter and one service. It must preserve default-disabled write sessions. |
| `tests/application/markdown-service.test.ts` | `fixture`, `portFrom`, direct-root and topology cases | Primary safety proof for path/ID uniqueness, traversal, budget sharing, ordering, and pre/post race behavior. |
| `tests/drive/google-drive-read-adapter.test.ts` | `FakeDriveApi`, adapter request/counter cases | Proves pagination, corpus/root behavior, exact media reads, and all provider work bounds with no token or network. |
| `tests/config/service-config.test.ts`, `tests/runtime/server.test.ts` | full config fixtures and injected composition fakes | Locks schema completeness, invalid limits, and runtime propagation. |
| `tests/http/json-api.test.ts`, `tests/mcp/stateless-mcp.test.ts` | injected shared service and audit/metric assertions | Confirms existing tree-capable inputs delegate unchanged and stable read outcomes remain redacted. |

## Entry point and call path

```text
authenticated JSON / Work MCP / Codex CLI request
  -> existing transport validation (path, recursive, query, result limit)
  -> MarkdownService.listMarkdown | searchMarkdown | readMarkdown
  -> one request-scoped Drive read session and budget
  -> fresh root validation + primitive get/list/media calls
  -> complete topology snapshot and optional bounded content scan
  -> post-snapshot comparison
  -> existing public result/error and closed terminal telemetry
```

The runtime composition path is:

```text
GATEWAY_SERVICE_CONFIG_JSON
  -> parseServiceConfig / parseRuntimeConfigJson
  -> composeRuntime
  -> one GoogleDriveReadAdapter + one MarkdownService
  -> JSON and MCP apps share that service
```

## Contracts, state, and invariants

- `src/domain/markdown.ts` owns opaque `FileId`, `FolderId`, `Revision`, strict relative-path
  parsing, Markdown checks, byte checks, and the stable `MarkdownGatewayError` code set. No new
  public domain error is required for this task.
- `DriveNode` carries the provider facts needed for snapshot comparison: ID, name, kind, parents,
  modification time, optional revision, size, and MIME type. Folder ETags may use the existing
  optional revision field; leaf Markdown files still require it before metadata exposure.
- The root is an opaque configured ID, not a name. A request may read only a chain ending exactly at
  that root and only after every edge has one parent and one exact-name sibling mapping.
- Scoped provider work is mutable request state, never adapter-global state: pages, raw children,
  metadata fetches, media reads/media bytes, and limit exhaustion are shared by all calls in one
  service operation. No response is emitted from an incomplete scope.
- `maxJsonResponseBytes` remains transport-owned for final JSON/MCP framing. The service's matching
  conservative result-byte accounting prevents it from building an unbounded domain result first.
- `DriveProviderError` remains limited to closed provider categories. Scope exhaustion must reach
  the application as a distinguishable bounded-read condition so it maps to `RESULT_LIMIT`, not a
  redacted 503 upstream failure.
- `MarkdownApiAuditEvent` and `MarkdownMetricObservation` allow only existing operation/result
  vocabularies. Paths, queries, root/folder IDs, content/excerpts, revisions, sizes, and budget
  values remain forbidden.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/application/markdown-service.ts` | `resolveSegments`, `resolveVerifiedNode`, `sameNodeFacts`, `assertUniquePath` | Retain strict name/parent/path validation ideas, but replace direct-root gates and extend chain checks to sibling uniqueness and pre/post snapshots. |
| `src/drive/google-drive-read-adapter.ts` | `ensureRoot`, `fetchMetadata`, `listChildren`, `readFile`, `normalizeNode`, `sliceWellFormedUtf16` | Preserve narrow Google calls, cache invalidation behavior, root corpus validation, fatal UTF-8, immutable normalized facts, and safe excerpts while moving limits into a request scope. |
| `src/drive/in-memory-drive-port.ts` | immutable `snapshot`, intentionally malformed fixtures, deterministic revision/timestamp progression | Model hostile trees and races without special production-only behavior. |
| `tests/drive/google-drive-read-adapter.test.ts` | injected `FakeDriveApi` with pages, media, ETags, and controllable errors | Add exact-count and race tests without authentication or network. |
| `tests/application/markdown-service.test.ts` | `InMemoryDrivePort`, `TrackingDrive`, synthetic guarded capability | Add read-only tree tests while keeping later write work explicitly unavailable. |
| `src/http/json-api.ts` and `src/mcp/stateless-mcp.ts` | existing schema delegation and `RESULT_LIMIT`/`CONFLICT` classification | Preserve public outputs and test that newly enabled tree inputs take the same service path. |
| `src/observability/audit.ts` | narrow typed terminal event and recorder isolation | Test redaction through existing seams; do not add unbounded traversal telemetry. |

## Tests and fixtures

- Use `InMemoryDrivePort` for service behavior: roots, nested folders/files, sibling duplicate
  names, duplicate canonical file paths, shortcuts, multi-parent nodes, cycles, unsafe provider
  names, oversized files, and synthetic parent/leaf changes between pre/post phases.
- Use `FakeDriveApi` for adapter behavior: paginated child lists, next-page overflow, nested exact
  media, root/Shared Drive mismatches, ETag/modified-time changes, malformed provider records, and
  page/node/metadata/media counters. It must never acquire a token or invoke a live endpoint.
- Preserve or adapt the current direct-root cases as compatibility tests: absent `path` plus
  `recursive: false` returns the same direct-root result shape; nested and recursive cases become
  enabled only through the bounded model.
- Assert no result is produced after a limit, duplicate, or pre/post race. For search, assert it
  cannot return early at the caller limit and cannot skip a possible body match after its content
  budget is exhausted.
- Use inert sentinel text when checking telemetry/public error redaction. Do not use real folder
  IDs, document content, credentials, revisions, URLs, or provider payloads.

## Expected unchanged boundaries

- Raw writes, archive behavior, guarded write lease/evidence policy, and Google write adapter stay
  outside this task. Nested mutation support belongs to task 003; deployment-owned write authority
  belongs to task 002.
- Authentication, principal verification, credential formats and secret loading, Terraform, Docker,
  Cloud Run setup, client installation, and live capability harness work remain unchanged.
- JSON/MCP/CLI public schemas, public stable errors, audit schema, metric vocabulary, and response
  envelopes remain unchanged apart from proven delegation/outcome tests.
- `src/live-drive/**`, all live-test/docs/evidence assets, the product handoff, feature task files,
  feature status, build log, and vendored skills are not edit targets.

## Validation commands

Authoritative commands are declared in `package.json`, `ARCHITECTURE.md`, and `AGENTS.md`:

```bash
CI=true pnpm test -- tests/application/markdown-service.test.ts
CI=true pnpm test -- tests/drive/google-drive-read-adapter.test.ts
CI=true pnpm test -- tests/config/service-config.test.ts tests/runtime/server.test.ts
CI=true pnpm test -- tests/http/json-api.test.ts tests/mcp/stateless-mcp.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

Do not run the opt-in `pnpm drive:probe`, Terraform, Docker, `gcloud`, remote OAuth/JWKS, or a live
Drive/Work/Codex endpoint.

## Selected external material

None. The approved feature/task artifacts, handoff, current `397762a` tree, and existing tests are
the binding inputs. This task selects no additional moving external guidance.

## Uncertainties to verify

- Re-read the exact port and runtime types immediately before implementation, because later tasks
  may be concurrently shaping adjacent write composition. Do not preserve obsolete compatibility
  methods merely to avoid adapting a test fake.
- Confirm the installed `googleapis` façade continues to make folder ETags available through the
  normalized metadata response; when no valid ETag is supplied, compare the required safe facts and
  `modifiedTime` rather than inventing a revision.
- Keep the final scope API private to the application/adapter boundary. If a proposed abstraction
  lets a transport or caller supply budgets, paths, raw Drive query text, or topology facts, reject
  it and retain the service-owned design.
