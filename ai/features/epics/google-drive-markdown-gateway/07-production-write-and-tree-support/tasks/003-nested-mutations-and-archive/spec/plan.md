# Nested Mutations and Archive — Implementation Plan

## Scope

Enable nested `create_markdown`, `update_markdown`, and `archive_markdown` through the one
`MarkdownService` and the one writer composed by task 002. Every mutation uses task 001's
request-scoped read/topology model to establish and recheck the relevant tree state, dispatches
at most one raw Drive mutation, and returns a stable reconciliation result if the post-dispatch
state cannot be proved.

The baseline is committed HEAD `e36ccaba9d7070e35b146bfd965e62880f8b7a8f`. At that revision,
the service permits only direct-root create/update, archive is always `UNSUPPORTED`, the raw
adapter collapses post-dispatch failures to `unsupported`, and runtime withholds sessions from
both transports. Tasks 001 and 002 have approved specs but no committed implementation at this
baseline. Implement task 003 only after verifying and retaining their final scoped-read and
default-off writer contracts.

## Binding decisions and constraints

| Decision | Implementation effect | Provenance |
| --- | --- | --- |
| One service owns every mutation policy. | JSON, MCP, and CLI validate/serialize only; all locator resolution, topology proof, collision checks, dispatch choice, and postconditions live in `MarkdownService`. No transport gains a Drive port or its own retry path. | Feature requirements; handoff; task brief. |
| A mutation has exactly one provider dispatch at most. | Complete the precheck, then repeat the time-sensitive facts immediately before calling one guarded raw create/update/move method. Never retry, fall back to unconditional write, roll back, clean up, or issue a second mutation after any result. | Feature decisions, operation flow, task brief. |
| Tasks 001 and 002 are dependencies, not assumptions about current code. | Reuse task 001's final request-local read scope, topology snapshot, unique sibling proof, and limits; reuse task 002's process-local `MarkdownWriteSession`, authenticated raw writer, and `write.enabled` composition. Do not restore direct-root methods, lease authority, or read-only session withholding. | Earlier approved task specs; committed-head inspection. |
| Exact revisions are an application precondition. | Update/archive require a nonempty well-formed caller revision equal to the source's verified pre-dispatch revision. The raw update/move receives that exact opaque value as `If-Match`; only HTTP 412 is the normal post-dispatch `CONFLICT` result. | Feature topology and write decisions; handoff. |
| Every mutation resolves a unique, root-confined topology. | A path or ID source must have one safe-name sibling mapping at each root-to-leaf segment, one exact parent per non-root node, no shortcut, cycle, multi-parent, malformed metadata, or root escape. Archive additionally resolves the configured archive ID as a unique descendant folder chain. | Feature requirements and topology decisions; task 001 plan. |
| Create and archive prove complete target-name absence. | Enumerate the entire destination parent through the shared scope before, and again immediately before, dispatch. Any same-name file or folder blocks create. Archive blocks any different same-name item in the archive folder. | Feature duplicate-name decision; task brief. |
| An already archived source is a verified no-op success. | If the source is directly in the configured archive folder, its exact revision, singleton parent, archive chain, and destination-name uniqueness must all pass. Return current metadata and perform no provider mutation. | Feature duplicate-name decision; task brief caveat. |
| A post-dispatch state that cannot be proved is not `UNSUPPORTED`. | Add stable `OUTCOME_UNKNOWN`. A network/timeout/throw after raw dispatch, non-412 non-success response, malformed success, unexpected raw outcome, or any failed postcondition becomes `OUTCOME_UNKNOWN`; no raw provider detail is exposed. | Feature success criteria and topology decision; operation flow. |
| Pre-dispatch drift is safe and non-mutating. | A stale target revision or a changed target/parent/ancestor fact is `CONFLICT`; a newly ambiguous path is `AMBIGUOUS_PATH`; an out-of-root/invalid topology retains its safe existing domain failure; a destination collision is `INVALID_PATH` for one conflicting item and `AMBIGUOUS_PATH` for duplicate same-name items. No raw call occurs. | Feature decisions; existing create collision convention. |
| Public unknown state tells clients to reconcile, never retry. | JSON and MCP expose a fixed `OUTCOME_UNKNOWN` error directing callers to read by the supplied stable ID/path before any further mutation. The CLI emits the same parsed code plus a `recovery: { action: "read", locator }` field and uses a dedicated exit code. A route timeout/CLI transport failure is also a reconciliation state, even where no server `OUTCOME_UNKNOWN` envelope can be received. | Feature trusted-concurrency assumptions; task brief. |
| Both authenticated transports receive one enabled session. | When task 002's `write.enabled` is true, runtime creates one frozen session from the shared service and supplies the same `WriteSessionProvider` instance to JSON and MCP. When disabled, retain no provider/session and the existing `UNSUPPORTED` response. | Feature runtime-write decision; task 002 plan; task brief. |
| Telemetry remains closed and content-free. | Add only `outcome_unknown` to the terminal audit/metric result vocabulary. Do not emit paths, queries, content, excerpts, revisions, folder IDs, provider status/payload, dispatch count, configuration, credential, or raw response. | Feature constraints; observability contract. |

