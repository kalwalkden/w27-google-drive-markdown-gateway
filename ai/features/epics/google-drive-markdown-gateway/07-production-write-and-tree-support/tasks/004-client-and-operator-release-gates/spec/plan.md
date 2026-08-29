# Client and Operator Release Gates — Implementation Plan

## Scope

Align the checked-in Work package, project-scoped Codex skill/client guidance, operator runbooks,
sanitized release templates, and the opt-in Codex cloud harness with the six-operation nested-tree
contract delivered by tasks 001–003. The result is documentation and fake/static release-gate
coverage only. It must never contact Drive, Work, Codex, Cloud Run, Terraform, a credential
provider, or an endpoint during implementation or validation.

The shaping baseline is committed HEAD `e36ccaba9d7070e35b146bfd965e62880f8b7a8f`. The working
tree also contains task-001 implementation changes and an untracked task-003 spec package. They
are dependent-task context only and are not part of this task’s edit set. Before implementing,
verify the final task-001/002/003 contracts; in particular, use the final `OUTCOME_UNKNOWN` public
pair and the final task-002 Terraform names instead of retaining the baseline’s lease language.

## Binding decisions and constraints

| Decision | Implementation effect | Provenance |
| --- | --- | --- |
| The gateway exposes six operations over verified nested paths. | Work and Codex guidance must describe `list_markdown`, `search_markdown`, `read_markdown`, `create_markdown`, `update_markdown`, and `archive_markdown` as the only supported gateway operations. A relative path is not a shell path and must be exact, unique, root-confined, and safe; clients never compensate for an ambiguity with raw Drive, HTTP, or another client. | Approved feature requirements and task brief. |
| Read-before-write is a client safety protocol, not authorization. | Before update or archive, clients list/search as needed, read the target, retain the exact opaque revision, then issue one explicit mutation. Create requires an exact intended nested path and must refuse an existing leaf. Archive still needs explicit user confirmation unless already explicitly requested. | Handoff UX requirements; feature decisions; task brief. |
| `CONFLICT`, route timeout, and `OUTCOME_UNKNOWN` require reconciliation, never automatic retry. | On `CONFLICT`, reread, show the user that newer state exists, and wait for a choice. On `OUTCOME_UNKNOWN` or timeout/transport uncertainty after a possible mutation, stop all mutation/cleanup automation and direct a manual reread by the known locator/opaque ID before any later mutation. Never infer success from a timeout, retry, overwrite, roll back, trash, or delete. | Feature concurrency/unknown-outcome decisions; task-003 spec. |
| Runtime write authority is deployment-owned and default-off. | Documentation and examples say an absent or false `write.enabled` is read-only. Terraform’s `enable_write = false` and `acknowledge_write_risk = false` remain explicit defaults. A harness record, Work installation, Codex setup, live probe, image, or client credential cannot enable writes. | Feature runtime-write and release-gate decisions; task-002 spec. |
| Live evidence is an operator release input, not a success claim or a runtime credential. | The raw Drive capability probe remains separate and validates only the marked disposable Drive root/archive. The client harness validates the gateway/client flow only after an operator has selected a controlled write-enabled revision. Evidence stores only stable status categories, opaque run references, and non-secret digests; it contains no path, ID, revision, document bytes, endpoint, token, header, provider detail, or raw command output. | Feature validation gates; task brief; existing live-drive evidence boundary. |
| One release record must bind evidence to the exact tested deployment. | External harness configuration and output include immutable `gatewayImageDigest`, `runtimeConfigDigest`, and `liveCapabilityEvidenceDigest`, all strict `sha256:<64 lower-hex>` digests. These are the exact image/config/evidence references; do not write root/archive IDs, full configuration, a Terraform plan, or a URL into the record. The operator checks that the controlled revision’s immutable OCI image and canonical non-secret runtime-config digest match them before interpreting an evidence result. | Task brief requirement for exact image/config references; feature release flow. |
| The live test tree is dedicated, marked, and disposable. | The raw probe’s `w27MarkdownGatewayTestRoot = v1` marker and direct-child archive topology stay mandatory. The controlled gateway revision must be configured to that same root/archive pair. The client harness is restricted to a pre-provisioned nested relative validation folder within it; it creates only one UUID-derived Markdown leaf and archives only that returned identity. It creates no folders and performs no delete, trash, sharing, rename, or broad pattern cleanup. | Existing live-drive harness; feature no-delete/root rules; task brief. |
| Local/test behavior stays disabled unless an explicit external release run is invoked. | Unit tests call the harness only with injected fake runners. The production harness CLI remains guarded by its external-config/outside-repository-output checks and `W27_CODEX_CLOUD_TEST_ONLY` confirmation. It must not contain a hidden future-capability switch or a test-only path that production execution could use. A default-disabled runtime result is reported as `UNSUPPORTED`/inconclusive without a follow-up mutation. | Task brief; existing harness safety design; feature default-deny decision. |
| Telemetry is closed and content-free. | Task 003’s one new terminal category is `outcome_unknown`; threat and observability documentation must name no other added labels. Evidence and tests must prove that paths, names, queries, bodies, excerpts, revisions, IDs, credentials, raw statuses, headers, provider messages, and operation IDs do not enter audit, metric, or release-evidence fields. | Feature constraints; task-003 spec; observability contract. |

