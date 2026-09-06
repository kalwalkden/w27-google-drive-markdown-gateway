# Bounded Tree Read Model — Implementation Plan

## Scope

Replace the current direct-root-only read policy with complete, bounded tree reads through the one
`MarkdownService` boundary. The task covers list, search, and read only: selected-folder resolution,
recursive traversal, content search, canonical-path/ID uniqueness, request-local resource budgets,
and pre/post topology verification. It leaves all mutations unavailable and does not contact Drive.

The baseline for this plan is `397762ad8d4e41d039079ed6ad50730ce672f03b`. At that revision,
the transport schemas already accept `path` and `recursive`, but `MarkdownService` and the Google
adapter deliberately reject nested/recursive reads and use independent provider calls. The new
design replaces those direct-root gates; it must not merely enable the adapter's existing
`listDescendants` or `searchDescendants` compatibility methods.

## Binding decisions and constraints

| Decision | Implementation effect | Provenance |
| --- | --- | --- |
| One application boundary owns tree policy. | JSON, MCP, CLI, and runtime continue to call `MarkdownService`; no transport performs Drive traversal, resolves a path, or constructs a second adapter. | Feature requirements and implementation map; handoff. |
| A read response is complete or absent. | List/search traverse the entire selected bounded snapshot before sorting or applying a caller limit. Any exhausted budget, pagination overflow, unreadable needed body, or duplicate canonical output path returns `RESULT_LIMIT` or `AMBIGUOUS_PATH`; never return a prefix. | Feature constraints; task brief. |
| A request has one shared budget. | Start one scoped read session per public service call. Its counters cover depth, raw enumerated children, list pages, metadata checks, content reads, returned items, and service-result bytes across all pre/post work. Counters never reset for a child folder, result, or retry. | Feature constraints; task brief. |
| Paths are exact, unique parent-child chains. | Folder and file path lookup enumerates the exact parent, selects exactly one safe-name child, and refuses duplicate siblings, shortcuts, multiple parents, cycles, malformed IDs/names, and folder escapes. | Feature tree-completeness decision; existing domain grammar. |
| File IDs do not bypass path safety. | ID lookup reconstructs the chain to the configured root and, at every segment, enumerates the parent to prove that exactly one sibling has that name and is the chosen ID. The returned path is derived from this verified chain. | Feature requirements; task brief. |
| Read races are detected, not made atomic. | Record pre-operation topology snapshots; re-fetch the returned target and each ancestor, including sibling uniqueness, after media/content work. Any pre/post mismatch returns `CONFLICT` with no metadata, excerpt, or content. Do not claim to detect an administrator moving an ancestor out and back between checks. | Feature topology decision and trusted-administration assumptions. |
| Text search must be complete within its explicit work bound. | Search every eligible Markdown body whose name did not already establish a match, after complete traversal. If more such bodies than the request budget permits, or a body cannot be safely read within the configured file bound, return `RESULT_LIMIT`; do not omit potential content matches. | Feature requirements; task brief. |
| Existing public errors stay stable. | Use `INVALID_PATH`, `NOT_FOUND`, `AMBIGUOUS_PATH`, `OUTSIDE_ROOT`, `NOT_MARKDOWN`, `FILE_TOO_LARGE`, `RESULT_LIMIT`, `CONFLICT`, and `UNSUPPORTED` according to the existing domain/transport mappings. Do not add a provider-derived or topology-detail error. | `src/domain/markdown.ts`, JSON/MCP mappings, feature constraints. |
| Telemetry remains closed and content-free. | Reuse the existing operation/result categories. Tree success and `RESULT_LIMIT`/`AMBIGUOUS_PATH`/`CONFLICT` must emit their existing terminal classifications only; never add path, query, excerpt, revision, folder ID, budget, or provider details to audit/metric labels. | `docs/observability-contract.md`; feature constraints. |
| Normal validation is fake-only. | Google API façades and in-memory topology fakes prove the behavior. No credentials, secret files, token exchange, live endpoint, Drive probe, Terraform, or deployment operation is part of this task. | `AGENTS.md`; feature validation gates. |

## Visual design

Use the approved feature-level runtime flow in
`ai/features/epics/google-drive-markdown-gateway/07-production-write-and-tree-support/visuals/operation-flow.md`.
There is no UI work. For this task, its read branch means: authenticate before the service,
construct a bounded unique snapshot, perform bounded read/search work, recheck selected topology,
then return a complete bounded result or a safe public error.

## Read model and invariants

### Request-scoped session and budget

