# Client and Operator Release Gates — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `plugin/chatgpt-work/instructions.md` | Work operating instructions | Replace direct-root/lease/blocked wording with nested read-before-write, exact revision, archive confirmation, conflict, timeout, and `OUTCOME_UNKNOWN` reconciliation. |
| `plugin/chatgpt-work/README.md` | private-package operator guide | Keep secret-free tenant setup while describing default-off deployment authority and the post-gate Work flow. |
| `plugin/chatgpt-work/live-validation-checklist.md` | manual Work release checklist | Define the dedicated nested test-folder sequence, stale/unknown stop conditions, archive-only cleanup, and evidence limitations. |
| `plugin/chatgpt-work/private-package.template.json` | closed Work input template | Remove stale disabled/lease claims; retain exactly six tool names and non-authoritative/default-off safety fields. |
| `plugin/chatgpt-work/release-evidence.template.json` | Work evidence template | Add closed outcome categories and image/config/live-probe digest references without locations, credentials, or live-success claims. |
| `.agents/skills/codex-cloud-markdown-gateway/SKILL.md` | project-scoped Codex operating skill | Align CLI-only nested mutation/reconciliation instructions with Work and retain the no-provisioning/no-release-execution boundary. |
| `docs/codex-cloud-client-setup.md` | Codex operator setup/release guide | Replace baseline blocked state with default-off gating, exact CLI recovery behavior, dedicated-tree constraints, and narrow egress guidance. |
| `src/codex-cloud/harness.ts` | `cloudHarnessConfigSchema`, `runHarness`, sequence/evidence/redaction schemas | Replace hard-coded direct-root/disabled future test seam with the explicit gated nested client sequence, duplicate/stale/unknown stop rules, digest-bound evidence, and strict sanitization. |
| `src/codex-cloud/harness-cli.ts` | external config loading, `mdDriveRunner`, external evidence publisher | Preserve `shell: false`, filtered environment, external regular config/output, symlink rejection, 0600 exclusive publication, and nonzero non-pass status while consuming the revised harness contract. |
| `tests/codex-cloud/harness.test.ts` | fake runner and harness contract tests | Prove static stage ordering, no retry/automatic cleanup on all ambiguous outcomes, default-disabled reporting, redaction, and filesystem safeguards. |
| `tests/codex-cloud/docs.test.ts` | client-guidance asset assertions | Replace current blocked/direct-root assertions with the final no-retry, nested, default-off, and unknown-reconciliation contract. |
| `tests/plugin/chatgpt-work-package.test.ts` | Work package asset assertions | Enforce six tools, matched Work safety guidance, digest-only evidence, and absence of stale lease/direct-root/credential material. |
| `docs/live-drive-capability-harness.md` | provider probe operator guide | Explain that the marked root/archive probe precedes, but never authorizes, the controlled gateway/client gates. |
| `docs/write-gate-and-client-validation.md` | release-gate runbook | Rewrite obsolete JWS/lease procedure as the ordered human/operator gate while preserving its inbound links. |
| `docs/cloud-run-deployment.md` | controlled deployment/rollback guide | Document task-002 false defaults and reviewed `enable_write`/`acknowledge_write_risk` gate, exact image/config digests, and disabled rollback. |
| `infra/terraform/terraform.tfvars.example` | safe non-secret configuration example | Include explicit false write settings introduced by task 002; no resource behavior, values, or secrets change here. |
| `docs/threat-model.md` | data-flow, assets, abuse/residual-risk records | Replace baseline direct-root/lease descriptions with topology concurrency residuals, deployment authority, no-delete, and reconciliation requirements. |
| `docs/observability-contract.md` | closed terminal result documentation | Record only `outcome_unknown` as the new terminal category and restate content-free evidence/telemetry constraints. |
| `docs/client-validation-record.example.json` | combined sanitized release record example | Bring example vocabulary and digest references into alignment with separate Work/Codex evidence and no-live-success policy. |
| `tests/deployment/assets.test.ts`, `tests/observability/audit.test.ts` | static contract coverage | Keep examples/docs/closed telemetry aligned without Terraform, cloud, or network execution. |

## Entry point and call path