## Visual design

Use the approved feature-level runtime branch in
`ai/features/epics/google-drive-markdown-gateway/07-production-write-and-tree-support/visuals/operation-flow.md`.
There is no UI work. For this task, the write branch is: resolve unique source/destination and
revision; recheck; dispatch once; prove the returned file and ancestry; otherwise require a reread
and reconciliation. It is explicitly not a cross-resource transaction.

## Mutation model and invariants

### Shared topology facts

Use the final task-001 topology snapshot rather than adding a parallel unbounded resolver. A
snapshot is the ordered root-to-node chain and records stable ID, safe name, kind, exact parent,
revision/modified facts where available, MIME/size facts, and the proof that each selected child is
the only sibling with that safe name. The scoped session's single budget covers root validation,
all metadata/list operations, source/archive chains, destination enumeration, immediate rechecks,
and postconditions. A limit/incomplete enumeration is `RESULT_LIMIT`, never an absence or a partial
mutation decision.

The source may be located by relative path or stable file ID. ID resolution must still reconstruct
and prove its canonical unique path. A mutation source is a regular Markdown file with a required
current revision, allowed size, exactly one parent, and a verified root chain. The archive folder is
not trusted merely because it is configured: resolve it by ID as a safe folder with a unique chain
from the configured root, and reject it if it is root, a shortcut, multi-parented, cyclic, escaped,
or otherwise not a unique descendant.

Before dispatch, compare a fresh snapshot to the prior one. For update, this covers the source and
its full chain. For create, it covers the selected parent and its full chain plus a complete fresh
same-name absence. For archive, it covers source/source chain, archive/archive chain, and complete
fresh absence in the archive folder. A changed expected revision is `CONFLICT`; a source parent
change is also `CONFLICT` rather than a second move attempt. A provider malformed response before
dispatch remains the existing redacted provider/domain failure; it must not be relabelled as an
unknown mutation.

### Create

1. Parse the Markdown path and validate UTF-8 content and configured byte limit before provider
   work. Resolve its parent (root is allowed) as a verified folder chain and fully enumerate its
   children. Reject a present leaf name without dispatch: one occupant is `INVALID_PATH`; multiple
   same-name occupants are `AMBIGUOUS_PATH`.
2. Immediately re-resolve/recompare the parent chain and repeat the complete name-vacancy check.
   A changed parent topology is `CONFLICT`; a new collision uses the collision results above.
3. Call guarded `createFile(parentId, leaf, content)` exactly once. The raw result must distinguish
   a known pre-dispatch `unsupported` capability from an uncertain dispatched outcome.
