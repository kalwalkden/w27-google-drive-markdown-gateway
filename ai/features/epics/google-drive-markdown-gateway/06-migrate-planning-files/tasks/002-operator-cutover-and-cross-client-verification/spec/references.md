# Operator Cutover and Cross-Client Verification — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| docs/planning-file-cutover.md (new) | current block, future authorized procedure, five-client checklist, recovery | Gives operators one accurate procedure without asserting that any live environment exists. |
| docs/planning-file-cutover-evidence.example.json (new) | synthetic, closed, content-free evidence template | Defines only retainable cutover facts and makes blocked/inconclusive states first-class. |
| src/planning-migration/cutover-evidence.ts (new) | evidence parser, redaction guard, transition reducer, exclusive external writer | Keeps preflight/evidence mechanics bounded and distinct from Drive/client/write authorization. |
| src/planning-migration/cutover-preflight-cli.ts (new) | opt-in preflight executable | Validates plan/checklist/output paths with no HTTP, child process, or mutation. |
| package.json | narrow migration:cutover-preflight script | Exposes only the compiled preflight after reconciling concurrent package changes. |
| tests/planning-migration/cutover-evidence.test.ts (new) | closed-schema/transition/redaction/output tests | Proves all blocked/failure paths stay safe using fake filesystem/clock seams. |
| tests/planning-migration/cutover-runbook.test.ts (new) | static policy/template tests | Locks current-runtime blockers, five-client coverage, source-of-truth declaration, and no-live boundaries. |

## Entry point and call path

~~~text
external non-secret checklist + task-001 verified plan + explicit preflight confirmation
  -> closed config/evidence parser
  -> transition/gate consistency validation
  -> atomic external sanitized evidence output
  -> operator-owned release decision

preflight -/-> md-drive, HTTP/MCP, Google SDK, Drive port, gateway endpoint, credentials,
              WriteGateDecision/WriteLease, shell, browser, macOS/iPhone/iPad control, mutation
~~~

The future, separate operator path is:

~~~text
current-platform controls + separately approved gateway/write proof
  -> exact direct-root destination check
  -> one manifest-approved create and exact readback
  -> fresh Work, clean Codex, macOS, iPhone, iPad read observations
  -> external source-of-truth/cutover evidence
~~~

## Contracts, state, and invariants

- Task 001 manifest/plan is the sole file allowlist and source checksum authority. This task does
  not parse source files, discover repository documents, or choose a Drive target.
- Evidence schema w27-planning-file-cutover-evidence-v1 has finite status values: NOT_STARTED,
  BLOCKED, PASSED, FAILED, and INCONCLUSIVE. Gate/client steps use only closed names and reason
  codes. Unknown fields and recursively forbidden sensitive-key names are invalid.
- Evidence carries opaque release/environment/client-profile references and plan/manifest digest
  only. It cannot contain file path/name, source bytes/digest, Drive ID, revision/ETag, endpoint,
  IP, account/device identity, token/secret/reference, protocol data, error/stack, or screenshot.
- The local preflight expects blocked write/archive conditions in the current repository. It rejects
  a completed source-of-truth declaration unless write/target/readback/client gates are consistently
  passed in externally obtained evidence; it never attempts to make those gates pass.
- A future mutation is one explicit approved create; collision, stale revision, timeout/transport
  ambiguity, invalid readback, missing client, or uncertain cleanup fails/inconclusively stops the
  procedure. No overwrite, auto-reread/retry, delete, trash, or archive fallback exists.
- A successful five-client check means read visibility of the same direct-root Markdown file, not
  five write attempts. Work and Codex need fresh configured environments; macOS/iPhone/iPad are
  manual operator observations.
- Cutover evidence is release documentation only. It has no code path to runtime configuration,
  principal verification, write-gate evidence, lease issuance, or Drive adapter behavior.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| src/live-drive/evidence.ts | strict versioned schema, recursive forbidden-key guard, atomic/exclusive external output | Reuse the safety model, not its raw Drive evidence fields or outcome semantics. |
