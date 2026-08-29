# Operator Cutover and Cross-Client Verification — Implementation Plan

## Scope

Add an operator-only cutover runbook, a strict external evidence schema/validator, and a
reviewable preflight harness for the approved planning-file manifest. The harness validates local
manifest state and records a deliberately bounded operator checklist; it does not create, update,
archive, delete, trash, or copy Drive files in the current runtime.

The procedure describes a future authorized cutover and five-client verification for ChatGPT Work,
Codex cloud, macOS, iPhone, and iPad. It accurately stops at the present gates: no deployed
endpoint, credential, device control, configured client, production write session, or archive
capability is available in this repository. A blocked preflight is useful release evidence, not a
failed implementation test and not permission to bypass a gate.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| Task 001's manifest is the only content allowlist. | Cutover inputs are a specific validated manifest plan plus external operator configuration. Never scan the repository, infer an active document, accept a source glob, or perform a bulk migration. | Task 001 spec; Epic 6; brief. |
| Current runtime has no write session and archive is unavailable. | The checked-in harness is preflight/evidence-only. It reports WRITE_UNAVAILABLE or ARCHIVE_UNAVAILABLE as a stop condition, performs no mutation, and never labels a blocked migration complete. | runtime server; MarkdownService archive behavior; deployment/operations docs. |
| The clients share one Drive document but have different setup owners. | Use the same verified direct-root target for read visibility checks only after an authorized copy exists. Work validates a fresh private session/MCP route; Codex validates a clean cloud environment through the checked-in CLI; Apple clients are manual Drive-client observations. | Epic 3/4 plans; Epic 6; user direction. |
| Every write is revision-safe and no permanent deletion exists. | Future copy must fail on target collision, make one explicit create attempt only after all gates pass, read back the exact target, and never overwrite/retry/delete/trash. Because archive is disabled, uncertain mutation requires operator recovery, not cleanup automation. | Handoff; JSON API/CLI plans; Drive core; operations plan. |
| Codex CLI is a fallback JSON client, not a Drive implementation. | A future Codex check uses committed md-drive and only its stable JSON/exit contract. The harness does not import fetch, Google SDKs, Drive adapters, routes, or bearer parsing, and cannot create a write lease. | Epic 4 specs; current boundaries. |
| Work private-plugin/OAuth and Codex cloud controls change. | The runbook requires release-time verification and capture of opaque identifiers/statuses. Do not hard-code tenant manifests, OAuth/JWT values, UI steps, environment mutations, or claim a policy without evidence. | Epic 3/4 specs; handoff. |
| Live evidence is external and content-free. | The repository stores only a synthetic schema/template. Real evidence is written to an unused external path and retained in approved access-controlled storage. It excludes target name/path, content/digest, Drive ID, revision, endpoint/URL/IP, bearer/secret/JWT/reference, response/body/header, error text/stack, screenshot, and device/account identifiers. | AGENTS.md; live-drive evidence; client-validation and operations specs. |
| Git and Drive have disjoint authority. | Completion records Drive as canonical for the verified manifest entry and Git as the frozen bootstrap reference. Git-owned code/executable feature specs/operations docs remain excluded. No sync or automatic rewrite follows. | Task 001 policy; user direction. |

## Operator-only cutover contract

Create docs/planning-file-cutover.md and docs/planning-file-cutover-evidence.example.json. Add
src/planning-migration/cutover-evidence.ts and a narrow migration:cutover-preflight executable that
validates an external non-secret operator checklist/evidence draft against a closed schema. It may
invoke task 001's plan library in-process, but never invokes a shell, md-drive, network client,
Drive probe, browser, or device service.

The evidence version is w27-planning-file-cutover-evidence-v1. It has only allowlisted facts:
schema version; opaque release/environment/client-profile references; plan/manifest digest;
timestamp; direct-root topology; per-gate status/reason code; per-client status; source-of-truth
declaration; and follow-up/cleanup state. Use only closed statuses NOT_STARTED, BLOCKED, PASSED,
FAILED, and INCONCLUSIVE, with finite reasons including WRITE_UNAVAILABLE, ARCHIVE_UNAVAILABLE,
CLIENT_NOT_CONFIGURED, DESTINATION_COLLISION, READBACK_MISMATCH, CONFLICT,
TRANSPORT_UNCERTAIN, and MANUAL_RECOVERY_REQUIRED. Reject unknown keys and recursively reject
sensitive names including content, path, name, fileId, revision, url, authorization, bearer, token,
secret, header, body, response, error, stack, stdout, stderr, and screenshot.

The cutover document gives this state machine. Every state has a stop condition; none is an
automated retry:

~~~text
reviewed manifest plan
  -> operator authorization + external config/secret/egress/client preflight
  -> write-gate and direct-root capability evidence accepted?
  -> destination collision/ambiguity check
  -> one explicit operator copy attempt for one manifest entry
  -> revision/byte-equivalent readback
  -> fresh Work + clean Codex + macOS + iPhone + iPad read visibility
  -> source-of-truth declaration + external sanitized evidence
~~~

The current expected local result ends after preflight with BLOCKED/WRITE_UNAVAILABLE unless an
operator has independently configured an approved deployment/write proof. Do not add a test-only
switch or environment variable that changes this result. The tool rejects an evidence draft marked
PASSED when prerequisite gates are blocked or absent.

For future live execution, the document requires every item below before a single mutation:

1. A clean checkout passes the local integrity/build suite, and task 001 produces a matching plan.
   The operator records only opaque release/environment references externally.
2. The operator verifies current Work registration/OAuth controls, Codex secret injection, exact
   HTTPS hostname restriction, and only GET/POST methods required by the CLI. If method-level policy
   is unavailable, record the limitation; never broaden Internet access.
