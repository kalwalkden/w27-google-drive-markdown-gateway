# Migration Taxonomy and Manifest — Implementation Plan

## Scope

Add a repository-owned, reviewable planning-file migration policy and a closed manifest validator/plan
tool. The tool validates exact files that an approved operator may later copy through the gateway; it
does not contact Drive, create a document, call the JSON/MCP API, load credentials, or alter
source-of-truth state.

The initial manifest contains only the bootstrap handoff. It establishes a conservative flat
direct-root naming taxonomy for future explicitly approved cross-client planning documents. It does
not migrate source code, executable task/spec packages, operations documentation, credentials, or
unrelated repository material.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| Drive is canonical only for deliberately enumerated cross-client planning documents after a verified operator copy. | The manifest is an allowlist, not a repository inventory or synchronizer. Its initial entry is the handoff snapshot; a later document requires an explicit manifest review. | Epic 6; approved feature/brief; user direction. |
| Source code, executable feature/task specs, gateway configuration, tests, deployment assets, and operations documents remain Git-owned. | Exclude `src/`, `tests/`, `infra/`, `config/`, package/lock files, `ARCHITECTURE.md`, `ai/features/**`, `.agents/**`, and `docs/operations*.md` from eligible entries. Keep migration policy/runbook artifacts in Git too. | User direction; Epic 6; `AGENTS.md`; operational-hardening task 003. |
| The current public Drive surface is direct-root only. | Do not use target folders or slash-containing target paths. Every active target is exactly one Markdown filename directly under the configured root. The tool rejects nesting, traversal, separators, non-Markdown names, case-folded duplicates, and taxonomy-prefix mismatches. | `src/application/markdown-service.ts`; `src/domain/markdown.ts`; Drive-core/operations specs. |
| Archive is unavailable without atomic destination-topology proof. | Define `archive--` as a reserved future filename class only. The manifest cannot contain an active archive entry and no tool creates an archive folder, moves a file, deletes, trashes, or claims archive verification. | `MarkdownService.archiveMarkdown`; resilience and operations specs. |
| Production runtime supplies no write session. | The plan output is review material, never a write permission or executable cutover. A valid manifest does not imply a deployed write lease or a live create/update capability. | `src/runtime/server.ts`; `docs/cloud-run-deployment.md`; write-gate guide. |
| No implicit overwrite or broad discovery. | Each entry has an exact source digest, unique stable key, exact target filename, and `collisionPolicy: "fail"`. A later operator must list/read the target and stop on any collision/ambiguity; this task never searches Drive. | Brief; handoff optimistic-concurrency/no-delete rules; Drive core. |
| Repository and operator evidence have different privacy needs. | The checked-in manifest can name reviewed repository files and target filenames. It contains no IDs, revisions, URLs, credentials, bearer values, endpoint values, document bodies, or live results. Live evidence remains external and is task 002's concern. | `AGENTS.md`; live-drive/client-validation patterns; task 002 brief. |

## Source-of-truth policy and direct-root taxonomy

Create `docs/planning-file-source-of-truth.md` as the normative policy.

1. **Drive-owned after cutover:** a document becomes a Drive source of truth only when it is an
   explicit active manifest entry, the operator has completed the separately controlled cutover, and
   external evidence records a verified read. The repository copy is then a frozen bootstrap
   reference, not a mirror. There is no automatic bidirectional synchronization.
2. **Git-owned:** code, executable plans/specs/tasks, test fixtures, runtime/deployment material,
   gateway and operations documentation, vendor skills, and migration tooling remain canonical in
   Git. A Drive copy of one of these files, if made outside this workflow, has no authority and must
   not be added to the manifest as a shortcut.
3. **Flat v1 taxonomy:** direct children use a lower-case ASCII category prefix and an approved slug:
   `brief--<slug>.md`, `spec--<slug>.md`, and `draft--<slug>.md`. These are names, not folders.
   There is no `/briefs`, `/specifications`, `/drafts`, or nested hierarchy while public reads
   and writes cannot atomically prove ancestor topology. `archive--<slug>.md` is reserved and not
   active until a separately approved archive capability exists.
4. **Initial entry:** `google-drive-markdown-gateway-handoff.md` maps byte-for-byte to
   `brief--google-drive-markdown-gateway-handoff.md`; its current SHA-256 is
   `d6cca167761bbaa0d73843621b21f7e5b64ca48bd64897050cd00f3fa096d18d`.
   The copy is a workflow brief, while the Git file remains the historical product-baseline record.
   A pre-cutover source change needs a reviewed digest/manifest update; after cutover, amendments
   are made in Drive through the normal revision-safe workflow, not by silently editing Git.

No visual design applies.

## Manifest and plan-tool contract

Add `config/planning-file-migration.manifest.json` and a side-effect-free
`pnpm migration:plan -- --manifest <absolute-or-repository-relative-path>` command backed by
`src/planning-migration/`. The checked-in manifest is the only default; arbitrary configuration
discovery is prohibited.

The closed manifest schema is `w27-planning-file-migration-manifest-v1`:

```json
{
  "schemaVersion": "w27-planning-file-migration-manifest-v1",
  "topology": "direct-root-flat-v1",
  "entries": [
    {
      "key": "gateway-handoff",
      "classification": "brief",
      "sourcePath": "google-drive-markdown-gateway-handoff.md",
      "targetName": "brief--google-drive-markdown-gateway-handoff.md",
      "sourceSha256": "d6cca167761bbaa0d73843621b21f7e5b64ca48bd64897050cd00f3fa096d18d",
      "collisionPolicy": "fail",
      "sourceDisposition": "frozen-bootstrap-reference"
    }
  ]
}
```

