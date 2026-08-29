# Build log

Durable orchestration record for `ai/features/epics/google-drive-markdown-gateway/`.

## 2026-08-28 — Program planning checkpoint

- Branch: `build-google-drive-markdown-gateway`
- Architecture research:
  - Google Drive safety/auth contracts — `gpt-5.6-sol`, high reasoning
  - OpenAI MCP/plugin/Codex contracts — `gpt-5.6-sol`, high reasoning
  - Service stack and delivery architecture — `gpt-5.6-terra`, high reasoning
- Program planning: `gpt-5.6-terra`, high reasoning
- Result: seven approved feature roots and 18 task briefs
- Validation: `./scripts/verify-vendored-skills.sh` passed; structural plan checks passed
- Commit: `8ae5764` (`plan google drive markdown gateway build`)
- Remote persistence: pending explicit approval for this repository remote

## 2026-08-28 — 00-platform-validation / 001-typescript-service-baseline

- Spec shaping: `gpt-5.6-terra`, medium reasoning
- Implementation: `gpt-5.6-luna`, medium reasoning
- Orchestrator intervention: the implementation worker was interrupted after the tree stopped making
  observable progress; the completed scaffold was inspected and validated directly.
- Validation:
  - `CI=true pnpm install --frozen-lockfile` — passed
  - `CI=true pnpm check` — passed
  - `git diff --check` — passed
  - credential-pattern scan — passed
- Local task review: `No findings.`
- Residual: validation ran on Node 26.7.0; the declared Node 24 target remains to be exercised by the
  container/deployment task.
- Status: complete
- Commit: `faf3644` (`build typescript service baseline`)

## 2026-08-29 — 00-platform-validation / 002-live-drive-capability-harness

- Spec shaping: `gpt-5.6-sol`, high reasoning because the task tests atomic stale-write behavior.
- Implementation and bounded repair: `gpt-5.6-terra`, high reasoning.
- Root task review found and repaired transient-result classification, cleanup identity/fallback,
  evidence strictness, repository containment, metadata validation, and missing unsafe-case tests.
- Validation:
  - `CI=true pnpm install --frozen-lockfile` — passed
  - `CI=true pnpm check` — passed; 17 fake-only tests
  - `git diff --check` — passed
  - credential-pattern scan — passed
- Local task review: `No findings` after two repair passes.
- No live Drive request was made. Production writes remain disabled until an operator runs the
  documented probe against dedicated marked folders and obtains a supported, cleaned-up result.
- Status: complete
- Commit: `4afd845` (`build live Drive capability harness`)

## 2026-08-29 — specifications shaped ahead of implementation

- `00-platform-validation / 003-client-validation-and-write-gate`: `gpt-5.6-terra`, medium
  reasoning; implementation intentionally waits for the committed task-002 evidence contract.
- `01-drive-core / 001-domain-contracts-and-safe-resolution`: `gpt-5.6-terra`, medium reasoning;
  pure contracts and fake-only tests need no premium model.

## 2026-08-29 — 00-platform-validation / 003-client-validation-and-write-gate

- Implementation and bounded repair: `gpt-5.6-terra`, high reasoning because this task verifies
  Ed25519 approvals, evidence freshness, replay protection, and expiring write leases.
- Root review strengthened unchanged-snapshot proof, cleanup consistency, evidence age and input
  bounds, own-key lookup, and lease expiry/entropy handling.
- Validation: frozen install, full `CI=true pnpm check`, diff check, credential scan, and vendored
  skills all passed; the combined tree had 67 fake-only tests.
- No signing, live Drive, Work, Codex, or credential operation was performed.
- Status: complete
- Commit: `f121f95` (`build fail-closed Drive write gate`)

## 2026-08-29 — 01-drive-core / 001-domain-contracts-and-safe-resolution

- Implementation and bounded repair: `gpt-5.6-terra`, medium reasoning; this was pure domain and
  in-memory-port work with no provider calls or credentials.
- Root review strengthened cross-platform path rejection, list/search ambiguity and depth checks,
  read-time ancestry verification, provider-result consistency, and archive destination safety.
- Validation: full combined `CI=true pnpm check` passed with 67 tests, plus diff and credential
  scans. All new application tests are fake-only.
- Status: complete
- Commit: `c78696f` (`build root-confined Markdown domain core`)

## 2026-08-29 — 01-drive-core / 002-google-drive-read-adapter specification

- Spec shaping: `gpt-5.6-terra`, high reasoning because authentication modes and root-confined
  provider queries need a stronger planning pass.