```text
normal Codex work
  -> repository skill
  -> node dist/codex-cli/cli.js only
  -> authenticated JSON API
  -> final shared MarkdownService six-operation contract

operator release check (explicit confirmation; external config/output only)
  -> pnpm codex-cloud:harness
  -> harness-cli external-file and environment guards
  -> injected md-drive command runner (GET/POST only)
  -> nested list/search/read/create/duplicate/update/stale/archive state machine
  -> strict, digest-bound, content-free evidence OR opaque manual-recovery direction

separate provider capability gate
  -> pnpm drive:probe (operator action only)
  -> marked disposable root + direct child archive / raw Drive If-Match evidence
  -> sanitized evidence digest used in release review only
  -/> runtime write mode, client authority, Codex harness execution, or service composition
```

## Contracts, state, and invariants

- Final task-001 scoped topology contract accepts only root-confined, uniquely resolved nested paths
  and verified file IDs. Clients never recreate that validation and must stop on `AMBIGUOUS_PATH`,
  `RESULT_LIMIT`, or a safe absence.
- Final task-002 `write.enabled` normalizes to false when missing; Terraform `enable_write` and
  `acknowledge_write_risk` default false. An enabled mode creates only server-side Drive authority;
  Work and Codex gateway credentials remain distinct principals and never reach Google.
- Final task-003 create/update/archive dispatch only once, require exact revisions where applicable,
  have no delete/trash/rollback/retry path, and add `OUTCOME_UNKNOWN` as an HTTP 503 / fixed-message
  result. Codex CLI accepts it strictly and exits 9. Treat route timeout/transport uncertainty the
  same for client recovery.
- The harness’s output may contain only the approved schema fields. It must not contain the external
  config’s nested paths, actual generated relative path, content, file ID, revision, endpoint,
  operation ID, stdout/stderr, credentials, raw provider result, config payload, or image location.
  It can include a run UUID and the three `sha256:` references.
- The sole automatic cleanup is revision-checked archive after the exact same returned ID and
  expected archive relative path are proved. Any potential create/update/archive uncertainty makes
  cleanup manual and evidence inconclusive. Manual direction is fixed and carries an opaque run
  reference only.
- `src/live-drive/probe.ts` remains a raw provider experiment with its own schema. It marks/validates
  a dedicated test root and direct archive child, runs two stale `If-Match` probes, and archives its
  own generated file. It is never imported by runtime/client release code.
