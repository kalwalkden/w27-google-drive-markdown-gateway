# Guarded Write and Archive Operations — Implementation Plan

## Scope

Implement production-facing create, conditional update, and archive behind the completed
fail-closed `WriteGate`. Reconcile the Drive port with the domain service, add a narrow Google
mutation adapter that uses the exact conditional HTTP mechanism proved by the platform probe, and
make mutations reachable only through a short-lived write session. Add fake-only tests for document
policy, guard timing, request shape, conflicts, and no-retry behavior.

This task adds no HTTP, MCP, CLI, runtime-secret loader, deployment configuration, permanent
deletion, sharing, rename, user-visible merge experience, or automatic live Drive call. It does
not make writes available in a normal local checkout.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| One application boundary owns document policy. | Every create, update, and archive starts in `MarkdownService`; neither a transport nor the Google adapter resolves paths, accepts a caller-selected parent, or calls a mutation directly. | Feature/task brief; handoff; task 001 implementation |
| Production writes default to unavailable. | A service without an externally provisioned guard/writer denies every mutation before any Drive request. No environment flag, local config, evidence file, JWS, or source-controlled switch enables it. | Task brief; `AGENTS.md`; write-gate plan/source |
| `WriteLease` is process-local authority, not document data. | Keep it out of create/update/archive input and result DTOs, metadata, logs, errors, and adapter responses. A separate in-memory write-session object holds it privately. | User requirement; `src/write-gate/gate.ts`; handoff |
| Lease validation occurs immediately before the provider mutation. | A guarded write-port decorator calls `WriteGate.validateLease(lease)` and, after success, invokes the raw adapter in the same synchronous dispatch step with no intervening `await`, lookup, retry, or callback. Denial yields safe unavailable and zero mutation calls. | User requirement; `docs/write-gate-and-client-validation.md` |
| The platform probe is the only conditional-write evidence. | A mutable live file's public opaque `Revision` is the exact raw response ETag proved by task `00-platform-validation/002-live-drive-capability-harness`. Do not substitute `version`, `headRevisionId`, read/compare/write, or a client-library convention. | Platform task 002; `src/write-gate/evidence-proof.ts`; handoff |
| `If-Match` support is conditional. | Create/update/archive remain unavailable unless injected runtime trust, durable replay store, exact sanitized `SUPPORTED` evidence, and one-time signed approval produce a live lease. `UNSUPPORTED`, `INCONCLUSIVE`, malformed, stale, or cleanup-failed evidence can never be overridden. | Write-gate plan/source; task brief |
| Update and archive are one conditional mutation each. | Send the supplied exact ETag in `If-Match` using the same `PATCH` forms proved by the probe. Map only HTTP 412 to stable `CONFLICT`; do not retry, fall back to unconditional mutation, re-read-and-retry, or turn other failure into conflict. | Task brief; platform probe; RFC 9110 |
| Archive is a move only. | Require an expected revision, re-verify archive is a root descendant, reject occupied/ambiguous archive leaf, then issue one conditional `addParents`/`removeParents` move. Never trash, delete, remove all parents, or fall back unconditionally. | Handoff; task 001; task brief |
| Create refuses known targets but Drive filenames are not unique. | Before create, `MarkdownService` lists verified direct siblings and rejects a matching or ambiguous name. A concurrent external duplicate never overwrites content; later path lookup is `AMBIGUOUS_PATH`. Never repair the race through hidden retry, rename, trash, or delete. | Handoff; task 001; Drive API behavior |
| Adapter success must carry a usable ETag. | Each successful mutation produces a regular Markdown node with raw response ETag as next `Revision`; absent/malformed ETag is `UNSUPPORTED`, never synthetic. `version` and `headRevisionId` remain observations. | Platform task 002; Drive File resource |
| Diagnostics are content and secret free. | Retain only stable operation/classification/status at the provider seam. Never log or expose Drive payloads, headers, URLs, IDs, ETags, credentials, lease, evidence, JWS, or Markdown content. | `AGENTS.md`; write-gate docs |

## Visual design

No visual design applies. This task exposes no transport or user interface. Future transports map
stable domain errors and safe conflict metadata without exposing authority or provider details.

## Current-tree alignment and required reconciliation

Task 001 is implemented in `src/domain/markdown.ts`, `src/application/markdown-service.ts`, and
`src/drive/drive-port.ts`. It currently exposes direct mutations and includes write methods in
`DrivePort`; those fake-friendly contracts do not enforce a process-local lease. Refactor them as
below instead of adding a parallel mutation path.

Task 002 of Drive Core is committed in `src/drive/google-drive-auth.ts`,
`src/drive/google-drive-read-adapter.ts`, and `tests/drive/**`. It currently uses Drive `version` as
`Revision`, which is sufficient only for read snapshots and is insufficient for mutation. Reconcile
the adapter so mutable literal Markdown surfaces raw HTTP ETag as `Revision`, or make that document
unavailable for mutation. Preserve the completed read behavior while making this minimal contract
change.

