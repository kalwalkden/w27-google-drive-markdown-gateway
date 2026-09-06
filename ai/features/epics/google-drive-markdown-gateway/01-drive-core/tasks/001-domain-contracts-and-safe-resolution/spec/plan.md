# Domain Contracts and Safe Resolution — Implementation Plan

## Scope

Create the pure TypeScript foundation for the six Markdown operations: list, search, read, create,
revision-checked update, and archive. Define stable domain values and errors, validate Markdown
content and root-relative paths, resolve paths safely through a Drive port, and provide a strict
in-memory fake for application-level tests.

This task performs no Google, HTTP, credential, filesystem, environment, or other external I/O.
It does not decide or enable production writes; the live capability result and guarded Google
adapter are owned by the surrounding Epic 0 and later Drive-core tasks.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| One application boundary owns Drive policy. | Add one `MarkdownService` that every operation uses; transports and provider adapters do not reimplement validation or authorization rules. | Approved feature and task brief; product handoff |
| Six operations are the entire task contract. | Model `listMarkdown`, `searchMarkdown`, `readMarkdown`, `createMarkdown`, `updateMarkdown`, and `archiveMarkdown`, with typed inputs/results and stable error codes. Do not add sharing, deletion, or generic Drive methods. | Product handoff; approved feature |
| Stable IDs and revisions are first-class. | Every returned file metadata object includes opaque `fileId`, `revision`, relative path, modified time, and size where the operation can know it. Update/archive require an expected revision; paths are only lookup inputs. | Product handoff; feature constraints |
| Content is literal Markdown text. | Accept only valid UTF-8 `string` content, require a `.md` filename case-insensitively, and enforce one configurable byte limit with `TextEncoder`. Reject invalid configuration/content before the port is called. | Task brief; product handoff |
| Paths are root-relative and unambiguous. | Normalize slash separators, reject absolute, empty, traversal (`.`/`..`), repeated/hidden-empty segments, NUL/control characters, and non-Markdown file paths. A resolved target must be a direct, non-shortcut child at every segment; duplicate names, non-folder intermediate segments, and root escapes are errors—not arbitrary selection. | Task brief; feature constraints; product handoff |
| IDs and paths converge on authorization. | Path resolution traverses only from the configured root. ID lookup must verify the resolved file is a non-shortcut Markdown descendant of that same root before it can be read, updated, or archived. | Task brief; product handoff safety rules |
| No permanent deletion. | Archive means moving a Markdown file into a configured archive folder beneath the configured root, while preserving the file ID. Reject an archive configuration outside the root or an archive operation on the archive root itself. | Product handoff; repository security guidance |
| Fakes must behave like the policy boundary needs. | Add an in-memory `DrivePort` implementation that represents folders/files/shortcuts, tracks parent relationships and monotonic fake revisions, detects ambiguous names, and exposes deterministic test setup/inspection helpers. It must not silently make unsafe paths appear safe. | Task brief; feature success criteria |
| Existing live harness is separate. | Do not import `src/live-drive/**`, use its credentials, alter its evidence protocol, or turn fake tests into network tests. | Current tree; Epic 0 task boundaries |

## Visual design

No visual design applies. This is an internal domain/application contract with no user-facing UI.

## Product alignment

This task creates the single safety boundary required before transports and a real Drive adapter are
introduced. It intentionally treats a path as a human-facing locator and a Drive ID/revision as the
provider-facing identity/concurrency token. Rejecting ambiguity is more important than being
permissive: an agent must receive a recoverable error rather than a potentially wrong document.

## Detailed implementation approach

### 1. Establish small, opaque domain contracts

Create a `src/domain/` module set (exact file split may remain compact) containing:

- branded or otherwise clearly opaque `FileId`, `FolderId`, and `Revision` values; do not confuse a
  relative path with an identifier;
- `MarkdownFileMetadata` and `MarkdownDocument` result values, with a canonical POSIX-style
  `relativePath`, `fileId`, `revision`, ISO timestamp, and byte `size`;
