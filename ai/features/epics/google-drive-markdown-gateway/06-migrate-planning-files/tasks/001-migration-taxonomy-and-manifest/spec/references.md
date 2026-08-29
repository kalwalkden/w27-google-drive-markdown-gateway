# Migration Taxonomy and Manifest — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `docs/planning-file-source-of-truth.md` (new) | Git/Drive ownership policy and flat taxonomy | Makes the Epic 6 source-of-truth decision durable without treating the product handoff as an executable plan. |
| `config/planning-file-migration.manifest.json` (new) | reviewed v1 initial migration allowlist | Names the only approved initial source/target pair and its exact source digest. |
| `src/planning-migration/manifest.ts` (new) | closed v1 parser/normalizer | Keeps schema, taxonomy, unique-name, and no-unknown-field enforcement independent of a live client. |
| `src/planning-migration/repository.ts` (new) | bounded source/root facts and SHA-256 seam | Prevents source traversal/symlink escape and supports testable digest verification. |
| `src/planning-migration/plan.ts` (new) | deterministic, content-free plan construction | Converts a valid manifest plus checked sources into review material only. |
| `src/planning-migration/cli.ts` (new) | direct ESM plan executable | Provides one explicit opt-in command without a copy or live-cutover action. |
| `package.json` | narrow `migration:plan` script | Exposes the compiled review-only command after checking concurrent package edits. |
| `tests/planning-migration/` (new) | manifest, source-boundary, output, and static-policy tests | Proves fail-closed planning behavior using local fakes/files only. |

## Entry point and call path

```text
explicit migration:plan invocation
  -> manifest path / closed v1 parser
  -> discovered repository root + lstat/realpath source containment
  -> bounded raw-byte SHA-256 verification
  -> deterministic review JSON

plan tool -/-> Drive API, md-drive, HTTP/MCP, auth, secret file, write gate, filesystem mutation
```

## Contracts, state, and invariants

- `w27-planning-file-migration-manifest-v1` has one direct-root-flat topology and a closed entries
  array. Unknown keys, duplicate keys, case-folded duplicate targets, and unsupported archive entries
  are invalid.
- An entry carries only reviewed source metadata: stable key, class (`brief`, `specification`, or
  `draft`), repository-relative regular-file source, direct-root Markdown target leaf, raw-byte
  SHA-256, `collisionPolicy: "fail"`, and `sourceDisposition`.
- The prefix mapping is exact: `brief` -> `brief--`, `specification` -> `spec--`, `draft`
  -> `draft--`. `archive--` has no active manifest class while `archive_markdown` is unavailable.
- An active entry is not permission. A later operator must separately prove destination conditions,
  a deployed client, an authorized cutover, and independently gated write capability.
- Plan output has no source bytes. Repository source/target names and source digest are intentional
  checked-in review data; it never contains Drive IDs, revisions, endpoint values, credentials,
  token values, response bodies, or live evidence.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/live-drive/config.ts` | repository-root discovery, external-path/symlink safety posture | Reuse the fail-closed filesystem design only; do not import OAuth, probe configuration, or Drive IDs. |
| `src/domain/markdown.ts` | Markdown-name, Unicode, and byte-bound helpers | Reuse validation semantics for a direct-root target leaf, without expanding `MarkdownService` behavior. |
| `src/live-drive/cli.ts` | testable ESM `main` plus direct-execution guard | Reuse executable shape and fixed redacted diagnostics, not its auth/HTTP/Drive calls. |
| `src/live-drive/evidence.ts` | strict schema/forbidden-key testing mindset | Apply closed-input and no-content-output discipline; this manifest is not live evidence. |
| `docs/write-gate-and-client-validation.md` | evidence is not write authority | State the same separation for a migration plan and later cutover evidence. |
| task 04 CLI/task 05 operations specs | one-request/no-secret/operator-only boundaries | Treat them as dependency contracts, not currently available executables. |

## Tests and fixtures

- Temporary repository fixture with a regular Markdown source and injected clock/filesystem/hash
  seams; no fixture contains a credential, Drive ID, endpoint, or document body beyond inert test
  text.
- Valid one-entry output plus all parser rejections: unknown field/version/topology, duplicate
  key/target, malformed key/digest, incorrect prefix, unsupported archive, non-Markdown/leaf/nested
  target, bad source disposition/collision policy.
- Source safety: absolute, traversal, prohibited Git-owned root, missing, non-regular, symlinked
  file/component, repository escape, stale/changed bytes, byte-bound failure, and malformed Unicode.
- Output: deterministic ordering, exactly one JSON result on success, fixed redacted diagnostics on
  failure, no source-content sentinel, and zero client/child/mutation calls.
- Static assertions read policy/manifest to verify the handoff digest, flat names, Git-owned
  exclusions, no sync/overwrite/delete/trash, archive deferral, and explicit external cutover gate.

## Expected unchanged boundaries

- `src/application/**`, `src/domain/**` (except importing existing helpers if final module layout
  makes that safe), `src/drive/**`, `src/http/**`, `src/mcp/**`, `src/auth/**`,
  `src/write-gate/**`, `src/runtime/**`, and `src/live-drive/**` keep their product semantics.
- No JSON/MCP route, diagnostics CLI route, deployment/IAM/secret configuration, Drive folder,
  client network policy, write session, archive behavior, or real evidence changes.
- `AGENTS.md`, task/feature status artifacts, handoff, build log, and current concurrent changes
  are outside scope.

## Validation commands

Authoritative sources: `AGENTS.md`, `ARCHITECTURE.md`, and `package.json`.

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

## Selected external material

None. The handoff, approved Epic 6 artifacts, current implementation, and checked-in client and
operations planning artifacts are binding. Live platform/Drive behavior is operator-time only.

## Uncertainties to verify

- Re-read `package.json` and `src/live-drive/config.ts` before implementation because concurrent
  work currently changes package/source files.
- Confirm the source handoff SHA-256 at implementation time. A mismatch intentionally fails until a
  reviewer updates the manifest.
- Recheck whether task 04's CLI is committed before linking to its exact script/output format; this
  task must not assume it exists.
