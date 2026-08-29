# Codex Cloud Setup and Live Verification — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `docs/codex-cloud-client-setup.md` (new) | project-scoped installation, secret/egress setup, current-platform check, recovery runbook | The task needs durable guidance without changing `AGENTS.md` or mutating a cloud environment. |
| `.agents/skills/codex-cloud-markdown-gateway/SKILL.md` (new) | Codex read/write/conflict/archive workflow | Satisfies the handoff's project-scoped skill option while keeping guidance reusable and endpoint-free. |
| `scripts/verify-vendored-skills.sh` | required skill inventory | Must verify the additional repository-scoped skill remains checked in and path-safe, without weakening the established integrity checks. |
| `src/codex-cloud/` (new) | closed config parser, harness state machine, CLI-result reader, evidence serializer, direct-execution entry | Owns operator-harness mechanics only; it must invoke the completed CLI through an injected process boundary rather than talk to HTTP/Drive. |
| `package.json` | narrow `codex-cloud` harness script, if needed | Exposes the compiled opt-in harness without adding it to normal validation or global install flows. |
| `tests/codex-cloud/` (new) | fake-runner/state/evidence/static-documentation tests | Proves safety and sequencing with no Codex, network, credential, gateway, or Drive access. |
| `docs/client-validation-record.example.json` (possibly extend) | sanitized release-evidence template | Existing cross-client record is the nearest approved evidence format; retain its no-secret/no-authority boundary. |

Recheck these paths before implementation. The completed task-001 CLI source and package metadata are not present in the current tree; its final public executable, command syntax, JSON schema, and exit codes are a dependency, not an assumption.

## Entry point and call path

```text
Codex cloud operator configuration (outside Git)
  -> clean repository checkout + checked-in setup guidance/skill
  -> injected MD_DRIVE_GATEWAY_URL + one scoped Codex bearer
  -> cloud egress: exact gateway hostname; GET and POST
  -> operator-only codex-cloud harness
  -> completed md-drive executable (one request per CLI invocation)
  -> deployed JSON gateway
  -> sanitized evidence outside repository + archive-only cleanup
```

The harness is intentionally not a service or Drive path:

```text
codex-cloud harness
  -/-> fetch/raw HTTP
  -/-> Google SDK / OAuth / ADC
  -/-> Drive adapter / live-drive probe
  -/-> WriteGate.evaluate / WriteLease
  -/-> Codex cloud environment mutation
```

## Contracts, state, and invariants

- Task 001's completed `md-drive` interface is the only client transport. Its binding command mapping is `GET` list/search/read and `POST` create/update/archive; it owns gateway bearer loading, endpoint validation, bounded requests, protocol validation, stable JSON output, exit codes, and no-retry behavior.
- The harness must accept a closed, external, non-secret configuration. It may carry only bounded validation controls and opaque identifiers; endpoint, bearer, Google auth, Drive IDs, revisions, content, arbitrary commands, shell syntax, and live evidence values are invalid.
- The clean-environment state machine progresses only from parsed stable CLI results: preflight → list/search/read → create → reread → fresh update → reread → stale update returns `CONFLICT` → reread unchanged state → archive → cleanup verified. A failed transition cannot be papered over by retrying a mutation.
- The expected stale result is the task-001 recognized `CONFLICT`/exit-8 behavior. `UNSUPPORTED`, `UNAUTHENTICATED`, timeout, transport, malformed CLI output, or other failure is recorded as a failed/inconclusive release check, never converted to a pass.
- Archive cleanup targets only the in-memory locator for the generated run file and uses a currently reread revision. It never acts on discovery-by-name results and never deletes/trashes a file. Cleanup failure takes precedence in the final harness outcome.
- Evidence is a strict allowlist and remains external. It may include opaque release/environment/gateway identifiers, methods, timestamps, operation outcomes, conflict outcome, cleanup status, and redaction state. It excludes secret values/references, endpoints/URLs/IPs, paths/names, content/digests, Drive IDs, revisions, operation IDs, response bodies, diagnostic strings, logs, and screenshots.
- The setup document instructs a current platform check rather than asserting implementation-specific cloud configuration syntax. If method-specific egress restrictions are unavailable, record the limitation and do not claim it is enforced; hostname restriction stays exact and broad Internet remains forbidden.
- The added project skill contains instructions only. It never configures an environment, creates a cloud task, invokes the live harness automatically, or transports a secret.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `docs/codex-cloud-preflight.md` | focused setup document with explicit current-runtime checks and no-secret preflight | Link to and preserve its repository-skill/fresh-subagent purpose; do not overload it with deployed client settings. |
| `docs/live-drive-capability-harness.md` | explicit confirmation, external config/output, dedicated area, `finally` archive cleanup, sanitized result | Reuse the operator-safety shape only. Do not reuse Google auth, Drive API calls, real credential contract, or raw evidence fields. |
| `src/live-drive/cli.ts` | direct-execution ESM main with injected seams and fixed-result writing | Reuse only the import-safe/testable executable structure and opt-in discipline. |
| `src/live-drive/config.ts` | closed parser and external-path safety checks | Reuse its fail-closed input posture; do not import OAuth or Drive configuration. |
| `docs/write-gate-and-client-validation.md` | Codex release-evidence/non-authority rule and narrow hostname/method direction | Preserve the record's separation from write authorization. |
| `docs/client-validation-record.example.json` | synthetic sanitized record convention | Extend only with approved harness outcomes, avoiding its legacy `PATCH` example for the CLI method policy. |
| `scripts/verify-vendored-skills.sh` | declared skill-name/regular-file/local-path validation | Extend narrowly for the added project skill while retaining all existing workflow skill checks. |
| task 001 `spec/plan.md` and `spec/references.md` | machine CLI contract and local-only fake-test strategy | Treat its final implementation as the authoritative executable/output contract; do not duplicate its HTTP transport or credential loader. |