| src/live-drive/config.ts | repository root and output-path containment/symlink checks | Reuse the local fail-closed filesystem posture. Do not import OAuth or test-root fields. |
| src/live-drive/cli.ts | import-safe ESM direct execution with fixed diagnostics | Reuse shape only; no auth, HTTP, process listeners, or Drive clients. |
| docs/live-drive-capability-harness.md | explicit confirmation, external configuration/evidence, dedicated recovery limits | Reuse operator discipline only. It cannot prove cross-client cutover or enable writes. |
| docs/write-gate-and-client-validation.md | client evidence has no effect on write authority | Preserve this separation for every cutover status and template. |
| task 03 Work package/live harness spec | fresh Work-session and operator-owned current-platform validation | Consume after its real package contract is committed; do not preconfigure a tenant. |
| task 04 CLI/setup spec | clean Codex setup, exact host GET/POST intent, stable CLI result | Consume after implementation; never duplicate HTTP or client credential logic. |
| task 05 operations spec | independent rotation/recovery, version-history/manual escalation, content-free retention | Keep cutover recovery consistent with current archive-disabled/no-delete runtime. |

## Tests and fixtures

- Synthetic valid/blocked/inconclusive evidence records with only opaque safe strings; fixture values
  never resemble a URL, token, Drive ID, file path/name, document text, account, or client device.
- Negative schema cases: unknown field, unknown status/reason/client, duplicate step, illegal
  transition, inconsistent completed declaration, missing required blocker, unsafe timestamp/length,
  forbidden nested keys, values, or arrays.
- Fake filesystem/output writer cases: repository-local output, existing output, symlink/output
  escape, write error, atomic exclusive create, restrictive permissions, deterministic clock/UUID,
  and proof no source content is emitted.
- Injected sentinels for child runner, HTTP/Drive client, md-drive, write gate, and browser/device
  driver. Every preflight path proves zero calls.
- Static runbook/template tests assert current WRITE_UNAVAILABLE/ARCHIVE_UNAVAILABLE gates, all five
  clients, exact-one-create/readback/no-retry, direct-root naming, source-of-truth declaration,
  no-delete/no-trash, external redaction, and no real values or claimed successful cutover.

## Expected unchanged boundaries

- Task 001 owns taxonomy, manifest parsing, source hashing, and plan construction. Do not duplicate
  or change its collision/source policy in task 002.
- Existing service code remains untouched: application, domain, Drive adapters, HTTP routes, MCP
  adapter, authentication, write gate, runtime, observability, and live Drive harness keep their
  existing behavior.
- Task 03/04 client implementation and platform configuration, Cloud Run/Terraform, Secret Manager,
  Google ACLs, gateway hostname, egress policy, operator credentials, and real client/device state
  are external release inputs.
- No changes to AGENTS.md, handoff, feature/task statuses, task list, build log, operations docs, or
  concurrent working-tree files.

## Validation commands

Authoritative sources: AGENTS.md, ARCHITECTURE.md, and package.json.

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

Routine checks must not run a cutover, preflight with real operator files, md-drive, Drive probe,
remote endpoint, OAuth/JWKS/Google/Secret Manager call, browser/device control, cloud environment
change, Docker, Terraform, or gcloud.

## Selected external material

None. The handoff, approved feature/task artifacts, current direct-root/write-disabled runtime, and
repository operator patterns are binding. Platform behavior is a release-time operator check.

## Uncertainties to verify

- Task 001 must be implemented and its final plan/result format rechecked before sharing types or
  importing it from the preflight CLI.
- Task 03 and task 04 must be implemented and their final Work/CLI artifact contracts rechecked
  before an operator runbook names exact commands or configuration mechanisms.
- Before live release, independently verify the deployment still lacks a write session and archive
  support unless an approved later task has changed both with a valid atomic proof; do not infer
  either capability from a source revision or a static test.