- `MarkdownApiAuditResult` and `MarkdownMetricObservation` stay closed. The task-003
  `outcome_unknown` atom has no associated event field/label for image/config/evidence/mutation
  state. Documentation must not suggest otherwise.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/codex-cloud/harness-cli.ts` | canonical external file checks, no-follow/exclusive output, 0600 mode, `shell: false`, filtered environment, bounded stdout | Preserve every operational safety property while the harness contract changes. |
| `src/codex-cloud/harness.ts` | strict Zod schemas, strict CLI response parser, injected fake runner/time/UUID, per-stage outcomes, `finally` cleanup, recursive evidence-key rejection | Extend the state machine for final capabilities; remove only the obsolete hard-coded profile/test bypass. |
| `tests/codex-cloud/harness.test.ts` | deterministic fake command runner with sentinel values and dispatch counters | Add every final stop/recovery case without network or actual client invocation. |
| `src/live-drive/config.ts`, `probe.ts`, `evidence.ts` | explicit confirmation, marked dedicated root, raw provider stale test, archive-only cleanup, strict sanitized evidence | Keep as an independent prerequisite/evidence source, not a gateway authority dependency. |
| `src/codex-cli/cli.ts` | strict success/error response parsing, exit classification, locator recovery, no redirect/retry | Codex instructions/harness must follow its final `CONFLICT` and `OUTCOME_UNKNOWN` behavior, not implement a parallel HTTP protocol. |
| `plugin/chatgpt-work/*` | secret-free example identifiers, six fixed tools, Work confirmation text, static asset checks | Retain template format and improve only final client/release semantics. |
| `docs/cloud-run-deployment.md` | explicit acknowledgement review and non-destructive rollback narrative | Extend it with task-002 default-off write settings and digest-gated client release conditions. |
| `docs/observability-contract.md` and `src/observability/audit.ts` | closed typed terminal vocabulary and prohibited-data list | Document the final atom; do not add generic evidence/config telemetry. |

## Tests and fixtures

| Path | Required coverage |
| --- | --- |
| `tests/codex-cloud/harness.test.ts` | strict nested config/digest validation; exact request order; one create, duplicate create/refusal, update, stale update/refusal, archive; disabled/unsupported report; all unknown/timeout/protocol/mismatch stop states; no automatic cleanup/retry; output schema/redaction; filesystem safeguards. |
| `tests/codex-cloud/docs.test.ts` | CLI-only, nested path, read-before-write, exact revision, conflict/unknown/timeout recovery, default-off, GET/POST-only/no-secret/no-direct-Google content. |
| `tests/plugin/chatgpt-work-package.test.ts` | six tools, Work wording parity, explicit archive confirmation, non-authoritative evidence, digest-only template, no stale blocked/lease direct-root claims, credential-free assets. |
| `tests/codex-cli/cli.test.ts` | Use final existing fake transport tests to verify exact `OUTCOME_UNKNOWN` parsing/exit 9 and no retry; do not invoke a live client. |
| `tests/live-drive/probe.test.ts`, `tests/live-drive/evidence.test.ts`, `tests/live-drive/config.test.ts` | existing dedicated marker/direct-child archive/stale/no-delete/sanitization behavior remains independent; cover only task-004 documentation/schema changes if made. |
| `tests/deployment/assets.test.ts` | false write defaults, task-002 acknowledgement wording, safe Terraform example/docs, no credential payload. |
| `tests/observability/audit.test.ts`, `tests/http/json-api.test.ts`, `tests/mcp/stateless-mcp.test.ts` | final unknown terminal category stays closed/redacted; no release-evidence values enter telemetry. |

All fixtures use the literal synthetic `example-*` identifiers, zero SHA-256 placeholders, test UUIDs,
inert content, and fake timestamps. Do not use a secret-looking bearer, actual Drive ID, endpoint,
or external config/output path as a fixture assertion.

## Expected unchanged boundaries

- `src/application/**`, `src/domain/**`, `src/drive/**`, `src/auth/**`, `src/runtime/**`,
  `src/http/**`, `src/mcp/**`, and most of `src/codex-cli/**`: final behavior is owned by tasks
  001–003. This task documents/tests their delivered public contract only.
- `infra/terraform/cloud-run.tf`, `infra/terraform/variables.tf`, and all secret/IAM resources:
  task 002 owns the implementation. Task 004 may only make an existing safe example/documentation
  accurate after verifying its final names.
- Live Drive/Work/Codex actions, secret injection, tenant configuration, Cloud Run/Terraform state,
  Drive ACLs, and evidence generation are external operator actions.
- Feature/task status, task list, visual design, build log, commits, handoff, dependencies, and all
  unrelated user working-tree changes remain outside scope.

## Validation commands

Authoritative source: `AGENTS.md`, `package.json`, and `ARCHITECTURE.md`.

```bash
./scripts/verify-vendored-skills.sh
CI=true pnpm test -- tests/codex-cloud/harness.test.ts tests/codex-cloud/docs.test.ts
CI=true pnpm test -- tests/plugin/chatgpt-work-package.test.ts tests/codex-cli/cli.test.ts
CI=true pnpm test -- tests/live-drive/probe.test.ts tests/live-drive/evidence.test.ts tests/live-drive/config.test.ts
CI=true pnpm test -- tests/deployment/assets.test.ts tests/observability/audit.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
CI=true pnpm check
git diff --check
```

Do not run `pnpm drive:probe`, `pnpm codex-cloud:harness`, Terraform, Docker, `gcloud`, OAuth/JWKS,
or live Drive/Work/Codex requests while shaping or implementing this task.

## Selected external material

None. Binding inputs are the approved feature/task artifacts, handoff, repository instructions,
feature-level operation-flow visual, current committed tree at
`e36ccaba9d7070e35b146bfd965e62880f8b7a8f`, and final dependent task contracts. No moving external
reference is selected as policy.

## Uncertainties to verify

- Verify task-001/002/003 final public symbols, Terraform variables, config schema, and exact
  `OUTCOME_UNKNOWN` CLI parser before implementation. Do not copy baseline direct-root/lease seams
  into final documentation or harness code.
- Confirm final create duplicate refusal is the task-003 stable `CONFLICT` public outcome. If the
  approved final contract uses another explicit stable code, update the one expected outcome in the
  harness and all client evidence templates together; do not treat generic 409/503 as success.
- Confirm the final Codex CLI’s fixed unknown message/exit remains accessible to a fake runner. Its
  parser must be strict enough to reject changed text/status/schema rather than misclassifying an
  arbitrary service failure as a safe reconciliation state.