3. The operator separately verifies a deployed read path, dedicated Drive root, direct-root
   destination, write-gate evidence/approval/lease, and empty exact target. Health is process-only
   and cannot satisfy Drive or write checks.
4. The operator makes one exact manifest-approved create through an approved client. On timeout,
   malformed response, or transport uncertainty, stop: do not retry or assume absence. On
   collision/ambiguity, stop without overwrite. After successful create, read back the exact target
   and compare to source bytes under access-controlled operator handling.
5. Each client opens the same direct-root Markdown document and performs a read-only visibility
   check. Work uses a fresh private session and supported MCP flow. Codex uses a fresh clean cloud
   session/CLI with no Google credential. macOS, iPhone, and iPad use normal Drive clients under the
   approved account. No device writes as a convenience.
6. Mark Drive canonical only after all required reads pass and the operator records external
   sanitized evidence. Missing clients, uncertain results, or cleanup uncertainty keep cutover
   incomplete. Archive is never a fallback while unavailable.

## Detailed implementation approach

1. Reuse task 001 strict manifest/plan types. Add a typed finite evidence parser/validator and an
   injectable clock/filesystem writer. The writer creates an unused external path atomically with
   restrictive permissions and rejects repository-local or symlinked paths, following live-evidence
   safety posture.
2. Add a preflight state reducer. It accepts only validated plan summary and non-secret checklist
   facts; it cannot accept an endpoint, hostname, credential, path, Drive ID, revision, or arbitrary
   diagnostic text. It creates a bounded blocked/incomplete summary or structurally ready checklist,
   never a claim that a live copy occurred.
3. Provide direct execution with a required confirmation literal
   W27_PLANNING_CUTOVER_PREFLIGHT_ONLY, external config, and external evidence output. Validate
   inputs before writing evidence; use no child-process runner. Name the script preflight-specific,
   never cutover or migrate, so ordinary invocation cannot look like live execution.
4. Write separate current-block and future-authorized sections. Include collision/uncertain-state/
   manual-recovery escalation, revision/read-before-write rules, no-delete/no-trash/no-archive
   fallback language, client checkboxes, source-of-truth declaration, and no-secret evidence rules.
5. Add fake/static tests under tests/planning-migration for success-shaped non-live preflight, each
   absent/blocked prerequisite, invalid status transition, sensitive/unknown evidence field,
   repository/symlink/existing output path, exclusive output, restrictive mode, confirmation/config
   rejection, no shell/client invocation, and static runbook/template boundaries. Prove a blocked
   gate creates no planned mutation call and a client failure cannot be reported complete.

## Expected control flow and invariants

~~~text
task-001 verified manifest plan + external non-secret preflight config
  -> closed checklist/evidence validator
  -> external, exclusive, sanitized evidence draft
  -> operator decides whether separately authorized live cutover may begin

preflight harness -/-> HTTP/MCP/Drive, md-drive, shell, credential, write gate, browser, device, mutation
~~~

- A preflight PASS means only local checklist/evidence grammar is internally consistent. It does not
  prove client configuration, Drive reachability, destination emptiness, or write authorization.
- WRITE_UNAVAILABLE, ARCHIVE_UNAVAILABLE, collision, stale revision, or transport uncertainty is
  terminal for the relevant attempt. There is no automatic retry, cleanup, or fallback mutation.
- Cross-client completion requires all five read observations on the same direct-root file. A
  screenshot, health response, or local test cannot substitute for an observation.
- No evidence schema/template/harness state can feed WriteGateDecision, create WriteLease, or affect
  runtime write composition.

## Current-tree evidence and unchanged boundaries

Task 001 has only been shaped; its planner is not yet implemented. Task 03 Work packaging and task
04 md-drive CLI/harness are likewise planned artifacts, so this task uses adapters and defers exact
executable integration until their committed contracts exist. Existing src/live-drive is raw Drive
capability evidence and stays separate: it can use external Google credentials/a dedicated root;
this cutover tooling cannot read a Google credential or substitute raw Drive proof for client
verification.

MarkdownService rejects nested/recursive reads and archive; production has no write session. The
deployment guide says protected writes remain unsupported. Current working-tree source/package
changes are unrelated and must be preserved.

Do not change status/task/build-log/handoff/AGENTS artifacts, product application/domain/Drive/HTTP/
MCP/auth/write-gate/runtime behavior, client/deployment configuration, operations procedures,
secrets, cloud/Drive state, or device/client configuration. Do not create or commit live evidence.

## Test strategy and validation

~~~bash
CI=true pnpm test -- tests/planning-migration
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
~~~

Do not run preflight against operator input, invoke md-drive, create a cloud session, change an
allowlist, contact a deployed endpoint, launch a browser/device, run the live Drive probe, load a
secret, or use Docker/Terraform/gcloud during implementation or tests.

## Risks and careful checks

- Do not make future procedure prose sound like a live migration occurred. The current state is
  blocked until independent operator conditions are met.
- No archive fallback exists. An uncertain create cannot be silently cleaned up; preserve external
  evidence and escalate to the authorized Drive administrator.
- Do not record source/target filenames, content digests, IDs, revisions, endpoint, or client/device
  details in cutover evidence. The manifest is reviewable intent; release evidence is not.
- Recheck completed Work/CLI interfaces before replacing fake seams. Do not hand-roll HTTP or make
  preflight depend on uncommitted command syntax.

## Open questions

None. Operator authorization, deployment, write approval, Drive root, clients, devices, profiles,
network/secret controls, and live results are intentionally out-of-repository gates.