The platform probe and gate are implemented under `src/live-drive/**` and `src/write-gate/**`.
They are evidence/authority components, not the production Drive adapter. Reuse public types and
the exact request behavior; do not load probe output, JWSs, trust values, or secrets from source.

The Google adapter dependency and lockfile are committed by task 002. Avoid unrelated dependency
changes unless the finalized raw HTTP seam requires one.

## Composition and control-flow boundary

Use one explicit capability/session boundary:

```text
future authenticated transport
  -> externally configured WriteGate.evaluate(evidence bytes, parsed evidence, signed approval)
  -> allowed process-local WriteLease
  -> MarkdownService.openWriteSession(lease)
  -> session create/update/archive with ordinary document DTOs
  -> MarkdownService validates path, root, Markdown, size, duplicate/archive policy
  -> GuardedDriveWritePort validates that same lease immediately before mutation
  -> raw Google mutation adapter sends exact conditional Drive request
```

`MarkdownService.openWriteSession(lease)` returns ephemeral `MarkdownWriteSession` with only
`createMarkdown`, `updateMarkdown`, and `archiveMarkdown`. These retain the existing public DTOs;
the lease is a private session field, never an optional parameter or serialized value. Reads remain
on `MarkdownService` and need no lease.

`MarkdownService` receives a read port plus `GuardedDriveWritePort`. The guarded port decorates a
raw mutation adapter and a `WriteGate`, and alone owns last-moment validation. The raw adapter is
not injected into or called by `MarkdownService` or a transport. A disabled guarded writer is the
required default.

Do not validate only when a session opens: locator resolution may take time and a session can
outlive its lease. Revalidate for every dispatch. The decorator performs no provider read or retry
after its validation. A valid lease can authorize further operations only until its expiry.

## Detailed implementation approach

### 1. Separate read facts, raw mutation, and guarded application writes

Reconcile `src/drive/drive-port.ts` rather than retaining an unguarded all-purpose port:

- retain a narrow read port for metadata, traversal/list/search, and literal content;
- define raw create/update/move operations for Google and fake adapters, with explicit `success`,
  `conflict`, and `unavailable` outcomes;
- define `GuardedDriveWritePort` as the only writer accepted by `MarkdownService`; and
- provide a disabled writer that returns unavailable without contacting any delegate.

For a 412, the raw writer may fetch fresh metadata once only to offer safe root-verified current
metadata. It must not retry a mutation. If no safely verified metadata is available, return the
same `CONFLICT` without it. Add a typed safe conflict carrier if needed, but retain the public
`CONFLICT` code and never attach metadata outside root. Guard denial/missing capability is
`UNSUPPORTED`, not `CONFLICT`.

### 2. Put document mutation policy behind a write session

Keep parsing, ID ancestry, Markdown/type/size checks, duplicate refusal, and archive validation in
`MarkdownService`. Extract private mutation helpers for `MarkdownWriteSession` rather than
duplicating policy in an adapter.

- `openWriteSession` does not validate, log, serialize, clone, or expose the lease.
- Invalid/expired/fabricated leases reach guarded dispatch and produce unavailable before raw call.
- Create validates path/content and parent, then rejects matching or duplicate direct siblings.
- Update/archive require nonempty expected revision, resolve current regular Markdown within root,
  and forward exact opaque revision unchanged.
- Archive rejects root/archive misuse and occupied/ambiguous archive name; success preserves ID,
  returns archive-relative path, and has a new raw-ETag revision.
- Post-mutation nodes must remain direct, regular, Markdown, size-valid, root-confined, and carry a
  nonempty raw ETag; inconsistent success is `UNSUPPORTED`.

Do not retain public unguarded `MarkdownService.createMarkdown`, `updateMarkdown`, or
`archiveMarkdown` as compatibility backdoors. Update task-001 tests/callers to use a session. No
public DTO gains lease, approval, evidence, gate reason, or provider header data.

### 3. Implement the guarded writer decorator

Add `src/drive/guarded-drive-write-port.ts` (or a similarly narrow module):

- construct it from `WriteGate` and a raw mutation port supplied only through explicit composition;
- on each mutation call `gate.validateLease(lease)` immediately before `return raw.*(...)`, with no
  `await`, metrics call, metadata refresh, audit persistence, or retry between those statements;
- turn denial into content-free unavailable. Later composition may log only the allowlisted gate
  audit, never return it as document data; and
- never call `WriteGate.evaluate` here: evaluation consumes external approval and belongs at the
  operator-controlled request/composition boundary.

Default `MarkdownService` composition uses the disabled writer. This task deliberately adds no
runtime factory, because deployment-owned trust, evidence, approval delivery, and durable replay
state are still absent.