Reshape the read-port seam around a per-call scoped read session (exact internal names may differ).
`MarkdownService` creates it before any root, path, metadata, list, or media operation; the Google
adapter validates the configured root and Shared Drive identity as part of opening it. The scope is
not reusable across requests. Primitive operations supplied by the scope are limited to fresh node
metadata, one parent-child enumeration, and one exact-file media read. Remove the service's
dependence on `listDescendants`, `searchDirectChildren`, and `searchDescendants`; they currently
encode the obsolete direct-root policy and cannot enforce a shared budget.

The service config and deployment schema gain these drive read bounds, all positive safe integers:

| Limit | Range | Meaning |
| --- | --- | --- |
| `maxPathDepth` | 1–100 | Maximum root-relative folder/file segments accepted or discovered in one request. The configured root is depth zero. |
| `maxTraversalNodes` | existing 1–10,000 | Total raw child records enumerated across every folder list in the scoped request, before filtering. |
| `maxPages` | existing 1–100 | Total provider `files.list` pages across the scoped request, not per folder. |
| `maxMetadataChecks` | 1–100,000 | Total provider metadata fetches, including root verification and all pre/post chain checks. |
| `maxContentSearchFiles` | 1–10,000 and no greater than `maxTraversalNodes` | Maximum eligible file bodies that a content search may inspect. It does not cap name matching or stop traversal. |
| `maxMarkdownBytes` | existing 1–10,000,000 | Maximum complete decoded body size for a read or content scan. It also bounds content bytes consumed by the read session. |
| `maxResults` | existing 1–1,000 | Maximum list output or caller-selected search output. A list that would return more fails; a search may have more matches but returns the deterministic first caller limit only after the full scan. |
| `maxJsonResponseBytes` | existing HTTP setting | Pass this into `MarkdownService` as its service-result-byte ceiling. Charge the UTF-8 JSON representation of each pending metadata/search/document result before exposing it; retain the HTTP/MCP serializers' stricter final-envelope checks. |

Keep the current `http.maxResultItems <= drive.maxResults` relationship. Add schema checks for
`maxContentSearchFiles <= maxTraversalNodes`, and pass every new Drive limit from
`composeRuntime()` to both the adapter/session and `MarkdownService`. Do not require an operator
configuration to be large enough for every theoretical depth/result combination: a deliberately
smaller valid budget must fail at runtime with `RESULT_LIMIT`, rather than silently broadening a
deployment limit. Update test fixtures that construct complete `ServiceConfig` values.

The scoped session owns the provider-work counters (pages, raw nodes, metadata fetches, media
reads/bytes); `MarkdownService` owns depth, output count, and service-result bytes while passing
the same scope through all calls. Before making a provider request or appending an output, consume
the applicable counter. A provider page/node overflow is represented by a single typed read-limit
failure at the port boundary, not a partially populated array. `MarkdownService` maps that failure
and the existing `DriveListOverflowError` to `RESULT_LIMIT`; ordinary authentication, throttling,
malformed-provider, and configuration failures retain the existing `DriveProviderError` mapping.

### Snapshot and locator rules

Represent a verified topology snapshot as the ordered root-to-leaf chain. Each entry retains only
the facts already safe for the application boundary: stable ID, safe name, kind, exact ordered
single-parent relation, MIME classification, modified time, and provider revision/ETag when
available. The Google adapter must preserve a valid raw ETag for folders as well as files so the
service can compare it when supplied; `modifiedTime` remains required comparison data when no ETag
is available. A snapshot also records that each child was the sole exact-name sibling in its parent
at the time of the check.

For a path locator, parse with the existing strict relative-path grammar, enforce `maxPathDepth`,
then enumerate every parent fully under the scope. Match exact names only. Zero matches is
`NOT_FOUND`; more than one exact-name match is `AMBIGUOUS_PATH`; a shortcut, unsafe name, wrong
intermediate kind, missing/split parent, or root escape is rejected before content work. The
optional list/search folder is resolved with the same folder rule. A selected file must still be a
regular `.md` file with well-formed metadata and an allowed size.

For an ID locator, reject malformed caller IDs before provider work. Fetch the candidate and walk
its one-parent chain to the configured root, enforcing the depth limit and cycle detection. At each
link fully enumerate the parent and prove: the candidate appears exactly once by ID, exactly one
sibling has its safe name, and that sibling is the selected candidate. This proves an ID read has
the same unambiguous canonical path as a path read. The configured root must be a fresh real folder
in the configured Drive corpus; root caching may optimize construction but must not substitute for
the per-scope root validation.

