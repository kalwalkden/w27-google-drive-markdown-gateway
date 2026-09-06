# Google Drive Read Adapter — Implementation Plan

## Scope

Implement the real, read-only Google Drive adapter behind the domain/application boundary. It must use
`googleapis` and `google-auth-library`, support Shared Drive ADC and injected My Drive OAuth
refresh-token credentials, validate/cache the configured root folder ID, and implement the
finalized port's metadata lookup, direct-child listing, and bounded Markdown content read
operations.

It has no HTTP/MCP/CLI endpoint, no secret provisioning, no Drive create/update/archive call, and
no production write enablement. Until task 003 proves a precondition mechanism, every write-port
method returns the finalized contract's `unsupported` result without network I/O.

## Binding decisions and constraints

| Decision | Implementation effect | Provenance |
| --- | --- | --- |
| `MarkdownService` owns policy. | Implement the finalized `DrivePort`; do not duplicate path parsing, Markdown filtering, relative-path construction, locator authorization, or public errors. | Feature/task brief; task 001 |
| Reads only. | Production code may call only `files.get` and `files.list`. Write-port methods make no Google request. | Task brief; Epic 0 capability gate |
| Root is an ID. | Require the configured opaque root ID; fetch/validate it using a concurrency-safe cached promise. Never resolve a root by name/path. | Task brief; handoff |
| No atomic ancestor precondition. | Public list, search, and content reads are limited to direct children of the configured root. Recursive/nested operations fail closed. A media read re-fetches exact node facts, including raw ETag/revision and parent, after download before returning content/excerpts. | Independent rereview; Drive API constraints |
| Separate Google modes. | ADC uses `GoogleAuth`; refresh mode constructs `OAuth2Client` from injected secret values. Shared Drive root must have `driveId`; My Drive root must not. | Feature constraints; Google docs |
| Secrets remain external. | The composition root injects refresh credentials. No environment/repository secret loading, no logging/stringifying of credentials, access tokens, raw Google errors, or content. | `AGENTS.md`; task brief |
| Shortcuts/ambiguity fail closed. | Map shortcut MIME type to `shortcut`, never dereference its target, and retain all direct children so the service can reject duplicates. | Task 001 contract; feature |
| Bounded UTF-8 content. | Reject over-limit metadata/actual media byte length and decode only with fatal UTF-8. No replacement characters, partial bodies, or content logs. | Handoff; task brief |
| Stable errors. | Wrap Drive failures as a typed provider error with safe classification, HTTP status where available, and operation only. Existing application code maps it to public domain errors. | Task brief; task 001 boundary |

## Visual design

No visual design applies. This is an internal provider adapter.

## Current-tree alignment

Task 001 is concurrently establishing the binding port surface:

- `src/domain/markdown.ts`: opaque `FileId`, `FolderId`, `Revision`, domain helpers/errors.
- `src/drive/drive-port.ts`: `DrivePort`, `DriveNode`, `DriveRead`,
  `DriveSearchHit`, `ConditionalWriteResult`.
- `src/drive/in-memory-drive-port.ts`: fake used by ordinary domain/application tests.

Read the final symbols and tests immediately before editing. Adapt this plan to that public surface; do
not add parallel contracts. The adapter supplies provider facts to `MarkdownService`, but its own
queries are root-scoped by construction.

## Detailed implementation approach

### 1. Add an injectable auth/client factory

Add `googleapis` as a production dependency. Create a small auth module and adapter (suggested
`src/drive/google-drive-auth.ts` and `src/drive/google-drive-read-adapter.ts`).

- Shared Drive config creates `GoogleAuth` with the least read scope that supports metadata,
  directory listing, and literal media reads. It uses ordinary ADC resolution; deployment later
  provides an attached identity or another external ADC source.
- My Drive config accepts already-mounted `clientId`, `clientSecret`, and `refreshToken`;
  creates `OAuth2Client`, sets refresh credentials, and gives it to
  `googleapis.drive({ version: "v3", auth })`.
- Separate client construction from the adapter. Unit tests inject a tiny `files.get/list` façade
  and must never acquire a token or contact Google.
- Imports and construction are side-effect free. A token exchange occurs only on a port call.

Do not import `src/live-drive/**`. Its raw HTTP probe and secret-file loader are a separate,
write-capability test harness, not the production adapter.

### 2. Validate/cache a root context

The adapter takes an explicit root `FolderId` plus safe max read bytes and traversal bounds. Before
root-scoped behavior, fetch minimal metadata and verify the ID is exactly the configured root, a
non-trashed real folder, and not a shortcut. Then verify topology:

- Shared Drive config requires root `driveId`; cache it and query that corpus.
- My Drive config requires no root `driveId`.

Cache only validated root context and coalesce concurrent initialization. Use an explicit TTL or
invalidation hook so a later call revalidates. Never cache a failure as success. A mode/topology
mismatch is a safe structured provider failure.

### 3. Use a closed Google API façade

Use only `drive.files.get` and `drive.files.list`. Request only the fields required for the
final `DriveNode`/`DriveRead` facts: ID, name, MIME type, parents, modified time, size, version,
head revision ID if selected as opaque revision, trashed state, drive ID, and shortcut details.
Do not request permissions, owners, descriptions, full text, or generic resource objects.

Normalize records:

- folder MIME type → `folder`;
- `application/vnd.google-apps.shortcut` → `shortcut`, with no target traversal;
- another stored Drive file → `file` with opaque ID/parents/revision, parsed byte size, and
  modified time.

