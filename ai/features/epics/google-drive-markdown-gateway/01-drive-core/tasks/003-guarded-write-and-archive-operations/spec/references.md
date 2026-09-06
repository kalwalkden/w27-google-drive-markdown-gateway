# Guarded Write and Archive Operations — References

## Primary edit targets

Task 002 is complete and committed. Re-read its final symbols before implementation; only the two
planned writer files below are not yet present.

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `src/application/markdown-service.ts` | `MarkdownService`, private resolution/mutation helpers | Retain every document policy check while moving mutation calls behind an ephemeral write session. |
| `src/domain/markdown.ts` | mutation result/error contracts | Add safe optional conflict metadata only if needed; preserve existing DTOs and stable codes. |
| `src/drive/drive-port.ts` | read, raw-mutation, guarded-writer contracts | Remove unguarded mutation capability from the application-facing boundary and make outcomes explicit. |
| `src/drive/guarded-drive-write-port.ts` (new) | `GuardedDriveWritePort`, disabled writer | Owns last-moment `WriteGate.validateLease` and prevents raw-adapter bypass. |
| `src/drive/google-drive-write-adapter.ts` (new) | Google create/update/archive dispatch | Implements exact ETag/`If-Match` calls and safe provider-result normalization. |
| `src/drive/google-drive-auth.ts` and `src/drive/google-drive-read-adapter.ts` | metadata ETag, token/HTTP façade | Completed task-002 work currently normalizes `version` as revision. It must expose raw metadata ETag as mutable-file `Revision`, not version/head revision, and may supply authenticated low-level HTTP. |
| `src/drive/in-memory-drive-port.ts` | fake node/mutation behavior | Reconcile with split ports and retain deterministic conflicts/inspection. |
| `src/write-gate/gate.ts` | `WriteGate`, `WriteLease`, `validateLease` | Reuse; never evaluate approvals in Drive code or persist/serialize leases. |
| `src/write-gate/evidence-proof.ts` | strict atomic proof | Defines why `SUPPORTED` evidence is required and version observation is insufficient. |
| `src/live-drive/drive-client.ts` | proved request shape | Reference exact endpoints, raw ETag pass-through, all-drive flag, no retry; never import harness into production. |
| `src/live-drive/probe.ts` | stale-content/stale-parent protocol | The dedicated-root experiment that authorizes no automatic runtime behavior. |
| `tests/application/markdown-service.test.ts` | service policy coverage | Update direct mutation calls to session-based writes and cover stable safe conflict behavior. |
| `tests/drive/guarded-drive-write-port.test.ts` (new) | lease-at-dispatch tests | Proves timing/default deny/zero calls/no bypass. |
| `tests/drive/google-drive-write-adapter.test.ts` (new) | scripted request/response tests | Proves exact request shape, 412 mapping, ETag preservation, and no mutation retry. |
| `tests/write-gate/*.test.ts` | composition test | Synthetic evidence/test keys prove no lease means no raw mutation. |

## Entry point and call path

```text
future transport composition
  -> WriteGate.evaluate(external evidence bytes + approval)
  -> WriteLease (memory only)
  -> MarkdownService.openWriteSession(lease)
  -> MarkdownWriteSession.create/update/archive(public DTO)
  -> MarkdownService root/Markdown/duplicate/revision/archive validation
  -> GuardedDriveWritePort.validateLease immediately before raw write
  -> Google conditional HTTP adapter
```

Read path remains independent:

```text
future transport -> MarkdownService.list/search/read -> Drive read adapter
```

There is no path from transport to raw writer. No public document input/result contains lease, JWS,
evidence, trust, or a raw HTTP header.

## Contracts, state, and invariants

- `WriteLease` is opaque, short-lived, process-local, and invalid after restart. It exists only in
  `MarkdownWriteSession` and its guarded writer call.
- `MarkdownWriteSession` accepts existing document DTOs and returns existing document shapes. It is
  not a durable serializable resource.
- `GuardedDriveWritePort` alone is visible to `MarkdownService` as writer. It validates lease then
  dispatches exactly one raw mutation request.
- The raw writer accepts already verified IDs/content/revision only; it never resolves a path or
  arbitrarily selects a parent.
- Live mutable `Revision` is exact raw metadata ETag. `version` and `headRevisionId` never become
  `If-Match` values.
- Update/archive pass the caller-read ETag byte-for-byte; HTTP 412 maps to `CONFLICT`, with no
  second mutation.
- Create rejects matching/ambiguous direct siblings. A concurrent duplicate gives later
  `AMBIGUOUS_PATH`; it does not select or overwrite either file.
- Archive moves from verified parent to verified archive only. It cannot delete, trash, share, or
  change permissions.
- Absent writer/trust/replay, invalid/expired/replayed lease, ineligible evidence, malformed ETag,
  and non-412 provider failure all mean `UNSUPPORTED` with zero raw mutation dispatches.