## Tests and fixtures

- Injected fake `md-drive` runner returning the completed CLI's synthetic stable JSON/exit combinations. It records operation names and never retains a bearer, endpoint, content, or real path.
- Synthetic external config and result paths created outside the repository test root, plus negative repository-local/symlink/unknown/duplicate/confirmation cases. No fixture is a real secret, endpoint, Drive identifier, or cloud configuration.
- Deterministic UUID/clock/temp-file seams to prove generated-file targeting, correct current/stale revision flow, one CLI dispatch per attempt, `finally` cleanup, and cleanup-failure precedence without exposing temporary content.
- Synthetic success, stale `CONFLICT`, unauthorized, unsupported write, timeout/transport, protocol/output, changed-readback, archive, and cleanup responses. Tests assert no automatic mutation retry and no use of shell invocation.
- Evidence serializer fixtures containing forbidden recursive keys/values such as `authorization`, `bearer`, `refreshToken`, `clientSecret`, `content`, `url`, `path`, `revision`, `operationId`, `stdout`, `stderr`, and `body`; serialization must fail closed. Assert allowable evidence has only its closed schema.
- Static/documentation assertions that check required secret/allowlist/platform/recovery language and reject live values/broad-access instructions. These must not inspect browser state or call external services.

## Expected unchanged boundaries

- `AGENTS.md` remains unchanged. The task uses a new project-scoped skill, not a broad repository-instruction rewrite.
- `src/http/**`, `src/application/**`, `src/domain/**`, `src/auth/**`, `src/drive/**`, `src/write-gate/**`, and `src/live-drive/**` remain owners of their existing service, Drive, credential, write-proof, and raw capability behavior.
- `docs/codex-cloud-preflight.md` remains the cloud workflow/runtime preflight; it may be linked but should not be repurposed into a client/deployment runbook.
- Cloud Run/Terraform, Secret Manager resource provisioning, gateway deployment/hostname choice, actual Codex environment secrets/egress configuration, Google Drive test-folder creation, and all live evidence are operator-owned external state.
- The JSON API and task-001 CLI route/error/output contracts are dependency inputs. Do not change them to accommodate the harness.

## Validation commands

Authoritative sources: `AGENTS.md`, `ARCHITECTURE.md`, `package.json`, and `scripts/verify-vendored-skills.sh`.

```bash
CI=true pnpm test -- tests/codex-cloud
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

Run focused tests only after their paths exist. Do not run the operator harness, `pnpm drive:probe`, a cloud setup, a gateway call, a DNS check, a live secret lookup, Google authentication, or a platform configuration mutation as part of routine validation.

## Selected external material

None was selected during shaping. Network access is intentionally out of scope for this planning task. The handoff's current Codex cloud reference is an operator-time verification source only; its moving platform behavior must be checked before live setup and captured in sanitized external evidence rather than copied into Git as a claimed fact.

## Uncertainties to verify

- Recheck the committed task-001 CLI executable/package script, command spelling, JSON fields, and stable exit codes. This plan follows its shaped contract but does not assume uncommitted implementation details.
- Verify the actual Codex cloud environment supports operator secret injection and exact hostname/method egress controls at the time of release. Document the observed limitation if either control is absent; do not broaden network scope or create an undocumented workaround.
- Verify the deployed gateway's canonical hostname does not redirect and supports the exact TLS/API behavior expected by the CLI before authorizing a live harness. The operator performs this only in the clean environment; no repository test may probe it.
- Verify the deployment's write gate has independently admitted the dedicated validation workflow before expecting create/update/archive to pass. A harness `UNSUPPORTED` result is evidence of a deployment gate, not a client reason to enable writes.