- Result: approved implementation package for a read-only `googleapis` adapter; exact-parent
  traversal, fatal UTF-8 decoding, bounded reads, safe failures, and zero-call unsupported writes.
- Status: specification complete; implementation pending

## 2026-08-29 — 00-platform-validation independent feature-review repair

- Independent review findings repaired without touching the in-progress Drive-core adapter work:
  - upgraded the capability evidence contract to schema/probe version 2 so operation responses and
    metadata/download readbacks are distinct and required proof facts;
  - require recorded 2xx create/fresh/readback facts, exact recorded current `If-Match` values, and
    exact 412 stale-operation facts before the write gate can accept evidence;
  - fail closed on throwing, invalid, or non-finite clocks before issuing or accepting a lease;
  - canonicalize repository, OAuth-secret, and output-parent paths to block ancestor-symlink escapes;
  - retain a minimally parsed successful-create candidate ID solely to attempt exact-ID, identity
    verified archival cleanup after malformed metadata.
- Validation: focused fake-only probe/gate tests, `CI=true pnpm typecheck`, complete
  `CI=true pnpm check` (88 tests in the combined worktree), `git diff --check`, and a
  credential-pattern scan passed.
- No live Drive request, signing, credential discovery, or production write occurred. Feature status
  remains open pending the independent review rerun and its separate archival gate.

## 2026-08-29 — 01-drive-core / 002-google-drive-read-adapter

- Implementation: `gpt-5.6-terra`, high reasoning because this boundary handles two authentication
  modes, Shared Drive topology, provider response normalization, and root-confined traversal.
- Root review tightened malformed-success handling, runtime credential validation, and cache-clock
  failure behavior so every edge case stays inside the redacted provider-error boundary.
- Validation: frozen install, focused adapter tests, full combined `CI=true pnpm check` (88 tests),
  diff check, vendored-skill verification, and a credential-pattern scan passed.
- All tests use an injected fake Google API. No token exchange, credential discovery, network call,
  live Drive request, or Drive mutation occurred; production writes remain disabled.
- Status: complete

## 2026-08-29 — 01-drive-core / 003-guarded-write-and-archive-operations specification

- Spec shaping: `gpt-5.6-terra`, high reasoning because this task joins application policy,
  process-local write authority, exact raw ETag handling, and conditional Drive mutation semantics.
- Result: approved implementation package for ephemeral write sessions, last-moment lease
  validation, exact `If-Match` update/archive requests, stable conflict handling, and default-disabled
  composition. All validation remains fake-only until an operator supplies external evidence.
- Status: specification complete; implementation pending

## 2026-08-29 — 02-authenticated-service-api / 001-service-config-and-principal-verification specification

- Spec shaping: `gpt-5.6-terra`, high reasoning because this task defines JWT issuer/JWKS policy,
  cross-principal confusion defenses, rotating file-backed Codex credentials, and redacted failures.
- Result: approved implementation package for strict no-I/O configuration, externally issued Work
  JWT verification, separate constant-time Codex bearer verification, two minimal principals, and
  fake-only authentication tests.
- Status: specification complete; implementation pending

## 2026-08-29 — 01-drive-core / 003-guarded-write-and-archive-operations

- Implementation and bounded repair: `gpt-5.6-terra`, high reasoning because this task joins the
  process-local write lease, application policy, raw ETag reads, and conditional Drive mutations.
- Root review replaced a fixed multipart delimiter with a collision-checked cryptographic boundary.
  The second independent Platform Validation review also found that provider-derived hostile names
  could become gateway paths; Drive names now must match one canonical safe segment, with ID/list/
  search regression coverage.
- Validation: full combined `CI=true pnpm check` passed with 109 tests, plus diff, vendored-skill,
  and credential-pattern checks. All new tests use fakes and captured requests.
- No live Drive request, credential operation, unconditional retry/fallback, trash, or delete was
  introduced. Normal composition remains write-disabled until external evidence issues a valid lease.
- Status: complete; Drive Core awaits independent feature review

## 2026-08-29 — 02-authenticated-service-api / 001-service-config-and-principal-verification

- Implementation: `gpt-5.6-terra`, high reasoning for issuer/JWKS policy, principal separation,
  mounted-secret rotation, constant-time comparison, and stable redacted failures.
- Root review added a byte bound and control-character rejection for verified JWT subjects so future
  principal audit fields cannot become unbounded or multiline output.
- Validation: focused fake-only auth/config tests and full combined `CI=true pnpm check` passed with
  109 tests, plus diff, vendored-skill, and credential-pattern checks.