A missing required ID, parent, timestamp, size, or revision is malformed for any operation that
needs it. Wrap Google errors at this seam: 401/403 access/auth, 404 missing, 429 throttled,
5xx/timeout transient upstream, and malformed success provider-malformed. Retain only operation,
classification, and optional status—not IDs, URLs, body, credentials, or stacks.

### 4. Root-confined metadata/list/search

`getNode(id)` supports the service's ID-ancestry check. It fetches metadata only and does not itself
authorize/expose the item; the service must verify its parent chain before it reads or returns it.

Every `listChildren(folderId)` starts after validated root context and uses exactly:

```text
'<escaped folder ID>' in parents and trashed = false
```

Always set `supportsAllDrives: true`. For Shared Drive set `corpora: "drive"`, validated
`driveId`, and `includeItemsFromAllDrives: true`; for My Drive use `corpora: "user"`. Paginate
to completion under explicit directory/traversal caps. If a cap or page continuation is exceeded,
fail rather than hide a duplicate through a partial listing.

`listDescendants` remains available for provider diagnostics, but the application never exposes it
for public recursive reads because no Drive precondition binds an ancestor chain to a later media
download.

`searchDirectChildren` is the public read contract and enumerates direct children only;
`searchDescendants` is compatibility-only and retains the same direct-child behavior. Do not use
Drive `fullText contains`; it is not descendant-scoped. Bounded content/excerpt matching
downloads only direct-root Markdown files through the verified media-read path, applies the same
byte/UTF-8 limits, and returns surrogate-safe excerpts with no logs.
Never silently claim a complete search after truncation.

### 5. Content reads and unavailable writes

`readFile(fileId)` gets/validates metadata first and requires exactly the configured root as its
sole parent. It re-fetches exact metadata after media transfer and rejects any changed ID, name,
kind, parent, MIME type, size, modified time, or raw ETag. Reject folders, shortcuts, trashed items,
missing/non-numeric/over-limit size, and absent revision before requesting media. For valid literal
Drive content call `files.get({ fileId, alt: "media", responseType: "arraybuffer",
supportsAllDrives: true })`; bound actual byte length and decode with
`new TextDecoder("utf-8", { fatal: true })`. Return only a complete validated `DriveRead`.
Do not export Google Docs/Sheets/Slides.

`createFile`, `updateFile`, and `moveFile` return unsupported with zero Google calls. Do not
reuse raw `If-Match` code, infer a revision scheme, or add a read-then-write fallback.

### 6. Tests

Add focused fake-only tests (for example
`tests/drive/google-drive-read-adapter.test.ts` and `tests/drive/google-drive-auth.test.ts`):

- ADC/refresh construction selects intended auth form without token exchange/network/real secrets.
- Root validation accepts only matching non-trashed folders; cache coalesces success, invalidates
  safely, and never promotes failure.
- Lists use the exact parent predicate, `trashed = false`, narrow fields, pagination,
  `supportsAllDrives`, and correct corpus flags.
- Recursive list/search never use global/full-text queries, do not follow shortcuts, retain
  duplicates, obey bounds, and fail instead of returning incomplete safety-critical listings.
- Metadata lookup is metadata-only; read uses media only after valid metadata; oversize, malformed
  fields, malformed UTF-8, and external errors become safe failures.
- 401/403/404/429/5xx/timeout/malformed response do not expose IDs, URLs, credentials, bodies, or
  raw error payloads.
- Write methods return unsupported without touching the fake API.

An optional live-read harness is not required. Task 0 already owns the explicit, external,
sanitized capability harness. Do not run a live test while implementing this task.

## Expected flow and invariants

```text
future transport
  -> MarkdownService (path/ID ancestry and Markdown policy)
  -> GoogleDriveReadAdapter : DrivePort
  -> validated cached root context
  -> exact parent-scoped files.list / minimal files.get
  -> normalized DriveNode / DriveRead or safe provider failure
```

- No global corpus query, shortcut dereference, write request, or automatic live test is introduced.
- Root is the configured immutable opaque ID; name collisions/renames cannot alter the boundary.
- Shared Drive lists use the validated root's Drive ID; My Drive lists use exact parents.
- A direct ID metadata read is only input to service ancestry verification, never authorization.
- Actual document content is complete, byte-bounded, valid UTF-8 before it reaches the service.
- Google writes remain disabled regardless of adapter read success.

## Expected unchanged boundaries

Keep `src/application/**`, `src/domain/**`, and `src/drive/in-memory-drive-port.ts` under task
001 ownership except for minimal final-contract reconciliation. Do not change `src/live-drive/**`,
`tests/live-drive/**`, or the capability harness docs. `src/index.ts`, HTTP/MCP/CLI transport,
deployment, Secret Manager wiring, write/archive logic, and task statuses are out of scope.

## Validation

```bash
CI=true pnpm test -- tests/drive/google-drive-read-adapter.test.ts
CI=true pnpm test -- tests/drive/google-drive-auth.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

If only one focused test file exists, run that file. Inspect final changes for credentials,
token-shaped strings, generated output, unexpected Drive write methods, broad query parameters,
`src/live-drive` imports, or changes outside adapter/dependency/test/spec scope. Do not run
`pnpm drive:probe`.

## Risks and open questions

- Task 001 is active in the shared tree. Re-read the final port/error symbols immediately before
  implementation and use them rather than preserving stale plan names.
- For content search, obey the final port semantics. Default to name matching; only add bounded
  post-enumeration content matching if the contract requires it.
- No live credentials/test root are supplied. Fakes prove implementation behavior; task 0's probe
  remains the external integration gate.