- Reject unknown fields, non-v1 values, empty/duplicate keys, malformed 64-character lower-case
  SHA-256 values, duplicate case-folded target names, and all non-`fail` collision policies.
- `sourcePath` must be a non-empty repository-relative POSIX path, resolve beneath the discovered
  root, name a regular non-symlink file, and not enter `.git`, `node_modules`, or a prohibited
  Git-owned root. Do not follow symlinks or accept an absolute path.
- `targetName` must be one well-formed UTF-16 leaf with no `/` or `\\`, end in `.md`,
  satisfy the existing Markdown-name rule, remain within the JSON/API path byte bound, and exactly
  match its classification prefix. The parser never reinterprets it as a filesystem path.
- The runner streams and bounds source reads, computes SHA-256 over bytes, and fails before emitting
  a usable plan if any recorded digest differs. It never prints source content.
- Success emits one deterministic JSON plan: schema version, topology, manifest digest, count, and
  per-entry stable key/classification/source path/target name/source byte count/digest state/collision
  policy. Failures use fixed redacted stderr and nonzero exits. It starts no child process and makes
  no network, Drive, credential, or write-gate call.

Use a library-first structure: `manifest.ts` parses/normalizes the closed JSON value;
`repository.ts` discovers/validates root and source facts through injectable filesystem/hash seams;
`plan.ts` builds the deterministic plan; `cli.ts` owns ESM direct execution and fixed output.
Do not reuse the live Drive CLI or let this command become a general copy tool.

## Detailed implementation approach

1. Add the source-of-truth/taxonomy document and checked-in v1 manifest. Keep the one initial
   handoff entry intentionally small. Document a proposal-and-review step for future Drive-owned
   brief/spec/draft entries rather than recursively collecting files.
2. Add typed domain definitions and strict Zod (or equivalently closed) parsing under
   `src/planning-migration/`. Reuse `isWellFormedUtf16`, `isMarkdownName`, bounded byte
   checking, and the repository-root/no-symlink posture from `src/live-drive/config.ts` only as
   safety patterns; do not import Drive/OAuth/HTTP code.
3. Implement root containment with real-path/lstat checks. Check every source component, reject
   symlinks, perform only bounded file reads, and hash raw bytes. Treat a modified/disappearing
   source as failure rather than producing a partly trustworthy plan.
4. Add the opt-in package script and direct executable. Its only side effect is reading the selected
   manifest/source files; it may not write output, mutate Git, invoke `md-drive`, or inspect Drive.
5. Add fake/local tests under `tests/planning-migration/` for valid output; invalid schema rules;
   case-folded collision; nested/absolute/traversal/symlink/prohibited source; wrong digest;
   malformed Unicode; prefix mismatch; missing/changed file; bounded read; deterministic output;
   no content leakage; and no child/network/Drive call. Add static tests for policy boundaries and
   the example manifest's checksum/flat taxonomy.

## Expected control flow and invariants

```text
checked-in policy + reviewed manifest
  -> closed manifest parser
  -> repository-contained regular source + exact digest check
  -> deterministic review plan
  -/-> Drive / JSON API / MCP / md-drive / credential / write lease / mutation
```

- A plan is repository intent only. It does not prove a destination is empty, a gateway is deployed,
  a client is configured, or a write gate is open.
- One target is one direct-root Markdown leaf. Folder topology, automatic rename, overwrite, sync,
  archive, delete, and trash are impossible through this task's interface.
- The plan fails closed on uncertainty, including source replacement, a symlink, collision in the
  manifest, or an unrecognized field.

## Current-tree evidence and unchanged boundaries

`google-drive-markdown-gateway-handoff.md` is the only current file selected for the initial
cross-client manifest. The current tree has no migration source, manifest, policy, or tests.
`src/application/markdown-service.ts` accepts only direct-root public reads/mutations and returns
`UNSUPPORTED` for archive. `src/runtime/server.ts` composes the production service without a
write session. The planned Codex CLI and Work packaging are documented specs only today; no
implementation may assume they exist or perform a client call.

Do not change `AGENTS.md`, the handoff, feature/task statuses, `tasks.md`, build log,
application/domain/Drive/HTTP/MCP/auth/write-gate/runtime code, deployment assets, client specs,
operations docs, credentials, or concurrent package/source changes. New isolated migration assets
may add a package script only after rechecking shared `package.json` edits.

## Test strategy and validation

```bash
CI=true pnpm test -- tests/planning-migration
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

Do not invoke an operator cutover, `md-drive`, a live Drive probe, Docker, Terraform, `gcloud`,
remote OAuth/JWKS/Google/Secret Manager, or a deployed endpoint while implementing this task.

## Risks and careful checks

- Do not call a prefix taxonomy a folder structure in implementation. The direct-root restriction
  makes it a flat naming taxonomy; the document must say that plainly.
- Do not treat Drive copies of `ai/features/**` as executable specs. Git retains the only
  executable task/spec source.
- Recheck the handoff digest immediately before creating the manifest; a mismatch requires a
  reviewed update rather than accepting an old source.
- Do not expose broad `--copy`, `--root`, `--archive`, or source-glob flags. They would turn a
  review aid into unbounded migration automation.

## Open questions

None. Actual Drive root identity, deployment/client configuration, write-gate approval, operator
authorization, and live evidence are deliberately external release inputs for task 002.