- Tests/configuration do not load credentials, probe outputs, JWSs, trust values, or real IDs.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/application/markdown-service.ts` | root-confined resolution, duplicate rejection, revision/archive checks | Keep one policy owner; extract private helpers into session rather than reproduce them in adapter. |
| `src/drive/in-memory-drive-port.ts` | immutable snapshots, monotonic revision, unchanged conflict state | Retain deterministic fake behavior but route mutation through gate/session wrapper. |
| `src/write-gate/gate.ts` | external evaluation versus synchronous lease validation | Evaluation is composition; dispatch validation is guarded writer. |
| `src/write-gate/evidence-proof.ts` | exact supported/cleanup/stale-412/readback proof | Do not weaken or reinterpret platform condition. |
| `src/live-drive/drive-client.ts` | raw HTTP, all-drive flag, exact ETag | Copy verified request semantics into production-specific injected seam only. |
| `tests/live-drive/drive-client.test.ts` | captured request assertions | Use same fake-first style for writer tests. |
| `tests/live-drive/probe.test.ts` | two-actor stale update/move scripts | Behavioral fixture pattern only, not live-test replacement. |
| `docs/write-gate-and-client-validation.md` | operator-owned authority/replay/trust policy | Preserve fail-closed deployment requirements; add no repository bypass. |

## Tests and fixtures

Use only synthetic IDs, ETags, content, evidence, and generated test keys.

- Session: local invalid/duplicate inputs fail before writer; disabled/invalid/expired lease makes
  zero writer calls; create/update/archive succeed; archive retains ID; safe conflict leaves state
  unchanged; no delete/trash method exists.
- Guarded port: observed order is validation then raw dispatch with nothing between; allowed lease
  gives one call; denied lease gives zero; decorator never evaluates or consumes approval.
- Google adapter: multipart create, media update, parent move, URL encoding, all-drive flags, exact
  weak/quoted ETag, response ETag, 412-only conflict, malformed/no-ETag/auth/quota/5xx/timeout
  denial, and no mutation retry/unconditional archive.
- Scripted dedicated-root timeline: fresh writes succeed; stale content and parent updates return
  412 with unchanged state; simulated `UNSUPPORTED` evidence leaves writer disabled. No network.
- Existing write-gate fixtures may issue an in-memory test lease only; they must never create a
  usable external approval or artifact.

## Expected unchanged boundaries

- `src/index.ts` and `tests/index.test.ts` stay route-free/import-safe. No runtime composition or
  endpoint belongs here.
- `src/live-drive/**`, `tests/live-drive/**`, harness docs/config/examples, and `pnpm drive:probe`
  remain task-002 owned. Do not change or run the probe.
- `src/write-gate/**` authority semantics remain unchanged except minimal type-level integration if
  essential for safe composition.
- Do not add HTTP/MCP/CLI, client auth, secret loading, Cloud Run/Docker/Terraform, rate limits,
  sharing/deletion, real client validation, or migration work.
- Preserve `AGENTS.md`, handoff, skills, feature/task statuses, briefs, and unrelated concurrent
  work. Commit no secret, real evidence, approval, trust material, result path, or document body.

## Validation commands

Commands are authoritative in `package.json`, documented by `ARCHITECTURE.md`, and include the
`AGENTS.md` verifier:

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

Never run `pnpm drive:probe` as task validation. That command remains a separately authorized
operator release gate after deployment configuration.

## Selected external material

These primary sources were checked on 2026-08-29. They describe request forms, but only task-002
sanitized live evidence proves `If-Match` compare-and-swap for a deployment.

| Source | Applicability | License / attribution |
| --- | --- | --- |
| [Drive `files.update`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update) | Media/metadata `PATCH`, `uploadType`, `addParents`, `removeParents`, `supportsAllDrives`; no documented expected-version parameter. | Google Developers CC BY 4.0; samples Apache 2.0. Link/paraphrase only. |
| [Drive `files.create`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create) | Multipart create, Markdown name/MIME, all-drive support. | Google Developers CC BY 4.0; samples Apache 2.0. Link/paraphrase only. |
| [Drive `files.get`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get) | Metadata/media read that must capture raw ETag for mutable revision. | Google Developers CC BY 4.0; samples Apache 2.0. Link/paraphrase only. |
| [Drive File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) | `version`/`headRevisionId` are observations, not documented conditional tokens. | Google Developers CC BY 4.0; samples Apache 2.0. Link/paraphrase only. |
| [Shared Drive support](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives) | `supportsAllDrives=true` for compatible calls. | Google Developers CC BY 4.0; samples Apache 2.0. Link/paraphrase only. |
| [RFC 9110 §13.1.1 `If-Match`](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match) | HTTP condition/412 semantics; Drive support remains empirical. | IETF RFC; link/paraphrase only. |

## Uncertainties to verify before editing

- Preserve completed task-002 behavior and reconcile its actual `google-drive-auth` and
  `google-drive-read-adapter` contracts. Retain raw-ETag `Revision` or leave writer disabled.
- Confirm the Google seam can capture response headers and send `If-Match` exactly. If not, use a
  narrow injected raw HTTP adapter; do not infer safety from a convenience method.
- Check active uncommitted task-002 dependency work before changing packages or lockfile. Preserve
  it and coordinate rather than replace it.