4. On a nominal success, fetch and verify the returned ID through its unique chain. It must be a
   regular Markdown file with the requested safe name, supplied content byte size, nonempty new
   revision, exactly the selected parent as its only parent, one canonical requested path, and a
   stable full root chain. Return metadata from the verified post snapshot, not the raw response.
   Any missing, changed, malformed, mismatched, or unprovable post fact is `OUTCOME_UNKNOWN`.

### Update

1. Validate locator, expected revision, UTF-8 content, and byte limit. Resolve the source to a
   verified Markdown topology snapshot and require its exact pre revision equals
   `expectedRevision`; otherwise return `CONFLICT` before dispatch.
2. Immediately resolve/recompare the source and full ancestry. A revision or topology drift is
   `CONFLICT`/safe topology failure with no mutation.
3. Call guarded `updateFile(fileId, expectedRevision, content)` exactly once. Map a raw 412
   `conflict` to `CONFLICT` and do not retry; do not expose any optional raw `current` node unless
   it independently passes a read operation (this task keeps the existing public conflict envelope).
4. On nominal success, re-resolve the returned source by ID and compare it to the post snapshot:
   same file ID/name/single parent/canonical path/full ancestry, requested byte size, valid new
   revision different from the expected revision, and unchanged topology except the legitimate file
   mutation facts. Return verified metadata. Any non-412 failure or failed postcondition is
   `OUTCOME_UNKNOWN`.

### Archive

1. Validate locator and expected revision, resolve source and configured archive folder as unique
   descendant chains, require source Markdown/current revision equality, and fully enumerate the
   archive folder. The archive folder must be distinct from root and have a safe unique chain.
2. If the source is already directly in archive, accept only when it is the unique child with that
   name, has the exact expected revision, and its archive chain still passes; return its current
   verified metadata without raw dispatch. If another archive child has the source name, reject it
   as the same destination collision (`INVALID_PATH` for one, `AMBIGUOUS_PATH` for duplicates).
3. Otherwise immediately recheck source/source chain, archive/archive chain, source revision, and
   complete destination vacancy. A source/ancestor/revision change is `CONFLICT`; newly invalid or
   ambiguous topology keeps the appropriate safe error. Do not move after a failed recheck.
4. Call guarded `moveFile(fileId, expectedRevision, exactSourceParentId, archiveFolderId)` exactly
   once. It must use the adapter's conditional `If-Match`, `removeParents`, and `addParents` form;
   there is no trash, delete, rename, cleanup, or rollback path.
5. On nominal success, verify by ID that the same Markdown file has exactly one parent equal to the
   archive folder, requested name, a new valid revision, destination sibling uniqueness, and the
   archive's full verified chain. Fully enumerate the old source parent and prove it no longer
   contains that file ID. Any failed or unprovable postcondition is `OUTCOME_UNKNOWN`.

No sequence above claims an atomic file-plus-ancestor transaction. The pre/post checks detect
ordinary races; a trusted administrator moving an ancestor out and back between checks remains the
explicit residual risk from the feature plan.

### Raw-write result boundary

Extend `CreateWriteResult` and `ConditionalWriteResult` with a distinct dispatched-uncertainty
variant (exact internal spelling is an implementation detail, e.g. `{ outcome: "unknown" }`). Keep
`unsupported` only for a disabled/non-authentic writer or input rejected before its raw send. In
`GoogleDriveWriteAdapter`, increment no retry counter and send once. A 2xx response is success only
if strict metadata/ETag parsing succeeds; update/move HTTP 412 is `conflict`; every raw-send throw,
timeout, malformed 2xx, other HTTP response, or other non-success after `send()` begins is
`unknown`. Preserve the adapter as the owner of Drive URLs, multipart encoding, quoted `If-Match`,
and response parsing.