- No issuer/JWKS, filesystem secret, OAuth, Google, or network call was made. Deployment must still
  supply the reviewed issuer/audience/algorithm policy and mounted secret references.
- Status: complete

## 2026-08-29 — 00-platform-validation final independent feature review

- Review attempt 3: `gpt-5.6-sol`, high reasoning, fresh read-only context.
- Verdict: `Ready` with no findings after verifying all prior evidence, clock, path-containment,
  cleanup, documentation, and hostile-provider-name findings were repaired.
- Isolated Node 24.19.0 validation passed: full `CI=true pnpm check`, 99 tests, build, vendored-skill
  verification, and comparison diff check. No live Drive, credential, or network operation ran.
- Status: feature complete; grouped-epic checklist/archival procedure follows

## 2026-08-29 — 02-authenticated-service-api / 002-json-api-and-redacted-audit-events specification

- Spec shaping: `gpt-5.6-terra`, high reasoning because this task defines the authenticated route
  lifecycle, bounded request/rate/deadline behavior, stable error mapping, and content-free audit
  contract around a separately guarded write capability.
- Result: approved implementation package for six exact Express routes, strict wire schemas,
  default-disabled write-session provision, bounded success/error envelopes, and allowlisted Pino
  events. Authentication alone never grants mutation authority.
- Status: specification complete; implementation pending

## 2026-08-29 — 02-authenticated-service-api / 002-json-api-and-redacted-audit-events

- Implementation: `gpt-5.6-terra`, high reasoning for strict authenticated route ordering,
  bounded per-principal work, deadline behavior, response limits, and allowlisted audit output.
- Added the six JSON operations plus isolated health, stable public envelopes, default-disabled
  write-session composition, Pino audit events, and fake-only route/limiter coverage.
- Validation: full combined `CI=true pnpm check` passed with 131 tests, plus diff,
  vendored-skill, and credential-pattern checks.
- No credential, issuer/JWKS, live Drive, or external network call was made. A response deadline
  cannot cancel an already-dispatched provider mutation, so write operations are never retried.
- Status: complete; independent task review pending

## 2026-08-29 — 01-drive-core independent feature-review repair

- Independent review: `gpt-5.6-sol`, high reasoning, fresh read-only context. Verdict was
  `Not ready` after finding topology races, structurally forgeable write authority, unsafe nested
  segments, unbound metadata IDs, surrogate rewriting, and weak fake concurrency behavior.
- Repair: `gpt-5.6-terra`, high reasoning. Nested mutations now fail closed; archive is disabled
  until a provider boundary can prove destination topology atomically. Guarded writers, gates, and
  leases are nominal/runtime-checked, including subclass and prototype-forgery denial.
- Added exact metadata-ID binding, safe provider-segment checks before mutation, well-formed UTF-16
  enforcement, opaque fake revisions, source-parent conflicts, and two-actor/default-deny tests.
- Validation: 76 focused tests and full combined `CI=true pnpm check` passed with 131 tests, plus
  diff checking. No live Drive, credential, or network operation ran.
- Status: repaired; independent feature-review rerun pending

## 2026-08-29 — Drive Core and authenticated API adversarial repair round

- Independent reviewers: `gpt-5.6-sol`, high reasoning, fresh read-only contexts. Both Drive Core
  and the JSON API remained `Not ready` after targeted concurrency, capability-forgery, timeout,
  routing, logging, and import-boundary fault injection.
- Drive repair: gate/lease validation now uses module-private non-virtual state; public metadata and
  content operations are direct-root only; nested/recursive access fails closed until Drive can
  prove ancestor topology atomically. Direct media reads compare exact node facts before/after
  transfer, direct search cannot inspect nested content, and excerpts preserve surrogate pairs.
- API repair: the deadline now covers authentication through response, audit failures cannot retain
  limiter slots, unknown failures map to 500, only exact route/method pairs are accepted, audit file
  IDs are bounded, and provider errors moved to a transport-neutral module.
- Validation: full combined `CI=true pnpm check` passed with 151 tests, plus diff and skill-integrity
  checks. No live Drive, credential, cloud, or external network operation ran.
- Status: repaired; final independent reruns pending

## 2026-08-29 — 02-authenticated-service-api / 003-cloud-run-container-and-infrastructure

- Implementation: `gpt-5.6-terra`, high reasoning for read-only runtime composition, container
  boundaries, Secret Manager mounts, dedicated identity, and guarded public reachability.