## Visual design

Use the approved feature-level flow at
`ai/features/epics/google-drive-markdown-gateway/07-production-write-and-tree-support/visuals/operation-flow.md`.
There is no new UI. Its first diagram supplies the client reconciliation rules; its second diagram
is the required operator order: reviewed immutable image → marked dedicated test root/archive →
provider capability evidence → reviewed Terraform write enablement → controlled revision → separate
Work and Codex flows → release decision/disabled rollback. This task must not duplicate or alter the
feature-level visual.

## Product alignment

The handoff deliberately centralizes Google Drive access in the gateway. Work and Codex authenticate
only to that gateway and remain separate principals. Their instructions must make the safest action
the easy action: call the checked-in MCP tool or `md-drive` client, retain opaque values only in the
active operation, confirm archive intent, and stop when the final state cannot be proved. A passing
test or harness is evidence for a human release decision, not authority to broaden access.

## Detailed implementation approach

### 1. Replace obsolete client and package guidance with the shared six-operation protocol

Update `plugin/chatgpt-work/instructions.md`, `README.md`,
`live-validation-checklist.md`, `private-package.template.json`, and
`release-evidence.template.json`. Preserve the existing secret-free template posture and exactly six
MCP tool names. Remove all wording that says current production is direct-root-only, archive is
blocked, a write lease exists, or an observed `UNSUPPORTED` result is the intended release success.

The Work instruction sequence is exact:

1. For discovery, use `list_markdown` in an optional exact nested folder (and `recursive` only when
   needed), or `search_markdown` scoped to that folder. Treat a result limit, missing result, or
   ambiguity as a stop condition.
2. Before update/archive, call `read_markdown` using the chosen path or opaque file ID and retain its
   returned opaque revision. Create only at an intended `.md` path in an already existing verified
   folder; never turn a duplicate refusal into an update.
3. Make one update with that revision. On `CONFLICT`, reread and wait for the user; on
   `OUTCOME_UNKNOWN` or a timeout, do not retry, archive, clean up, or state that the write failed.
   Reread/reconcile manually before any further mutation.
4. Ask for explicit user confirmation before archive unless it is already explicit. Archive with the
   revision just read; it moves one file to the configured archive and never deletes/trashes it.
   `CONFLICT`, `OUTCOME_UNKNOWN`, and timeout have the same stop/reconcile rule.
5. `UNSUPPORTED` means the independently configured gateway write mode is disabled or unavailable;
   it is not permission to bypass the gateway. Work tool annotations/confirmation do not grant
   server-side Drive access.

The Work manual checklist becomes a post-controlled-deployment operator check. It requires the
exact `/mcp` endpoint and tenant configuration to be kept outside Git, validates all six operations
against one pre-provisioned nested disposable test folder, requires one stale update refusal and
verified archive, and records an inconclusive/manual-recovery result for an uncertain mutation. It
must state that a client check is never performed until the provider probe, reviewed Terraform plan,
and controlled image/config gates are satisfied. Cleanup is archive-only and only after a verified
current identity/revision; no broad cleanup/delete/trash fallback is permitted.

