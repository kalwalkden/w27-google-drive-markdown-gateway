# Migration Taxonomy and Manifest — Implementation Plan

## Scope

Add a Git-owned source-of-truth policy, closed migration manifest, and side-effect-free plan validator for explicitly approved planning documents. It prepares a bounded nested Drive taxonomy under the configured Markdown root; it does not call Drive, a gateway/client transport, or an operator environment.

The initial manifest remains intentionally small: the checked-in handoff maps to `briefs/google-drive-markdown-gateway-handoff.md` with SHA-256 `d6cca167761bbaa0d73843621b21f7e5b64ca48bd64897050cd00f3fa096d18d`. No source is copied by this task.

## Binding decisions

| Decision | Implementation effect | Provenance |
| --- | --- | --- |
| Drive becomes canonical only after separately authorized, evidenced cutover. | The manifest is an exact allowlist and review plan, never inventory, sync, copy command, or write authority. | Epic 6; brief; user direction. |
| Nested paths are bounded and supported. | Use `briefs/`, `specs/`, and `drafts/` under the configured root. Validate every segment as a bounded Markdown-service relative path; later create occurs only in an existing verified folder. | Current `MarkdownService`, JSON/MCP/CLI contracts. |
| Archive is implemented but deployment-owned writes default off. | Reserve the configured archive folder for archive-only cleanup after a proven write-enabled operator deployment. A manifest entry never names an archive destination or makes archive available. | `MarkdownService.archiveMarkdown`; `composeRuntime`; deployment/write-gate docs. |
| Git/Drive authority is disjoint. | Keep code, task/spec packages, runtime/deployment/configuration, operations docs, tests, skills, and migration tooling Git-owned. A Drive planning document is not an executable task spec and no sync follows cutover. | Brief; `AGENTS.md`; Epic 6. |
| Exact one-dispatch and unknown outcomes are safety boundaries. | A later cutover stops on collision, `CONFLICT`, `OUTCOME_UNKNOWN`, timeout, or transport ambiguity; it may reread manually but never overwrite, retry mutation, delete, trash, or infer cleanup. | Current JSON/MCP/CLI contracts; operations docs. |

## Taxonomy and manifest contract

Create `docs/planning-file-source-of-truth.md` and `config/planning-file-migration.manifest.json`. The policy defines `briefs/<slug>.md`, `specs/<slug>.md`, and `drafts/<slug>.md` as the only migration classifications. They are bounded nested paths below the configured root, not filesystem paths or a broad Drive hierarchy.

The configured archive folder is a deployment-owned archive target. It is not a planning taxonomy class, manifest-selected destination, trash, or permanent-deletion facility. Git remains the sole authority for repository code and executable planning assets; Drive becomes authoritative only for a manifest entry after successful cutover and external sanitized evidence. The Git bootstrap remains a frozen reference.

Use a closed v1 manifest with stable key, classification, repository-relative `sourcePath`, nested `targetPath`, exact lowercase SHA-256, `collisionPolicy: "fail"`, and source disposition. Reject unknown fields, duplicate keys, duplicate normalized/case-folded targets, traversal, absolute paths, empty segments, non-Markdown leaves, classification/taxonomy mismatches, sources in prohibited Git-owned roots, non-regular files, symlinks, and digest changes.

Add a library-first `src/planning-migration/` planner and opt-in `migration:plan` script. It discovers a repository root, reads bounded source bytes, verifies the exact digest, and prints deterministic redacted JSON. It has no copy/archive/network/credential/child-process behavior and must not accept glob, source-root, overwrite, or destination flags.

## Control flow and invariants

```text
reviewed manifest + exact Git source digest
  -> closed nested-path/source validation
  -> deterministic plan for human/operator review
  -/-> Drive, md-drive, MCP, HTTP, credentials, WriteGate, mutation
```

- A successful plan does not prove destination vacancy, client access, a write-enabled revision, or archive availability.
- The configured root bounds all target paths. The actual Drive adapter/service remains responsible for ancestor validation, ambiguity/collision rejection, revisions, and archive move proof.
- Plan output may carry reviewed source/target names and source digest; live evidence must not carry paths/names, content/digest, IDs, revisions, endpoint/credential values, or raw diagnostics.

## Implementation approach

1. Add the policy and one-entry manifest with the exact handoff digest.
2. Implement closed manifest parsing and normalized nested-target validation, reusing existing Unicode, Markdown-name, byte-bound, root-containment, and no-symlink safety patterns without importing Drive/auth/HTTP code.
3. Implement bounded raw-byte hashing and deterministic plan output. A changed, missing, oversized, or raced source fails closed.
4. Add local fake tests for schema/path/source/digest boundaries, determinism, content redaction, and no transport/process/mutation calls.

## Current-tree evidence and boundaries

Current `MarkdownService` resolves bounded nested read and mutation paths and implements revision-checked `archiveMarkdown` as a verified move to the configured archive folder. `src/runtime/server.ts` composes a writer only when parsed `write.enabled` is true; configuration and Terraform remain default-off and operator-owned. Work and Codex clients expose the same six operations, including `OUTCOME_UNKNOWN` recovery guidance, but neither changes deployment authority.

Do not edit service/Drive/auth/write-gate/transports, client packages, deployment, credentials, feature statuses, tasks, or build log. Do not conduct any live operation.

## Validation

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

## Risks

Do not turn the taxonomy into broad synchronization or permit a manifest to select an archive target. Recheck current manifest digest and client contracts immediately before implementation; this spec does not authorize external configuration or a live cutover.
