# Domain Contracts and Safe Resolution — References

## Primary edit targets

No domain, application service, provider port, or in-memory Drive fake exists in the current tree.
The implementation should create a narrow module set at these locations (the exact split may remain
smaller if ownership stays clear):

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `src/domain/` | domain values, operation DTOs, errors, Markdown/path validators | Pure public application contract and input-policy owner helpers. |
| `src/drive/drive-port.ts` | `DrivePort`, node/read/write outcome contracts | Separates application safety policy from a future Google implementation. |
| `src/drive/in-memory-drive-port.ts` | deterministic fake port | Supports comprehensive service tests without external I/O. |
| `src/application/markdown-service.ts` | `MarkdownService` and safe path/ID resolution | Single owner of root confinement, ambiguity rejection, and six operations. |
| `tests/domain/` | validation tests | Covers UTF-8 byte limits, extension rules, and unsafe path forms. |
| `tests/application/` | `MarkdownService` tests | Covers all operations and safety behavior through the in-memory port. |
| `tests/drive/` | fake-port tests, if useful | Proves fake conditional mutation/fixture behavior independently. |

The new paths must be rechecked immediately before editing because other Epic work is active in the
shared worktree.

## Entry point and call path

Current product code is deliberately minimal:

`tests/index.test.ts` → `createApp` in `src/index.ts` → fresh Express application

This task must not attach to that route-free factory. Its new reusable call path is:

`future HTTP/MCP/CLI caller` → `MarkdownService` → locator validation and root verification →
`DrivePort` → normalized domain result/error

For a path, `MarkdownService` walks direct children from the configured root. For an ID, it fetches
the node and verifies its full parent chain terminates at that same root. Both routes then use the
same Markdown, size, shortcut, and archive policy.

## Contracts, state, and invariants

- `FileId`, `FolderId`, and `Revision` are opaque provider values; relative paths are not stable
  identities.
- `MarkdownFileMetadata` contains relative path, ID, revision, modification time, and byte size.
- `MarkdownDocument` adds validated UTF-8 text content.
- Six operation contracts: list, search, read, create, conditional update, conditional archive.
- `MarkdownService` owns root ID, archive ID, max byte size, recursive/search bounds, input checks,
  safe traversal, ID ancestry verification, and provider-error normalization.
- `DrivePort` owns provider facts and conditional provider operations only. A future Google adapter
  implements it; the in-memory port implements it for tests.
- A port node distinguishes folder, regular file, and shortcut and reports stable ID, direct parents,
  name, modification metadata, revision, and content facts needed by the service.

Rules that cannot be weakened:

- configured root/archives and every target must be a verified descendant path with no shortcut,
  duplicate selection, or escape;
- only regular `.md` files (case-insensitive extension) may be listed/read/created/updated/archived;
- byte size uses UTF-8 encoding and is bounded before writes;
- update/archive use exactly the supplied expected revision and surface a stale result as `CONFLICT`;
- no permanent deletion/trash capability exists;
- all ordinary tests use only the in-memory fake and no credentials/network.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/index.ts` | import-safe exported function with no environment reads/I/O | New modules must be import-safe and independently constructible in tests. |
| `tests/index.test.ts` | finite Vitest test importing production ESM | New tests should import `.js` ESM paths and remain deterministic. |
| `tsconfig.json` / `tsconfig.build.json` | strict NodeNext TypeScript; tests type-check but do not emit | Domain/application/port source goes under `src/`; fake-only tests go under `tests/`. |
| `package.json` | `pnpm check` is the canonical aggregate command | Preserve its sequence; add no automatic live test. |
| `src/live-drive/http.ts` | narrow injectable boundary contract | Demonstrates seam-oriented design but is unrelated raw capability work; do not import it. |
| `tests/live-drive/probe.test.ts` | in-memory state fake used to prove a safety condition | Reuse the testing style only, not the live-harness types or behavior. |

## Tests and fixtures

New test fixtures should be created in test code via the in-memory port. They must include:

- a root with nested folders/files and a descendant archive;
- duplicate exact-name sibling files/folders;
- a shortcut node and a target outside root;
- regular files outside root, parent cycles/multiple-parent malformed nodes when the fake permits;
- deterministic revisions/content values for success and stale-conflict assertions.

Important service cases: safe nested resolution, invalid paths, Markdown/UTF-8/max-size policy,
path and ID confinement convergence, all six operations, unchanged fake state after conflict, and
never delegating after local input rejection.

## Expected unchanged boundaries

- `src/index.ts` and `tests/index.test.ts` remain the baseline route-free application test.
- `src/live-drive/**`, `tests/live-drive/**`, `config/`, and `docs/live-drive-*` belong to the
  separate raw capability-harness task and must not be edited/imported.
- `package.json`, lockfile, dependencies, Express routes, MCP/JSON transports, Google SDK use,
  credentials, Docker/Terraform, and production write enablement remain outside this task.
- `google-drive-markdown-gateway-handoff.md`, `AGENTS.md`, vendored skills, feature/task status,
  and task briefs remain unchanged.

## Validation commands

Authoritative commands are defined in `package.json`, recorded in `ARCHITECTURE.md`, and require the
vendored check in `AGENTS.md`:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
./scripts/verify-vendored-skills.sh
pnpm check
git diff --check
```

Run focused new Vitest files during development. Do not run `pnpm drive:probe`; it is an operator
opt-in live test and unrelated to this pure contract task.

## Selected external material

None. This task is governed by the approved repository product brief, feature/task decisions, and
current-tree tooling. Google Drive REST details are intentionally deferred to the adapter task;
the only provider assumption retained here is that IDs and revisions are opaque values.

## Uncertainties to verify

- Confirm the currently active shared-worktree changes do not introduce similarly named domain or
  Drive-port modules before implementation begins.
- Choose explicit, conservative size/search defaults in the service configuration and test them;
  no user decision or repository policy currently supplies exact numeric values.
- Preserve a clean boundary between the test fake's fixture-only malformed-topology support and its
  normal conditional create/update/move behavior.