Revise the Work template’s safety facts and release-evidence shape to record only safe identifiers
and outcome categories. Include the three required digests, six operation statuses, stale refusal,
archive verification, cleanup state, and `releaseEvidenceRuntimeAuthority: false`. Keep all actual
tenant values, endpoints, root/archive locations, document data, revisions, file IDs, credentials,
and raw transcripts outside Git and outside the evidence schema.

### 2. Give Codex the identical operating and reconciliation guidance

Update `.agents/skills/codex-cloud-markdown-gateway/SKILL.md` and
`docs/codex-cloud-client-setup.md`. The skill continues to use only the built checked-in command
`node dist/codex-cli/cli.js`/`md-drive`; it must prohibit raw HTTP, `curl`, Google APIs, direct Drive
credentials, and egress broadening. Replace the obsolete blocked/direct-root/lease wording with the
same six-operation lifecycle as Work.

Document concrete CLI use without recording real values: list/search may accept nested `--path`,
read returns the opaque revision, update/archive use exactly that revision, and archive requires
explicit user intent. The document must name task-003’s exact fixed `OUTCOME_UNKNOWN` behavior:
the CLI’s exit 9/error pair directs a read/reconcile; a local timeout or transport failure is also
potentially applied state and must receive no automatic retry. Existing conflict recovery remains a
manual reread/user-choice path. `UNSUPPORTED` retains its disabled-mode meaning.

Keep the cloud setup constraints: exactly one injected Codex bearer, one canonical HTTPS hostname,
only `GET` and `POST`, no redirects/proxies/wildcards/Google egress, and no secret in source,
prompts, command arguments, diagnostics, or evidence. Adjust language from “current status is
blocked” to “local/default configuration is write-disabled; an operator-only release invocation is
eligible only after the separate gates.” The skill itself remains for ordinary gateway work, not
provisioning or release execution.

### 3. Turn the Codex harness into the release-gated nested test sequence

Refactor `src/codex-cloud/harness.ts` and its external CLI wrapper without weakening filesystem,
process, environment, output-permission, or no-overwrite protections. Remove the baseline’s
`testOnlyFutureCapabilities` capability bypass and its shipped hard-coded direct-root/disabled
profile. `runHarness` always runs the sequence only after strict external configuration and explicit
confirmation; normal application/test execution does not invoke it.

Use a strict external config with these safe fields:

- `cliExecutable: "md-drive"`, bounded timeout, platform-control statuses, and safe example-only
  environment/hostname identifiers as today;
- `validationFolder`: a strict safe **nested** relative folder path (at least two segments, no
  absolute/traversal/empty segment), provisioned by the operator beneath the marked test root;
- `archiveFolder`: the safe expected relative archive folder path; and
- `gatewayImageDigest`, `runtimeConfigDigest`, and `liveCapabilityEvidenceDigest`: lower-case
  SHA-256 digests only.

Do not add folder IDs, a config file path, URL, actual image registry name, token, or marker value to
the evidence. The external config may contain the safe relative locations needed to operate, but
output redaction must reject those keys/values recursively. The evidence schema should retain only
the run UUID, timestamps, the three digests, safe environment/hostname identifiers, `GET`/`POST`,
platform-control statuses, closed capability expectation (`nested-tree`, `writes-enabled`,
`archive-enabled`), closed stage outcomes, stale-conflict/duplicate-refusal/cleanup summaries,
manual-recovery direction, and `redaction: "passed"`. Evidence must be strict/no-extra-fields and
must reject values containing sensitive dynamic data, not merely forbidden keys.

The one-run sequence is deterministic and stops on the first unsafe state:

1. `list --path <nested validation folder> --recursive`, list the configured archive folder, and
   `search` within the nested validation folder. Each must return a valid bounded response before a
   mutation begins.
2. Create one UUID-derived `.md` file in that nested folder from a private `0600` temporary file.
   Verify returned metadata has exactly the generated relative path; then read by its returned opaque
   ID and prove identity, revision, and temporary content match.