- Added an import-safe Node 24 runtime, non-root multi-stage image, Cloud Run v2/Artifact Registry/
  resource-scoped secret Terraform, operator rotation/rollback guidance, and fake/static tests.
- Full combined `CI=true pnpm check` passed with 151 tests. Docker and Terraform executables are not
  installed locally, so image construction and Terraform validation remain explicit operator checks.
- No secret value, cloud apply/deploy, credential lookup, live Drive, or external network call ran.
  Production composition intentionally supplies no write session.
- Status: complete; independent task review pending

## 2026-08-29 — Final security and deployment review repairs

- Drive Core review found overridable concrete writer methods and ill-formed Unicode paths. Writer
  dispatch now uses only module-private state and non-virtual functions; concrete classes are final,
  and subclass/prototype/Proxy/method replacement attempts cannot reach a raw writer. All caller and
  provider paths must be well-formed UTF-16.
- API review found unsupported JSON charset/encoding errors were classified as internal failures;
  both now return the stable redacted 415 outcome with one terminal audit event and no service call.
- Cloud Run review repaired a fresh-project Artifact Registry bootstrap ordering error, secret-IAM
  creation race, missing Terraform/runtime bound parity, and missing production-apply acknowledgement.
- Validation: full combined `CI=true pnpm check` passed with 159 tests, plus diff and skill-integrity
  checks. Terraform and Docker are unavailable locally and remain operator-only validations.
- No live Drive, credential, cloud, provider, or external network operation ran.
- Status: repaired; independent acceptance reruns pending

## 2026-08-29 — Cloud Run resource-shape acceptance repair

- Independent acceptance identified one remaining invalid platform combination: 1 vCPU with 8 GiB.
- Terraform now rejects that pairing and retains the documented 4 GiB ceiling for a single vCPU;
  the deployment contract test locks the constraint in place.
- Validation: full combined `CI=true pnpm check` passed with 159 tests. Terraform and Docker remain
  unavailable locally, so their executable validation stays in the operator checklist.
- No cloud apply, image build, credential lookup, live Drive, or external network operation ran.
- Status: repaired; narrow independent acceptance rerun pending

## 2026-08-29 — Drive and service feature-acceptance repairs

- Drive acceptance found malformed opaque IDs could cross caller, configuration, or provider
  boundaries. All such IDs and provider parent IDs now require well-formed UTF-16 before dispatch
  or exposure, with list/search/read/configuration/mutation regressions.
- Service acceptance found Cloud Run's reserved `PORT` was set explicitly and list results were
  capped only after enumeration. Terraform now relies on Cloud Run's injected port, and the
  configured list cap is enforced at the service/Drive port before page and metadata work.
- Validation: full combined `CI=true pnpm check` passed with 175 tests after integration with the
  MCP adapter, plus diff and vendored-skill checks.
- No live Drive, credential, cloud, provider, or external network operation ran.
- Status: repaired; independent acceptance reruns pending

## 2026-08-29 — 03-chatgpt-work-plugin / 001-stateless-mcp-tool-adapter

- Implementation: `gpt-5.6-terra`, high reasoning. Added the exact-pinned official MCP SDK and a
  request-local stateless Streamable HTTP adapter with six schema-backed tools.
- Authentication occurs once before protocol dispatch and accepts only the normalized Work
  principal. Writes require a separately injected pre-opened write session and remain unavailable
  by default; safe tool errors never include provider, path, revision, content, or credential data.
- Real SDK client tests cover all six operations, annotations and schemas, auth-first refusal,
  default-denied writes, conflict handling, malformed-body redaction, and concurrent isolation.
- Validation: full combined `CI=true pnpm check` passed with 175 tests after integrating concurrent
  Drive/API repairs. No live Work, Drive, JWT/JWKS, credential, or external network call ran.
- Status: complete; independent task review pending

## 2026-08-29 — Bounded enumeration and client-contract repair round

- Drive review found a result cap could hide later children and therefore a duplicate. Public list
  now uses a bounded cap-plus-one sentinel and returns a stable result-limit failure before metadata
  or output; resolution, search, and create require complete enumeration and fail on continuation.
- API review found runtime list composition used the Drive cap instead of the smaller HTTP result
  cap. Runtime now wires `http.maxResultItems`, with a differing-limits regression.
- MCP task review added safe handling for throwing write-session providers, well-formed Unicode at
  every string schema, and exclusive success/error output validation.
- The Codex diagnostics CLI is implemented with six strict commands, descriptor-based no-follow
  file reads, bounded transport, exact response validation, stable JSON/exit behavior, and no retry.