An initial failure retains its natural safe result (`NOT_FOUND`, `AMBIGUOUS_PATH`, `OUTSIDE_ROOT`,
`NOT_MARKDOWN`, or `FILE_TOO_LARGE`). During a *post* check, any absent/changed node, changed
parent/name/kind/MIME/revision/modified/size fact, failed sibling proof, or different chain is a
race and returns `CONFLICT`, without partial data. A raw malformed provider response remains an
upstream failure and is never recast as a topology detail.

### List

`listMarkdown({ path, recursive })` resolves `path` to a verified folder or uses the root. Preserve
the existing `defaultRecursive: false`. Enumerate direct children when false; with `recursive:
true`, use a deterministic breadth-first work queue that visits every reachable real folder once by
ID while retaining every child occurrence for structural checks. Do not follow shortcuts and do not
select an arbitrary duplicate folder.

Build a complete candidate snapshot before emitting anything. Include only regular, safe,
in-root Markdown files within the byte limit. Canonicalize each candidate from its verified chain;
if two eligible candidates have the same canonical relative path, return `AMBIGUOUS_PATH` before
metadata is returned. A duplicated safe folder that is required to resolve the selected folder or
lies on any returned candidate chain is also ambiguous; do not hide one branch by visited-name
deduplication. Non-Markdown and unusable file candidates are not output, but their raw enumeration
still consumes the budget so they cannot hide a duplicate or overflow.

If the complete eligible list exceeds `maxResults`, return `RESULT_LIMIT`. Otherwise sort paths by
explicit code-unit ascending comparison (not provider or locale order), revalidate every returned
file and its chain against the pre-snapshot, charge result bytes, then return the ordered metadata.
Direct-root non-recursive calls retain their present result shape and default behavior.

### Search

`searchMarkdown({ query, path, limit })` keeps the existing nonempty-query and bounded caller-limit
validation, resolves the optional folder, and recursively traverses the entire selected subtree
regardless of a list-style recursive flag. It builds and duplicate-checks the same complete
canonical candidate snapshot before evaluating a caller limit.

For each eligible Markdown candidate, determine a case-insensitive name match without media. For a
candidate whose name does not match, reserve one content-search slot and perform one bounded exact
media read through the scoped session. If the session cannot reserve a needed body, the metadata
size is above the configured body bound, the media is malformed, or any budget would be exceeded,
return `RESULT_LIMIT` rather than omitting a possible body match. Generate excerpts with the
existing surrogate-safe helper only from a complete, successfully verified content read. A name
match may omit the excerpt; a content match includes the bounded excerpt.

Before returning, revalidate every selected result's target and full chain (and compare the media
snapshot for a content match). Sort all matches by canonical path with the same explicit comparator,
then apply the caller limit. Do not stop traversal, body inspection, duplicate detection, or sort
at that limit. This preserves complete search semantics while bounding work. The actual returned
item count and serialized result bytes consume the request budget; overflow returns `RESULT_LIMIT`.

### Read

`readMarkdown` resolves either locator to a unique pre-snapshot, reads media only for that exact
file ID, and verifies complete fatal-UTF-8 content/size as today. It then resolves and compares the
full target/ancestor snapshot again, including all sibling uniqueness checks, before constructing
`MarkdownDocument`. The adapter's own media pre/post node check remains defense in depth; the
service comparison adds mutable ancestor protection. Any drift is `CONFLICT`, not the current
direct-root `UNSUPPORTED` outcome. Charge the complete returned document to the service-result-byte
budget before exposing its content.

## Detailed implementation sequence

1. Extend `src/drive/drive-port.ts` with a minimal request-scoped read-session/budget contract and
   a typed limit signal. Keep raw write contracts untouched. Replace obsolete descendant/search
   service dependencies rather than adding parallel, unbounded compatibility paths.
2. Update `src/drive/in-memory-drive-port.ts` to create independent scopes with deterministic
   counters and full malformed/duplicate topology fixtures. Add narrowly scoped test hooks for
   changing a node or parent between planned reads; never make fake state globally authorize an
   otherwise invalid graph.
3. Rewrite the read branch of `src/application/markdown-service.ts`: remove
   `requireDirectRootRead`, `assertDirectRootFile`, and direct-root list/search assumptions; add
   scope creation, chain snapshots, complete traversal, canonical duplicate indexing, deterministic
   sorting, pre/post comparison, and budget/error mapping. Preserve the guarded write methods and
   keep nested create/update/archive behavior explicitly unavailable for tasks 002/003.