3. Attempt a second create at the exact same path and require the final task-003 duplicate-refusal
   public outcome (`CONFLICT`). Then reread the first file and prove it is unchanged. A success,
   different error, malformed response, or uncertainty stops the run and bars automatic archive.
4. Update once with the current exact revision; reread by ID and prove new content and a changed
   revision. Attempt one stale update with the prior revision; require `CONFLICT`; reread and prove
   the fresh state survived.
5. Archive once with the current verified revision, then verify returned metadata identifies the same
   file ID at exactly `<archiveFolder>/<generated basename>`. This is the sole automatic cleanup and
   is permitted only after every preceding state is verified. It never calls delete/trash or an
   unconditional archive fallback.

When create, duplicate create, update, stale update, archive, CLI timeout/transport failure,
protocol failure, or `OUTCOME_UNKNOWN` could leave a mutation’s final state unclear, stop immediately.
Do not retry, do not reread automatically, and do not archive automatically. Produce an
`inconclusive` evidence result with only the UUID run reference and a fixed manual direction:
`manually-reread-the-exact-generated-run-file-then-archive-only-if-identity-and-revision-are-proved`.
For a known verified file whose final state is not uncertain but a subsequent non-mutation check
fails, use the same no-automatic-cleanup rule. `UNAUTHENTICATED` is failed; `UNSUPPORTED` is
inconclusive/disabled-mode reporting; expected `CONFLICT` is passed only in stale/duplicate stages;
all unrecognized data is protocol-inconclusive. A successful archive must still verify path and ID;
otherwise manual recovery is required.

Keep temporary content local, bounded, removed in `finally`, and never serialized. The harness must
use `spawn(..., { shell: false })`, keep only necessary client environment names, retain 0600 external
evidence publication, and refuse repo/symlink/overwrite output paths. It has no Live Drive import,
no Terraform import, no runtime-config writer, and no control path that changes write mode.

### 4. Make raw-provider evidence an explicit preceding gate rather than a runtime input

Retain `src/live-drive/probe.ts`, `src/live-drive/evidence.ts`, and their existing fake tests as the
direct-provider `If-Match`/no-delete experiment. Do **not** couple its result to runtime composition
or expand it into a gateway client. Its marked test root/direct-child archive check, two-actor stale
checks, sanitized evidence, and archive-only cleanup remain valuable provider evidence.

Update `docs/live-drive-capability-harness.md` and the release runbooks to state the new role
precisely: the probe runs first against the same dedicated root/archive later configured in the
controlled gateway revision; a `SUPPORTED` probe is necessary but does not enable runtime writes or
prove Work/Codex behavior. The operator records only the probe evidence digest in downstream client
records. The pre-provisioned nested validation folder is prepared by an administrator before the
gateway-client flows; neither probe nor client harness may create/move folders. Existing evidence
may retain its defined provider observations internally, but no client release output may copy them.

### 5. Align deployment, threat, observability, and evidence documentation

Rewrite `docs/write-gate-and-client-validation.md` in place so links survive, but remove JWS,
approvals, leases, replay stores, evidence submission, and `WriteGateDecision` terminology. Make it
the release-gate runbook with this non-bypassable order:

1. independent task/feature review against the immutable image;
2. marked dedicated Drive root/archive and server identity/ACL review;
3. raw provider capability probe with archive-only verified cleanup;
4. review sanitized probe evidence and bind its digest to the candidate;
5. review Terraform plan where `enable_write=true` and `acknowledge_write_risk=true` are both
   deliberate, while omission/false remains read-only;
6. deploy a controlled revision whose immutable image/config digests match release input; verify
   health/liveness, unauthenticated denial, read behavior, a conflict, and unknown-outcome guidance;
7. run separate Work and Codex test-file flows; and
8. make a human release decision or roll back by a reviewed `enable_write=false` deployment without
   deleting Drive data, credentials, evidence, or secrets.

Update `docs/cloud-run-deployment.md` and `infra/terraform/terraform.tfvars.example` only to
document/fix example values introduced by task 002: default `enable_write = false` and
`acknowledge_write_risk = false`, both required for an enabled plan, and image digest/config
fingerprint review. Do not modify Terraform resources or apply instructions beyond documentation
necessary to keep them accurate. The plan must preserve existing production-service/public-invoker
acknowledgements and never show secret values.