`MarkdownService` converts raw `unknown`, a thrown writer call after dispatch, or a nominal success
whose final state cannot be proved into `MarkdownGatewayError("OUTCOME_UNKNOWN", fixedMessage)`.
It must never issue a read-modify-write retry or unconditional rollback. Do not use `UNSUPPORTED`
to hide uncertainty.

## Public contract parity

The successful metadata response shape remains exactly `relativePath`, `fileId`, `revision`,
`modifiedTime`, and `size`; create remains HTTP 201, update/archive HTTP 200. Conflict remains the
existing redacted error-only response (HTTP 409 / `CONFLICT`) rather than returning an unchecked
provider `current` object.

Add `OUTCOME_UNKNOWN` to the domain and both public error unions with this fixed public message:
`"Mutation outcome is unknown. Read the document again before any further mutation."`

| Boundary | `OUTCOME_UNKNOWN` contract | Existing timeout guidance |
| --- | --- | --- |
| JSON | HTTP 503, `{ ok: false, operationId, error: { code: "OUTCOME_UNKNOWN", message: fixedMessage } }`, audit result `outcome_unknown`. | HTTP 504 stays `REQUEST_TIMEOUT`; clients must reread/reconcile because a dispatched Drive call cannot be cancelled. |
| MCP | Tool error with code `OUTCOME_UNKNOWN`, the same message, `isError: true`, and `outcome_unknown` terminal telemetry. | Protocol/request timeout remains a reconciliation state; no automatic tool retry. |
| Codex CLI | Strictly accept exactly the HTTP 503/code/message pair; emit parsed error plus `recovery: { action: "read", locator }`; return exit code **9**. Preserve 6 for unauthenticated, 8 for conflict, and 7 for other accepted gateway failures. | An HTTP `REQUEST_TIMEOUT` response and a local transport timeout must not trigger automatic retry; surface the existing failure and require a manual reread/reconcile. |

Add the same `recovery` object for `CONFLICT` (existing behavior) and `OUTCOME_UNKNOWN`; keep the
JSON service envelope free of raw revision/current/provider data. Do not add task-004-owned Work or
Codex instruction/runbook rewrites here; only the runtime/API/MCP/CLI machine contract required for
safe behavior changes in this task.

## Detailed implementation sequence

1. Rebase the service and test fakes onto the completed task-001 scoped read/topology contract and
   task-002 no-lease guarded writer contract. Remove direct-root mutation guards and do not retain a
   compatibility mutation path that bypasses scoped checks.
2. Add the raw write `unknown` result and update the Google/in-memory/guarded write seams so each
   operation has observable one-dispatch behavior. Preserve 412-only conflict and task-002's
   authenticated no-retry raw transport.
3. Implement shared snapshot/recheck helpers in `MarkdownService`, then create, update, and archive
   flows above. Keep pre-dispatch errors distinguishable from post-dispatch uncertainty.
4. Wire one enabled `MarkdownWriteSession` provider into both runtime transports. Confirm disabled
   composition still builds no session and exposes only `UNSUPPORTED` writes.
5. Extend domain, JSON, MCP, CLI, audit, and metrics closed unions for `OUTCOME_UNKNOWN`; add strict
   parser/exit/recovery coverage without changing success envelope shapes.
6. Run focused fake tests and project validation. Do not alter feature status/tasks, build log,
   commits, runtime deployment configuration, live harnesses, credentials, or cloud state.

## Test strategy and exact validation

Use in-memory topology/race fakes, fake raw HTTP, injected runtime factories, local Express/MCP
test transports, and inert sentinel text only. No test may obtain a credential, call Google Drive,
invoke Work/Codex remotely, run the live probe, deploy, apply Terraform, or use real secrets.