4. Refactor `src/drive/google-drive-read-adapter.ts` to open a fresh root-validated scoped session,
   share page/node/metadata/media counters across its primitive calls, and permit safe nested exact
   metadata/media reads after the service has performed authorization. Remove the adapter's
   `assertDirectRootChild` limitation from media reads; parent/root confinement remains proved by
   the service snapshots. Preserve narrow fields, parent queries, Shared Drive corpus selection,
   fatal UTF-8 decoding, no-write behavior, and redacted provider failures.
5. Extend `src/config/service-config.ts` and `src/runtime/server.ts` to parse, validate, and inject
   the new limits. Preserve credential-loading/auth-mode behavior and write-session absence.
6. Do not change transport schemas or public envelope/error mappings unless a type-level seam
   requires it. Add parity assertions that existing JSON query and MCP tool inputs pass nested paths
   and recursive flags to the shared service, and that the existing error/telemetry classifications
   for result limits, ambiguity, and conflicts remain content-free.

## Tests and validation

Use only synthetic IDs, names, timestamps, query strings, and content. Add focused fake coverage:

- `tests/application/markdown-service.test.ts`: nested direct/recursive list; selected folders;
  recursive deterministic search; nested path and ID reads; default direct-root compatibility;
  duplicate file/folder/path and ID-chain sibling ambiguity; shortcuts, multiple parents, cycles,
  unsafe names, escaped IDs, malformed IDs, and depth rejection; every separate budget category;
  output/list versus search-limit behavior; oversized/text-search completeness; pre/post target and
  ancestor moves/renames/duplicate races that expose no partial metadata, excerpt, or content.
- `tests/drive/google-drive-read-adapter.test.ts`: shared scoped page/node/metadata/media budgets
  across multiple folders; fresh root/Shared Drive validation; nested media reads; folder ETag or
  modified-fact comparison support; exact parent query/corpus behavior; pagination/duplicate
  retention; nested content-search media checks; and zero credential/network/write dispatch.
- `tests/config/service-config.test.ts` and `tests/runtime/server.test.ts`: valid/invalid new
  limits, cross-limit checks, runtime injection into the one adapter/service, and unchanged
  default-disabled writes/credential separation.
- `tests/http/json-api.test.ts` and `tests/mcp/stateless-mcp.test.ts`: nested path/recursive input
  delegation plus stable `RESULT_LIMIT_EXCEEDED`, ambiguity, and conflict terminal outcomes. Assert
  serialized audit/metric data contains no nested path, query, body, excerpt, revision, or budget.

Run focused tests while implementing, then:

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

The authoritative project commands are `package.json`, `ARCHITECTURE.md`, and `AGENTS.md`. Do not
run `pnpm drive:probe`, Docker, Terraform, `gcloud`, remote OAuth/JWKS, or a live endpoint.

## Expected unchanged boundaries

- `src/drive/google-drive-write-adapter.ts`, `src/drive/guarded-drive-write-port.ts`, and
  `src/write-gate/**`: no write authority, single-dispatch mutation, archive, or lease changes.
- `src/auth/**`, Google credential formats/loaders, HTTP/MCP authentication, Terraform, Docker,
  deployment configuration, and client installation/release harnesses: unchanged.
- `src/http/json-api.ts`, `src/mcp/stateless-mcp.ts`, `src/codex-cli/cli.ts`, and
  `src/observability/audit.ts`: retain their public contracts and closed telemetry vocabulary;
  change only if strictly necessary to pass an existing tree input or test the shared outcome.
- `src/live-drive/**`, `tests/live-drive/**`, live evidence examples, and all operator documents:
  unchanged. No live validation record is created.
- `google-drive-markdown-gateway-handoff.md`, feature/task statuses, feature task list,
  `ai/features/epics/google-drive-markdown-gateway/build-log.md`, and vendored skills: unchanged.

## Risks and careful checks

- Do not mistake a root cache, a file ETag, or a fake transaction for an atomic ancestor guarantee.
  The documented pre/post model is the boundary of the claim.
- Do not let a helper allocate a fresh budget for every chain check, content scan, or folder. Tests
  must prove all such calls share the same scope.
- Do not push `fullText` search to Drive or trust provider ordering. The service owns bounded
  recursive traversal, local matching, duplicate detection, and deterministic ordering.
- Do not silently skip a candidate that could affect uniqueness or content-search completeness.
  Skip only files that are definitively ineligible for Markdown output, while retaining structural
  facts and applying the explicit incomplete-search outcome where a body could match.
- Re-read the current tree immediately before implementation: task 002+ are expected to alter
  runtime/write composition, and this spec must remain focused on task 001's read foundation.

## Open questions

None. Exact private class/type names may be chosen during implementation, provided they retain the
single scoped-session model, bounds, and public behavior above.