Update `docs/threat-model.md` to describe the final tree/write state and exact residual concurrency
claim: file `If-Match` serializes the target file only; complete pre/post topology snapshots detect
ordinary target/ancestor changes but no Drive transaction proves an ancestor was never moved out and
back between checks. That residual requires trusted Drive administration/change control. A timeout
cannot prove a dispatched mutation did not apply; `OUTCOME_UNKNOWN` and timeout require reread and
reconciliation, not retry/rollback. Replace lease assets/bypass language with deployment write mode
and evidence-as-gate language.

Update `docs/observability-contract.md` to name `outcome_unknown` as the sole added terminal result
from task 003 and to reaffirm that it exposes no state/dispatch/config evidence. Retain the closed
audit/metric schema and prohibited data list. Update `docs/client-validation-record.example.json`
to be a sanitized release-input template consistent with Work/Codex records and the three digest
references, without URLs, paths, IDs, revisions, credentials, or claimed live success.

## Expected control flow and invariants

```text
operator-reviewed image digest + non-secret runtime-config digest
  + marked dedicated root/archive + provider-probe evidence digest
  -> reviewed Terraform: enable_write=true AND acknowledge_write_risk=true
  -> controlled gateway revision (same root/archive; server-side Drive authority only)
  -> separate Work manual flow / Codex external harness
  -> sanitized evidence + human release decision
  -> rollback deploys write.enabled=false; no delete/trash/secret/data cleanup

Codex harness, after explicit confirmation only
  -> nested list/archive-list/search
  -> create -> read verify -> duplicate create CONFLICT -> reread verify
  -> exact-revision update -> reread verify -> stale update CONFLICT -> reread verify
  -> exact-revision archive -> identity/destination verify
  -> sanitized evidence

possible mutation timeout | transport uncertainty | OUTCOME_UNKNOWN | malformed mutation response
  -> stop, no retry, no automatic reread/cleanup
  -> opaque run reference + manual reread/reconcile direction only
```

Invariants:

- The local/default deployment state is read-only. No documentation, template, harness, skill, or
  evidence file can create a write-capable client, alter Terraform/runtime mode, or turn evidence
  into authority.
- Gateway server credentials remain separate from Work JWTs and Codex bearer credentials. No client
  instruction enables direct Google access.
- The release harness never targets arbitrary data: its validation folder is nested, pre-provisioned,
  and within the marked disposable root selected by operators; its only created object has a UUID
  name and it archives only the returned verified identity.
- An uncertain mutation is not cleanup-eligible. Manual recovery is intentionally content-free and
  locates only the opaque run identifier outside the repository.
- Static/fake test fixtures use synthetic UUIDs, digest placeholders, opaque identifiers,
  timestamps, and inert content. They contain no usable endpoint, token, OAuth material, secret path,
  Drive ID, or real evidence.
- A passing static test, raw probe, Work check, Codex harness, Terraform plan, or release record is
  never represented as proof that a live cloud operation occurred during this task.

## Task-local sequencing

1. Verify final dependent symbol/error/config names without changing their implementation. Update
   client prose/templates and their static contract tests first, removing stale direct-root/lease
   assertions.
2. Refactor the Codex harness schema, evidence schema, parser, stage state machine, and test fakes
   together. Remove the production-blocked/test-only-future split; retain all explicit operator and
   filesystem guards.
3. Align live-probe/release documentation and the generic client-release template; do not import or
   call the probe from the harness.
4. Align deployment/default-off, threat, and observability documentation with the final dependent
   contracts.
5. Run fake/static focused tests and the canonical project checks. Do not change feature/task status,
   build log, product implementation, credentials, configuration, cloud state, or commits.

## Test strategy and exact validation

All tests are local, fake/static, and network-free. They use injected runners/factories and asset
reads only.

- `tests/codex-cloud/harness.test.ts`: strict external config and digest grammar; nested validation
  folder requirement; no production test bypass; exact stage ordering for list/search/read/create,
  duplicate refusal, update, stale conflict, archive, and verified cleanup; one dispatch per
  mutation; disabled `UNSUPPORTED` reporting; malformed CLI records; `OUTCOME_UNKNOWN` and timeout
  after every possible mutation stop all later requests/automatic cleanup; archive mismatch; no
  retry; opaque manual recovery; strict redaction including forbidden keys and sentinel values;
  output path/symlink/0600/no-overwrite protections.