- Validation: full combined `CI=true pnpm check` passed with 191 tests, plus build, diff, and
  vendored-skill checks. No live Drive, Work, Codex cloud, credentials, or external network ran.
- Status: repairs complete; independent acceptance reruns pending

## 2026-08-29 — 02-authenticated-service-api final acceptance

- Independent feature review: `gpt-5.6-sol`, high reasoning, fresh read-only context.
- Verdict: `Ready`, with no findings after three bounded repair rounds.
- Verified authentication separation, request/result/rate/deadline bounds, redacted audit events,
  default-deny writes, pre-output enumeration caps, and the complete static Cloud Run rollout/IAM
  contract. Docker and Terraform executables remain operator-only validation gates.
- Validation: full combined `CI=true pnpm check` passed with 191 tests.
- Status: complete; grouped-epic archival checklist update follows

## 2026-08-29 — Codex CLI executable and file-safety repair

- Independent task review found the published bin lacked a Node shebang and a single descriptor
  read could legally return a truncated prefix. The built bin is now directly executable, and
  no-follow descriptor reads loop to the verified size, reject short reads/growth, and probe EOF.
- Added mounted-secret, symlink/nonregular/size/UTF-8, redirect, timeout, oversized-response,
  built-bin, and exactly-once write failure coverage.
- Validation: full combined `CI=true pnpm check` passed with 197 tests; the built bin reports the
  expected version. No live endpoint, credential, Drive, or external network call ran.
- Status: repaired; independent task re-review pending

## 2026-08-29 — Search completeness, MCP discovery, and executable-bin repairs

- Drive search now detects duplicate canonical paths across complete bounded enumeration before
  slicing results. List overflow is an opaque signal handled before parsing or fetching the extra
  provider resource, so malformed sentinels still produce the stable result-limit outcome.
- MCP discovery now publishes real strict `oneOf` success/error variants verified with AJV, and
  maps result limits to the stable public result-limit error.
- The build now marks the generated `md-drive` bin executable and directly self-tests it through
  its shebang; TypeScript output mode can no longer leave the declared command unusable.
- Validation: full combined `CI=true pnpm check` passed with 200 tests, including the executable
  artifact self-check. No live service, Drive, client, credential, or external network call ran.
- Status: repaired; final independent reruns pending

## 2026-08-29 — 03-chatgpt-work-plugin / 002-work-plugin-package-and-live-harness

- Implementation: `gpt-5.6-terra`, high reasoning. Added an isolated, secret-free private-package
  checklist, safe agent instructions, tenant-registration runbook, operator-only validation steps,
  and a sanitized non-authoritative evidence template.
- The package exposes only the six MCP tools, uses `.invalid`/example placeholders, keeps OAuth/JWT
  and tenant values out of Git, and states that installation/consent/evidence cannot issue a write
  lease or make unavailable archive behavior succeed.
- Validation: full combined `CI=true pnpm check` passed with 203 tests. No live plugin install,
  Work/Drive/cloud call, credential, OAuth/JWKS request, or external network action ran.
- Status: complete; independent feature review pending

## 2026-08-29 — Drive result-cap capacity invariant

- Final Drive acceptance found otherwise-valid configuration could set the traversal budget below
  the public result cap plus its overflow sentinel. Configuration now requires
  `maxTraversalNodes >= maxResultItems + 1`, while runtime failures remain generic and redacted.
- Exact `+1`, defaults, equal-limit rejection, and composed-runtime failure are covered.
- Validation: full combined checks passed with 208 tests. No provider, credential, Drive, or
  external network call ran.
- Status: repaired; final independent acceptance rerun pending

## 2026-08-29 — 04-codex-cloud-client / 002-codex-cloud-setup-and-live-verification

- Implementation: `gpt-5.6-terra`, high reasoning. Added a project-scoped Codex skill, exact
  secret/host/method allowlist setup guide, and an isolated operator-only clean-environment harness
  with sanitized evidence and conflict/cleanup checks.
- The harness accepts only external configuration/output paths, invokes the checked-in CLI without
  a shell, forwards only the three named client variables, and accurately reports the current live
  state as blocked until a deployed endpoint, credential, egress policy, and operator approval exist.
- Vendored-skill integrity now covers 10 repository skills.
- Validation: full combined `CI=true pnpm check` passed with 208 tests. No cloud session, allowlist
  mutation, live endpoint, credential, Drive, or external network call ran.
- Status: complete; independent feature review pending