- `tests/application/markdown-service.test.ts`: nested create/update/archive by path and ID;
  direct-root compatibility; exact revision prechecks; archive descendant verification and the
  already-archived no-op; root/nested destination collisions; duplicate sibling/canonical names;
  shortcuts, multi-parent nodes, cycles, unsafe names, escaped archive, and scope-limit failures.
  Add adversarial hooks that alter source, ancestor, archive chain, sibling names, or destination
  between initial check/recheck and after dispatch. Assert no raw call for every precheck failure,
  exactly one for a dispatched request, and no returned metadata/content after an unknown outcome.
- `tests/drive/google-drive-write-adapter.test.ts`: assert exact one POST/PATCH and exact
  `If-Match`/parent query construction; 412 only maps conflict; network throws, non-412 status,
  malformed 2xx, invalid ETag/metadata, and timeout-like fake outcomes map `unknown`; no retry.
- `tests/drive/guarded-drive-write-port.test.ts` and `tests/drive/in-memory-drive-port` coverage:
  authentic enabled dispatch exactly once, disabled/forged/proxied writer no dispatch, and updated
  raw unions preserve unambiguous pre-dispatch `unsupported` versus post-dispatch `unknown`.
- `tests/runtime/server.test.ts`: task-002-enabled config builds one shared service/writer/session;
  JSON and MCP receive the same provider/session reference only when enabled; disabled configuration
  exposes neither. Keep all credential/token/send seams fake and assert composition failures occur
  before listening.
- `tests/http/json-api.test.ts` and `tests/mcp/stateless-mcp.test.ts`: all three enabled writes use
  injected session delegation; JSON/MCP success/error schemas and status parity; `OUTCOME_UNKNOWN`
  is fixed/redacted and classified once; no audit or metric serialization contains sentinel path,
  content, revision, archive ID, provider status, or payload. Preserve `REQUEST_TIMEOUT` behavior.
- `tests/codex-cli/cli.test.ts`: strict 503 `OUTCOME_UNKNOWN` response parsing, exit 9, locator
  recovery, conflict compatibility, rejection of changed status/message/schema, and no client retry
  on timeout/transport failure.
- `tests/domain/markdown.test.ts` and `tests/observability/audit.test.ts`: closed new domain/audit
  vocabulary only, with no unapproved labels or sensitive data.

Run from repository root:

```bash
./scripts/verify-vendored-skills.sh
CI=true pnpm test -- tests/application/markdown-service.test.ts
CI=true pnpm test -- tests/drive/google-drive-write-adapter.test.ts tests/drive/guarded-drive-write-port.test.ts
CI=true pnpm test -- tests/runtime/server.test.ts tests/http/json-api.test.ts tests/mcp/stateless-mcp.test.ts tests/codex-cli/cli.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
CI=true pnpm check
git diff --check
```

The command set is authoritative in `AGENTS.md`, `package.json`, and `ARCHITECTURE.md`. Do not run
`pnpm drive:probe`, Terraform, Docker, `gcloud`, remote OAuth/JWKS, or any live Drive/Work/Codex
endpoint.

## Current-tree deviations and risky edges

- Current HEAD has task-001 direct-root `DriveReadPort` methods and task-002 lease-gated writer
  code. Those are intentionally obsolete for this task; do not implement against them as though
  they were final. Verify the completed dependent contracts first.
- Current `GoogleDriveWriteAdapter.send()` catches and turns raw exceptions into `unsupported`.
  That is unsafe after dispatch and must become a distinct unknown result without adding a retry.
- Current raw successful metadata may be valid but cannot alone prove stable ancestry. It is only a
  postcondition input; return service-fetched, verified metadata.
- Current HTTP route deadlines can fire while a writer promise is in flight. The route must remain
  one-response/no-retry; a late mutation is why timeout clients reconcile rather than retry.
- Task 004 owns client prose, operator release harness execution, broader runbooks, and live
  validation. Keep those outside this spec's edit surface.

## Open questions

None. The implementer must verify final task-001/002 symbol names and adapt this plan without
weakening its scoped topology, single-dispatch, default-off, or reconciliation invariants.