- `tests/codex-cloud/docs.test.ts` and `tests/codex-cli/cli.test.ts`: Codex guidance mentions the
  built client, nested paths, exact revisions, no retry, conflict reread, fixed unknown/reconcile
  behavior/exit 9, disabled mode, GET/POST-only egress, and no direct credentials. Validate the
  exact task-003 error pair against the final CLI contract without making a request.
- `tests/plugin/chatgpt-work-package.test.ts`: exactly six tools; nested read-before-write and
  archive confirmation; conflict/unknown/timeout stopping language; default-off and
  non-authoritative evidence; sanitized template shape/digests; no stale lease/direct-root claims
  and no credential-like content.
- `tests/live-drive/probe.test.ts`, `tests/live-drive/evidence.test.ts`, and
  `tests/live-drive/config.test.ts`: preserve marked-root/direct-child archive, two-actor stale
  `If-Match`, archive-only cleanup, evidence sanitization, and no-write runtime coupling. Add only
  documentation/schema assertions if task-004 changes one of these artifacts.
- `tests/deployment/assets.test.ts`: Terraform example/documentation contain false defaults,
  `enable_write`, `acknowledge_write_risk`, immutable-image/config review wording, existing
  acknowledgements, and no secret payload. It must not execute Terraform.
- `tests/observability/audit.test.ts`, `tests/http/json-api.test.ts`, and
  `tests/mcp/stateless-mcp.test.ts`: task-003 `outcome_unknown` is the only new closed terminal
  category and remains content/config/provider-detail free; test documentation assertions rather
  than reimplementing transport behavior.

Run from repository root:

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

The authoritative command set is `AGENTS.md`, `package.json`, and `ARCHITECTURE.md`. Do not run
`pnpm drive:probe`, `pnpm codex-cloud:harness`, Docker, Terraform, `gcloud`, OAuth/JWKS requests,
or any live Drive/Work/Codex endpoint while implementing this task.

## Expected unchanged boundaries

- Core application/domain/Drive write/read logic, authentication implementation, runtime
  composition, HTTP/MCP route behavior, CLI transport implementation, and Terraform resources are
  owned by tasks 001–003. This task consumes their final contracts; it does not patch a bounded
  product defect unless separately authorized.
- `src/live-drive/**` remains an isolated raw-provider capability probe. Do not turn it into a
  gateway write authority, client harness, folder-management tool, or automatic release action.
- All product/feature/task statuses, `tasks.md`, feature visuals, build log, handoff, vendored
  skills other than the project Codex gateway skill, package dependencies, cloud configuration,
  credentials, secret values, Drive ACLs, Terraform state, and deployments remain unchanged.

## Risks and careful checks

- Task-003 may refine internal names but its public unknown error is binding: HTTP 503,
  `OUTCOME_UNKNOWN`, fixed redacted message, CLI exit 9. Do not make evidence parsers accept
  arbitrary 503 errors or retry them.
- The baseline harness’s `validationFolder`/`archiveFolder` names and `testOnlyFutureCapabilities`
  seam are not an acceptable final gate. Require a nested folder, remove the future-capability seam,
  and avoid interpreting a current disabled result as success.
- A raw Drive probe can prove only what the provider did in the marked test tree. Its `SUPPORTED`
  evidence cannot prove gateway composition, Work/Codex configuration, ACL correctness after the
  run, or a future production operation.
- Do not expose a safe-looking location accidentally: the evidence redaction check must reject both
  forbidden field names and injected sentinel path/content/revision/ID values. Digest values and
  UUID run references are the only dynamic release correlation fields.
- Preserve all existing non-overwrite/outside-repository/symlink checks when reshaping the harness.
  Evidence output must never be a repository artifact or an instruction to delete external data.

## Open questions

None. The implementer must verify final dependent task contracts immediately before editing and
keep all live actions for an approved operator after this task is implemented and reviewed.
