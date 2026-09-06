# Migration Taxonomy and Manifest — References

## Primary edit targets

| Path | Area | Why it is likely to change |
| --- | --- | --- |
| `docs/planning-file-source-of-truth.md` (new) | Git/Drive authority and bounded nested taxonomy | Establishes durable policy without claiming live cutover. |
| `config/planning-file-migration.manifest.json` (new) | reviewed one-entry allowlist | Carries the exact handoff digest and target path. |
| `src/planning-migration/manifest.ts` (new) | strict manifest parser | Owns closed schema, nested path, and collision rules. |
| `src/planning-migration/repository.ts` (new) | source containment/hash reader | Enforces repository-relative regular files and digest verification. |
| `src/planning-migration/plan.ts`, `cli.ts` (new) | deterministic plan and ESM entry | Provides review-only output with no live client path. |
| `tests/planning-migration/` (new) | local fake/static coverage | Verifies boundaries without Drive, network, or credentials. |

## Entry point and call path

```text
explicit migration:plan + checked-in manifest
  -> closed parser + normalized target path
  -> bounded, no-symlink source/hash validation
  -> deterministic review JSON
```

There is no path from the planner to `src/drive/**`, JSON/MCP transports, `md-drive`, authentication, a write session, archive dispatch, or deployment.

## Contracts, state, and invariants

- The manifest is the sole migration allowlist. Its `targetPath` is a bounded Markdown relative path below the configured root, with a category first segment of `briefs`, `specs`, or `drafts` and a Markdown leaf.
- The exact source digest is an approval boundary. Manifest validation cannot replace destination collision checks, a write-enabled deployment, or live client/operator evidence.
- `write.enabled` defaults false and runtime writer composition is deployment-owned. A future controlled revision may enable all three writes, including archive; this planning tool has no mode to do so.
- Archive moves one verified file to the configured archive folder. The manifest never chooses its archive path; permanent delete and trash stay prohibited.
- Planner output is not external release evidence. It may be reviewable intent, but must not expose credentials, endpoints, Drive IDs, revisions, bodies, or raw diagnostics.

## Patterns to reuse

| Path | Pattern |
| --- | --- |
| `src/domain/markdown.ts` | UTF-16, Markdown-path, and bounded-path semantics. |
| `src/application/markdown-service.ts` | Nested resolution and verified archive behavior; reuse as contract, not dependency. |
| `src/live-drive/config.ts` | Fail-closed repository/output and symlink posture only. |
| `src/codex-cli/cli.ts`, `src/mcp/stateless-mcp.ts` | Stable six-operation and `OUTCOME_UNKNOWN` recovery contract; do not invoke either. |
| `docs/write-gate-and-client-validation.md` | Deployment-owned write authority and external evidence separation. |

## Tests and fixtures

Use temporary local repositories/files and injected file/hash seams. Cover valid nested paths, depth/byte limits, unknown fields, duplicate normalized and case-folded targets, traversal, absolute/prohibited/symlinked source paths, bad/mismatched digest, races, deterministic output, and proof of zero transport/child/mutation calls. Static tests preserve no-sync, no-overwrite/no-delete/no-trash, default-off write authority, and archive-only cleanup boundaries.

## Expected unchanged boundaries

`src/application/**`, `src/domain/**`, `src/drive/**`, `src/http/**`, `src/mcp/**`, `src/auth/**`, `src/write-gate/**`, `src/runtime/**`, client packages, Terraform, live probes, `AGENTS.md`, feature status, task list, and build log remain outside this task.

## Validation commands

Use `CI=true pnpm test -- tests/planning-migration`, then the canonical lint, format, typecheck, test, build, vendored-skill, `pnpm check`, and `git diff --check` commands from `AGENTS.md` and `package.json`. Do not run a live cutover or any network/client/credential command.

## Uncertainties to verify

Before implementation, recheck the final task-001 manifest interface and current service path-depth/result bounds. The configured root, archive folder, deployment enablement, and operator evidence remain external inputs.