### 4. Implement exact Google mutation behavior

Add a narrow `src/drive/google-drive-write-adapter.ts`, composed with the finalized task-002 auth/
read seam. It may share injected token acquisition and low-level HTTP, but must test raw behavior:

- create literal `text/markdown` through multipart `POST` with only verified name/parent and
  `supportsAllDrives=true`;
- update content via media-upload `PATCH`, `uploadType=media`, UTF-8 bytes,
  `supportsAllDrives=true`, and exact supplied raw ETag in `If-Match`;
- archive through metadata `PATCH` with exactly one `addParents` archive ID and `removeParents`
  current-parent ID, `supportsAllDrives=true`, and exact ETag `If-Match`; and
- request only node fields needed after mutation, preserve ETag bytes including quotes/weak prefix,
  and map 412 only to conflict. Missing ETag, malformed response, auth/quota/transient/timeout, or
  any non-412 failure is safe unavailable/provider failure—never fallback.

Do not apply `If-Match` to create, synthesize it from version/head revision, use `If-None-Match`,
make global queries, or call `files.delete`/trash. A mutable read without raw metadata ETag is not
eligible for update/archive.

### 5. Preserve the platform gate without executing it

Do not alter `src/live-drive/**`, write evidence, run `pnpm drive:probe`, or add secret/evidence/
approval fixtures. Extend fake tests only:

- synthetic `SUPPORTED` evidence plus injected trust/replay/approval may issue a test lease and
  permit one scripted mutation;
- `UNSUPPORTED`, `INCONCLUSIVE`, malformed, cleanup-failed, wrong-topology, stale, replayed, or
  expired proof cannot issue a lease, so raw mutation call count remains zero; and
- a real operator must run the dedicated-root harness and provision trust/replay/evidence/approval
  outside source control before deployment can construct the guarded writer.

The probe cleanup fallback is operator-harness recovery behavior only; it is never a precedent for
production archive, which has no unconditional fallback.

## Test strategy

All tests are fake-only: no token exchange, filesystem credential read, network, Drive mutation,
probe execution, or signed external approval.

| Test area | Required cases |
| --- | --- |
| `tests/application/markdown-service.test.ts` or focused session test | unguarded unavailable; DTOs exclude lease; local invalid/duplicate inputs fail before writer; create/update/archive success and ID retention; safe conflict/state unchanged; no delete/trash. |
| `tests/drive/guarded-drive-write-port.test.ts` | valid lease dispatches once; fabricated, expired, and post-resolution-expired lease dispatch zero times; validation event directly precedes raw mutation; disabled writer has zero calls; decorator does not evaluate/replay. |
| `tests/drive/google-drive-write-adapter.test.ts` | captured request forms, all-drive flag, exact quoted/weak ETag transfer, response ETag revision, 412 mapping, safe no-ETag/non-412/timeout cases, no retry. |
| scripted adapter integration tests | two actors emulate dedicated marked-root/child-archive flow: fresh writes succeed; stale content/parent requests get 412 with unchanged state; simulated `UNSUPPORTED` evidence leaves writer disabled. No live replacement. |
| `tests/write-gate/*.test.ts` | retain and minimally extend composition with synthetic evidence, generated test keys, and in-memory replay store. |

Use capturing fakes with call counters and ordered events. Every update/archive attempt sends at most
one mutation request, including after 412. Test pre-existing/ambiguous create siblings; document
the unavoidable concurrent-name race as later path ambiguity rather than overwrite/selection.

## Exact validation

```bash
CI=true pnpm test -- tests/application/markdown-service.test.ts
CI=true pnpm test -- tests/drive/guarded-drive-write-port.test.ts
CI=true pnpm test -- tests/drive/google-drive-write-adapter.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

Run actual focused names if they differ. Inspect final changes for writes without `If-Match`, ETags
derived from `version`/`headRevisionId`, unconditional archive fallback, delete/trash/permissions,
credentials, signed approvals, probe results, trust values, evidence paths, content logs, and
changes outside this task plus necessary task-002 contract reconciliation. Do not run live probe.

## Risks and careful checks

- Drive documents request forms, not `If-Match` compare-and-swap. Only sanitized platform evidence
  can establish it for an environment; unit tests never do.
- If the final client seam cannot capture/send raw ETag exactly, leave writes disabled. Do not use
  version metadata instead.
- Pre-create sibling checking is not atomic across external actors. It prevents known-target
  overwrite but cannot reserve a Drive filename; do not hide this with retry/destructive cleanup.
- Durable replay and trust are deployment-owned. Test in-memory replay must never be selected by a
  production composition root.

## Open questions

None. A real environment's eligibility is an external release condition: `UNSUPPORTED` or any
ineligible platform result keeps production writer disabled.