- six operation input/result types and a bounded search result with a short optional excerpt;
- stable application error code/type (`INVALID_PATH`, `NOT_FOUND`, `AMBIGUOUS_PATH`, `OUTSIDE_ROOT`,
  `NOT_MARKDOWN`, `INVALID_CONTENT`, `FILE_TOO_LARGE`, `CONFLICT`, `INVALID_ARCHIVE`, and
  `UNSUPPORTED` only where the port cannot safely perform an operation). Include safe contextual
  fields, never provider credentials or content;
- pure helpers for `.md` recognition, UTF-8 byte size, strict relative-path parsing, and immutable
  metadata construction.

Choose conservative defaults in an explicit service configuration: a maximum Markdown byte size,
a conservative default `recursive: false`, and a bounded maximum search result limit. Validate all
configuration at construction time. Keep file content as a JavaScript `string`: values received by
the service are UTF-8 encodable by definition; malformed bytes are a provider-adapter concern for
the next task and must be rejected there before constructing a document.

### 2. Define a minimal provider port

Add `src/drive/` contracts for the provider facts the application needs, rather than a public
mirror of Google Drive. The port should support:

- fetching a node by stable ID;
- listing direct children of one folder by exact name and/or listing direct children;
- listing/searching authorized descendants with bounded input supplied by the application;
- reading a file's bytes/text and metadata;
- creating a child Markdown file;
- updating a file conditionally with the expected revision;
- moving a file conditionally between folders.

Provider-node data must identify folder, regular file, and shortcut distinctly; parent IDs, name,
MIME/content classification, modification time, size, revision, and stable ID must be observable.
The port returns provider conflicts as a structured outcome/error so `MarkdownService` can map them
to `CONFLICT`; it must not expose raw provider SDK exceptions as the application contract.

Do not add Google SDK dependencies or a Google adapter. Keep write operations present in the port
so callers compile against the final boundary, while task 003 remains responsible for connecting
them to the proven precondition mechanism.

### 3. Implement `MarkdownService` as the policy owner

Add `src/application/markdown-service.ts` (or equivalent) and construct it from a validated root
folder ID, archive folder ID, limits, and the `DrivePort`.

For a path input, parse first, then traverse from the root one segment at a time. For every segment:

1. inspect only direct children of the current folder;
2. reject no match as `NOT_FOUND`, more than one exact-name candidate as `AMBIGUOUS_PATH`, a shortcut
   as `UNSUPPORTED`/`OUTSIDE_ROOT`, and a non-folder intermediate segment as `NOT_FOUND`;
3. verify a selected child has exactly the expected parent relationship and is not the root escape;
4. require the leaf to be a regular Markdown file when an operation targets a file.

For an ID input, fetch the candidate then reconstruct/verify its complete parent chain back to the
configured root. Detect cycles, multiple parents, shortcuts, missing parents, archive/root misuse,
or any chain that does not terminate exactly at root and reject it. The returned relative path must
be derived from that verified chain, not trusted from the port.

`listMarkdown` and `searchMarkdown` must filter every candidate through the same descendant,
regular-file, non-shortcut, Markdown, size policy before exposing it. A search result may include a
short excerpt only if the port explicitly supplied one; it must never cause an unbounded content
scan in this pure layer. `createMarkdown` resolves/validates its parent path, rejects a duplicate
leaf exactly (including any ambiguity), validates content, and creates only under that parent.
`updateMarkdown` and `archiveMarkdown` resolve either locator through the one policy, require a
nonempty expected revision, and delegate it unchanged to the port. Map a stale result to
`CONFLICT` with current safe metadata when available and never attempt a second write.

Archive only into the configured, verified descendant archive folder and preserve the file ID. Do
not implement trash/delete, rename, sharing, permission, or generic move APIs.

### 4. Provide a deterministic in-memory fake

Add `src/drive/in-memory-drive-port.ts` for tests and future application tests. Its setup API may
create folders, literal Markdown files, non-Markdown files, shortcuts, duplicate siblings, and
intentionally malformed topology needed to prove rejection. It should:

- allocate deterministic IDs/timestamps from injected seed/clock or explicit fixture values;
- track direct parent-child relations and support fixtures with duplicates/shortcuts/escaped nodes;
- return independent immutable snapshots rather than leaking mutable nodes;
- increment a revision only after a successful conditional fake write/move;
- return a conflict when expected revision differs, without changing bytes/parent;
- expose read-only inspection helpers used only by tests to verify unchanged state.

It is not a production persistence system. Keep its API small and use it as a port implementation,
not an alternative set of application rules.

### 5. Add fake-only unit coverage

Place new tests under `tests/domain/`, `tests/application/`, and/or `tests/drive/` according to the
final module split. Cover the pure parsers and all six service operations, including:

- valid nested Markdown paths, case-insensitive extension behavior, empty content, Unicode content,
  and exact UTF-8 byte-limit boundaries;
- absolute, traversal, dot, duplicate slash, trailing slash, NUL/control, non-Markdown, and empty
  paths; oversized content; invalid root/archive service configuration;
- duplicate leaf/intermediate names, shortcut targets, intermediate files, parent cycles/multiple
  parent folders, missing parents, and targets/folders outside root for both path and ID locators;
- list/search confinement, recursive default and explicit recursion, bounded search limits, and
  metadata with stable IDs/revisions;
- create duplicate refusal, update success, stale update conflict with unchanged content/revision,
  archive success with preserved ID, stale archive conflict, and archive rejection outside root;
- no provider call after local validation fails, verified with a failing/capturing fake;
- import safety: all unit tests use the in-memory port and make no external calls.

## Expected control flow and invariants

```text
caller / future transport
  -> MarkdownService validates input and locator
  -> path traversal OR stable-ID ancestry verification
  -> validated DrivePort operation
  -> normalized domain result or stable application error
```

Invariants:

- No operation reaches a node outside the configured root, even when given a valid opaque ID.
- No shortcut or duplicate-name path is silently followed.
- Only `.md` regular files are visible or mutable.
- Returned metadata always pairs one stable file ID with the revision observed for that result.
- Update/archive issue exactly one conditional provider call and never retry a conflict.
- Archive moves; it never deletes/trashes.
- Application/domain modules are import-safe and have no configuration reads or I/O.

## Current-tree evidence and unchanged boundaries

The baseline is implemented at `faf3644`: `src/index.ts` exports only an import-safe, route-free
Express factory; package scripts provide strict TypeScript, Biome, Vitest, build, and aggregate
validation. The worktree also currently contains uncommitted Epic 0 live-harness work in
`src/live-drive/`; it is an unrelated raw capability probe and is not an edit target for this task.

Keep `src/index.ts`, `tests/index.test.ts`, `src/live-drive/**`, live-probe configuration/docs,
`google-drive-markdown-gateway-handoff.md`, `.agents/skills/**`, and the task/feature statuses
unchanged. Do not add Express routes, MCP/JSON interfaces, provider SDK calls, credentials,
deployment files, or a production write gate.

## Validation

Run the focused test files while implementing, then the authoritative complete suite:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
./scripts/verify-vendored-skills.sh
pnpm check
```

Also run `git diff --check` and inspect the final diff for credentials, generated output, live-test
configuration/results, and any changes outside this task's contract/test surface. All tests must be
fake-only; do not invoke `pnpm drive:probe`.

## Risks and careful checks

- Do not encode Drive API ETag behavior in this task. `Revision` is opaque and the later adapter
  decides how a live, proven conditional update is transported.
- A string cannot contain malformed UTF-8 bytes, so do not invent a byte-decoding API here. The
  incoming-provider adapter must validate decode errors later; size checks still use UTF-8 bytes.
- Ensure an ID route cannot bypass the path policy through a stale/malformed ancestor chain.
- Keep fake fixture escape hatches test-only and clearly separate from normal port behavior.
- Keep error messages useful but avoid embedding document content, credentials, or raw provider
  error payloads.

## Open questions

None. The precise internal file names and nominal default/max values may be selected during
implementation as long as they are explicit, tested, and retain the constraints above.
