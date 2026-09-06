# Operator Cutover and Cross-Client Verification — References

## Primary edit targets

| Path | Area | Why it is likely to change |
| --- | --- | --- |
| `docs/planning-file-cutover.md` (new) | current block and controlled runbook | Separates local preflight from operator-owned live execution. |
| `docs/planning-file-cutover-evidence.example.json` (new) | sanitized evidence template | Preserves only safe facts and blocked/manual-recovery outcomes. |
| `src/planning-migration/cutover-evidence.ts` (new) | schema, transition reducer, redaction, external writer | Isolates release documentation from authority and clients. |
| `src/planning-migration/cutover-preflight-cli.ts` (new) | direct ESM preflight entry | Validates non-secret inputs with no shell/network. |
| `package.json` and `tests/planning-migration/` | narrow script and fake/static tests | Expose and verify local preflight only. |

## Entry point and call path

```text
task-001 verified plan + external non-secret checklist + confirmation
  -> closed evidence/gate parser
  -> exclusive sanitized external output
  -> operator release decision

preflight -/-> md-drive, Work MCP, HTTP, Drive, OAuth, WriteGate, shell, browser, device, mutation
```

The later operator path is separate: exact nested manifest target, one approved client create, reread/readback, update/stale-conflict verification, exact-file archive verification, and read-only observations from Work, Codex, macOS, iPhone, and iPad.

## Contracts, state, and invariants

- Task 001 owns target selection and source digest. Task 002 cannot parse a source tree, choose a folder, or create a broad synchronization route.
- Current `MarkdownService` supports nested relative paths and archive as a revision-checked move. `composeRuntime` supplies a writer only when `write.enabled`; default-off or absent configuration is a blocked live precondition, not a permanent capability claim.
- Evidence contains opaque release/environment/profile identifiers, approved digests, finite gate/client/operation states, and manual-recovery state only. It excludes paths/names/content/digests, file IDs, revisions, endpoints, IPs, secret/token references, responses/errors/stacks, screenshots, accounts, and device identity.
- `CONFLICT`, `OUTCOME_UNKNOWN`, timeout, or transport ambiguity never causes automatic retry, overwrite, cleanup, archive, delete, or trash. Manual reread/reconciliation is the only next action before an explicitly chosen later mutation.
- Archive is a verified move for the captured generated file using its current reread revision. Failure/inconclusive cleanup has priority and remains a manual-recovery record.
- Work and Codex are dependency inputs: both use six gateway operations; Codex uses only injected gateway bearer material and exact-host GET/POST egress. Neither client confers Drive credentials or write authority.

## Patterns to reuse

| Path | Pattern |
| --- | --- |
| `src/live-drive/config.ts`, `evidence.ts`, `cli.ts` | closed config, no-symlink external path, exclusive restrictive output, import-safe CLI shape. |
| `docs/live-drive-capability-harness.md` | explicit confirmation and manual recovery discipline, not raw Drive auth. |
| `src/application/markdown-service.ts` | bounded nested path, collision/revision checks, verified archive move. |
| `docs/write-gate-and-client-validation.md` | default-off deployment authority, required digests/probe, external client evidence. |
| `plugin/chatgpt-work/instructions.md` | fresh-session read/mutation/recovery/confirmation behavior. |
| `docs/codex-cloud-client-setup.md`, `src/codex-cloud/harness.ts` | clean cloud setup, narrow egress, default-off and six-operation evidence semantics. |

## Tests and fixtures

Use synthetic opaque IDs and fake filesystem/clock seams only. Test closed statuses and reasons, unknown/forbidden nested fields, impossible completion transitions, default-off block, write-enabled checklist shape without a live claim, task-001 digest mismatch, external/repository/symlink/existing output handling, atomic permissions, no process/client calls, all five read observations, stale and unknown-outcome manual recovery, and archive-verification/cleanup priority. Static tests reject broad sync, permanent deletion/trash, automatic retry, secret values, and claimed live success.

## Expected unchanged boundaries

Task 001 keeps manifest/taxonomy/hash ownership. Service, Drive, JSON/MCP, auth, write-gate, runtime, observability, Work/Codex production clients, Terraform, credentials, `AGENTS.md`, task statuses, task list, build log, and operator/cloud/device state are outside scope.

## Validation commands

Run `CI=true pnpm test -- tests/planning-migration` followed by the canonical lint, format, typecheck, test, build, vendored-skill, aggregate `pnpm check`, and `git diff --check` commands. Routine checks must not invoke external config, md-drive, cloud, Work, Drive, browser/device, Terraform, OAuth, or network actions.

## Uncertainties to verify

Recheck task-001's implemented plan schema before importing it, and recheck committed Work/Codex interfaces before naming exact harness calls. Actual deployment enablement, root/archive topology, tenant/cloud controls, credentials, client/device availability, and evidence remain external release gates.
