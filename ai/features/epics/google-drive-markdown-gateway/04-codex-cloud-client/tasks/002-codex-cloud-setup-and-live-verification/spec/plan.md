# Codex Cloud Setup and Live Verification — Implementation Plan

## Scope

Add project-scoped Codex cloud setup and usage guidance plus an explicit, operator-run clean-environment verification harness for the completed `md-drive` CLI and deployed JSON gateway. The task records configuration instructions, a narrow egress policy, safe secret injection, an agent workflow skill, a sanitized release-evidence format, and routine fake/static tests.

The harness is release evidence, not an application capability or write-authority mechanism. It verifies the six existing gateway operations and a deliberately stale update only in an operator-configured disposable Markdown area. It must clean up by archiving only the exact files it created. A successful run does not bypass the Drive write gate, provision a write lease, or enable a disabled deployment.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| This is a project-scoped cloud client setup, not a global installation. | Document use from the checked-out repository with the compiled/package-managed `md-drive` executable. Do not add global package installation, a global Codex setting, or a setup-time download of unpinned client code. | Approved feature and task brief; handoff |
| Codex uses a separate gateway bearer only. | The runbook names only the CLI's existing `MD_DRIVE_GATEWAY_URL` and one of `MD_DRIVE_BEARER_TOKEN` or `MD_DRIVE_BEARER_SECRET_FILE` as operator-injected values. It explicitly forbids Google OAuth JSON, refresh tokens, service-account credentials, `GOOGLE_APPLICATION_CREDENTIALS`, Drive IDs, and gateway bearer values in Git, prompts, examples, logs, or evidence. | Handoff; `AGENTS.md`; task 001 plan; principal-verifier contract |
| Egress must be narrow and current-platform dependent. | The operator guide instructs the operator to configure exactly one deployed gateway HTTPS hostname and the HTTP methods the CLI actually emits: `GET` for list/search/read and `POST` for create/update/archive. It forbids wildcard, IP-address, URL-path, query-string, broad Internet, Google API, package-registry, or redirect-domain allowlist entries. It treats the exact Codex environment UI/schema as a current-platform verification item, not a hard-coded repository setting. | Handoff; feature constraint; `docs/write-gate-and-client-validation.md`; task 001 route map |
| No automatic cloud mutation or live request is permitted during implementation or CI. | The harness requires an explicit live subcommand, external operator configuration, and a typed confirmation. Tests use fake `md-drive` executables or injected command runners and static fixtures only. No test creates a cloud task, changes an allowlist, reads a real secret, calls a gateway, or calls Drive. | Task brief; repository security rules; live-drive harness pattern |
| Existing cloud-preflight guidance stays separate. | Retain `docs/codex-cloud-preflight.md` for repository-skill/runtime preflight. Add a focused Codex-client setup document that links to it, rather than rewriting its fresh-subagent/model-routing gate or changing `AGENTS.md`. | Task brief non-goal; `docs/codex-cloud-preflight.md`; `AGENTS.md` |
| Agent behavior needs durable project-local instructions. | Add one small repository-scoped usage skill under `.agents/skills/` that invokes `md-drive`, requires read-before-write and revision retention, reports conflicts, requires explicit user authorization before archive, and forbids raw HTTP/Google credentials. It must contain no environment value or live endpoint. Update the vendored-skill integrity check only as needed to verify this additional project skill and preserve its existing nine-skill checks. | Handoff Codex UX requirement; task brief; `scripts/verify-vendored-skills.sh` |
| Live verification must be disposable and evidence-safe. | Harness input contains only opaque references/paths to operator-owned configuration, never values. Generate a unique per-run Markdown file name and marker content in memory; create only under an operator-declared dedicated validation folder. Archive every created file through `md-drive archive` using the revision it read. Store evidence outside the repository with a strict allowlist and no content, URL, secret, path, Drive ID, revision, operation ID, raw CLI stdout/stderr, or error body. | Task brief; handoff no-delete/revision rules; `docs/live-drive-capability-harness.md`; `docs/client-validation-record.example.json` |
| Cloud platform behavior changes. | State what is verified locally (CLI wire mapping and harness state machine) versus what must be verified at run time: current Codex cloud environment supports operator secret injection, hostname/method policy, project-scoped setup, the selected gateway TLS origin, and outbound CLI requests. Record only sanitized identifiers/digests and pass/fail states. A missing platform control is a blocked/inconclusive release check, never a reason to broaden access. | Handoff current-reference caveat; `docs/codex-cloud-preflight.md`; task brief |

## Visual design

No visual design applies. This task supplies Markdown operational guidance, a machine-readable evidence record, and terse CLI/harness output. User-facing output must be content-free except for successful, intentionally requested `md-drive read` responses.

## Product alignment

The CLI remains the fallback/diagnostic HTTPS client rather than a second Drive adapter or primary MCP interface. All six operations remain owned by the deployed gateway and its existing root, Markdown, authentication, revision, rate-limit, write-gate, audit, and no-permanent-delete policies. Codex cloud has one scoped principal and no Google credential. The clean-environment harness demonstrates the client path; it does not prove Google conditional-write semantics, which is owned by the separate live Drive capability harness and write gate.

## Detailed implementation approach

### 1. Keep setup documentation project-scoped and operator-owned

Add a focused document, such as `docs/codex-cloud-client-setup.md`, with these sections:

1. Prerequisites and unchanged boundaries: a deployed HTTPS JSON gateway, completed CLI build, a separate Codex bearer already provisioned at the gateway, and a dedicated validation location. Explain that Cloud Run/Secret Manager provisioning is owned by authenticated-service infrastructure, while this task only tells an operator how to inject an already-created Codex client secret into the Codex environment.
2. Repository setup: check out the approved revision, use the repository's pinned Node/pnpm workflow, run `./scripts/verify-vendored-skills.sh`, and build the checked-in CLI. Do not show a global install command or bake the compiled artifact into a cloud image.
3. Current Codex cloud platform check: before setting up a live validation environment, inspect the current official Codex cloud environment controls and record whether the selected runtime supports secret injection and egress hostname/method policy. The guide must not claim a particular UI label, configuration-file schema, feature availability, or broad outbound-access default without contemporary operator verification.
4. Operator configuration contract: inject exactly one scoped bearer by the supported CLI mechanism and a single HTTPS gateway origin. Values are supplied through the environment's secret mechanism or a mounted secret file, never committed project configuration. Do not inject Google credentials, Drive configuration, private keys, OAuth data, or service-account JSON. Explain independent bearer rotation: update the injected Codex secret and restart/rebuild the environment as required by the platform; do not change source or share a Google secret.
5. Egress allowlist: add only the exact gateway hostname, with `GET` and `POST`. The endpoint must be canonical HTTPS with no credentials/query/fragment; redirects are a CLI protocol failure and must be fixed at the configured gateway hostname rather than allowlisted. Do not enable package registries, Google APIs, `*`, broad domains, or a public proxy just to make the harness work.
6. Normal agent workflow: load the project skill, list/search/read before editing, retain the returned revision, issue one explicit update using that revision, reread after `CONFLICT`, and seek explicit confirmation before archive. Never substitute `curl`/raw HTTP, copy a bearer into a command, infer a revision, or retry a write after uncertain transport results.
7. Failure/recovery table: distinguish missing secret/config, blocked egress/DNS/TLS/redirect, `UNAUTHENTICATED`, `UNSUPPORTED` write, `CONFLICT`, rate/timeout/transport uncertainty, and cleanup failure. Every path remains fail-closed; uncertain mutation status means reread and ask before another write.

All examples use placeholders rather than credential-shaped values, reachable hostnames, raw IDs, real paths, or document text. Documentation may name variable names and methods only.

### 2. Add a repository-scoped Codex usage skill

Add a narrowly named skill under `.agents/skills/`, for example `codex-cloud-markdown-gateway/SKILL.md`, and update `scripts/verify-vendored-skills.sh`'s required-skill inventory/count to validate it is a checked-in regular file with the declared name. Do not copy user-level skills or machine-local paths.

The skill must be intentionally short and contain:

- the prerequisite that the operator has completed the Codex cloud setup document and provided the two CLI configuration inputs outside Git;
- command-shape examples that use placeholders only and call `md-drive`, not raw HTTP;
- the read-before-write/revision/conflict/archive-confirmation workflow;
- a prohibition on Google credentials, general Drive access, automatic retries, broad egress, and placing values in files, prompts, command arguments, diagnostics, or evidence;
- a clear boundary: use the operator harness only when explicitly asked to conduct the release validation; ordinary tests remain fake/static.

The skill must not mutate `AGENTS.md`, configure Codex cloud, start a cloud task, or introduce a second secret/configuration format.

### 3. Define a clean-environment operator harness and evidence contract

Add a dedicated, direct-execution-only harness, such as `src/codex-cloud/harness-cli.ts` with pure parsing/state helpers under `src/codex-cloud/`, compiled by the existing TypeScript build and exposed through a narrow package script. Exact filenames are an implementation choice, but the harness must be isolated from `src/drive/**`, `src/live-drive/**`, service composition, and CLI transport implementation.

The harness has no default execution. Require a closed invocation including a `run` subcommand, a path to an external operator configuration file, an externally located output destination, and a fixed confirmation token such as `W27_CODEX_CLOUD_TEST_ONLY`. Reject unknown/duplicate flags, repository-local config/result paths, symlink/unsafe files, absent confirmation, and missing CLI executable/config inputs before a child process starts. It must not support arbitrary shell fragments, `curl`, Google flags, test-root creation, permanent deletion, arbitrary network destinations, or `--force`.

The external non-secret config may identify only bounded harness controls: the checked-in CLI executable invocation, a dedicated relative validation folder, an existing archive folder, fixed timeout bounds, and an externally supplied release/environment identifier. It must not contain endpoint URLs, bearer values/paths, Google settings, Drive IDs, revision values, document content, or unbounded command strings. Resolve the CLI to the checked-in built executable/package entry, invoke it without a shell, and inherit only the narrow environment needed for the already-injected CLI settings. Redact its process environment and never serialize raw command arguments, stdout, stderr, or thrown errors.

Harness sequence:

1. Preflight CLI availability and configuration without printing values. Use `md-drive list` on the dedicated validation folder and confirm the archive folder is separately accessible. A failure means no create.
2. Generate a UUID run ID, a unique `w27-codex-cloud-validation-<run-id>.md` relative path under that folder, and small UTF-8 marker variants entirely in memory. Use temporary local content files outside the repository with restrictive permissions; delete those temporary files in `finally` without recording their names or bodies.
3. Exercise `list`, `search`, and `read` using the configured validation area. Treat expected empty results as valid before the test file exists; validate only CLI-owned stable JSON fields/statuses needed for state progression.
4. Create the unique file, retain its returned opaque locator/revision only in memory, read it again, and update it once with that revision. Verify the returned revision changes by subsequently reading the same file.
5. Issue a deliberately stale `update` using the earlier revision and a distinct marker. Require the CLI's validated `CONFLICT` result/exit behavior. Reread and verify that the current revision/content state is still the fresh update, proving the client did not silently retry or overwrite. Do not treat a timeout or ambiguous transport error as conflict proof.
6. Exercise archive using the current reread revision. In `finally`, attempt archive only for the exact captured generated file and only when it is not already verified in the archive. Never search by a broad name, archive a pre-existing file, delete, trash, or retry an uncertain write. If cleanup cannot be verified, record cleanup failure and tell the operator to find only the generated run file in the dedicated folder and archive it manually.

Because list/search/read/create/update/archive are all exercised in the clean environment, an `UNSUPPORTED` result for a write is a valid finding but not a pass. It requires correcting the separately controlled deployment/write-proof state; the harness must never attempt to enable it.

Write evidence with exclusive/atomic output and restrictive permissions outside the repository. Base the schema on the existing sanitized client-validation record, but add only allowlisted Codex harness data: schema/harness version, timestamps, opaque run identifier, release digest, environment identifier, gateway-hostname identifier (a one-way operator-provided identifier rather than hostname), allowed methods `["GET", "POST"]`, platform-control check states, per-operation pass/fail/allowlisted result code, stale-conflict result, cleanup result, and redaction assertions. Exclude file paths/names, user content/digests, bearer/secret values or references, URLs, IPs, Drive IDs, revisions, operation IDs, raw responses, exception text, and platform screenshots. The operator retains the evidence outside Git.

### 4. Make routine checks fake/static only

Add Vitest coverage under `tests/codex-cloud/` using injected filesystem, clock/UUID, temporary-file, process-runner, and JSON-result seams. The tests must prove the harness parses a closed grammar, never delegates to a shell, starts no child process before preflight/confirmation, produces the required six-operation/stale/cleanup transition, accepts only the CLI's stable machine output, and gives cleanup failure priority.

Use a fake command runner that returns synthetic sanitized `md-drive` records and records calls without storing bearer/endpoint/document strings. Test: success; each configuration/confirmation/repository-path rejection; absent/malformed CLI record; CLI nonzero/transport uncertainty; `UNAUTHENTICATED`; default-disabled `UNSUPPORTED`; expected stale `CONFLICT`; stale non-conflict; changed/readback mismatch; archive failure; and signal/exception/finally cleanup behavior. Include recursive evidence serialization/redaction tests that reject forbidden keys and demonstrate no synthetic content, secret, endpoint, raw path, revision, or process diagnostic reaches output.

Add static/documentation tests only where the repository's existing test style supports them: assert the guidance names exactly one hostname policy and only `GET`/`POST`, names the scoped bearer inputs, forbids Google credentials/broad Internet, references current-platform verification, and does not contain a live secret, real URL, Drive ID, or value-shaped token. Tests must never access Codex cloud, DNS, a deployed service, Drive, Secret Manager, Google auth, or the live Drive probe.

## Expected control flow and invariants

```text
operator config + already-injected Codex secret + narrow egress policy
  -> clean Codex cloud environment
  -> checked-in project skill / md-drive CLI
  -> exactly one configured HTTPS gateway hostname (GET, POST only)
  -> six gateway operations + intentional stale-update conflict
  -> exact generated-file archive cleanup
  -> sanitized external release-evidence record
```

- The harness never receives, validates, prints, persists, or forwards a Google credential. Google authentication remains server-side.
- `md-drive` remains the sole HTTP client. The harness does not import `fetch`, Google SDKs, Drive adapters, or service modules, and never reproduces a gateway route.
- Live mutation authorization stays with the gateway's write session/write gate. A bearer, cloud egress setting, passing harness, or source change never creates a lease or enables a write.
- One attempted CLI write maps to the CLI's existing one-request/no-retry behavior. On uncertain create/update/archive results, the harness does not infer absence or retry; it rereads only when safely required for state/cleanup and reports inconclusive status.
- The generated test object is confined by a validated relative path beneath an operator-controlled dedicated validation folder. Archive is the only cleanup operation; permanent deletion/trash is impossible by interface and prohibited by docs.
- Neither the docs, skill, harness config, result, test fixtures, nor source-control logs may hold operator values. Operator-owned endpoint, bearer, secret injection details, cloud environment settings, external configuration, and release evidence remain outside Git.

## Current-tree evidence and unchanged boundaries

The target task has no existing `spec/`, Codex-cloud source, setup document, or harness. Task 001's task-level spec defines the intended `md-drive` contract and its six JSON API routes, but the current tree has no `src/codex-cli/` or `tests/codex-cli/`; implement task 002 only after task 001's committed CLI surface is available and recheck its final executable/package script/error shapes.

`docs/codex-cloud-preflight.md` currently governs repository-skill discovery and `$ship-feature` runtime suitability, not gateway egress/client verification. `docs/write-gate-and-client-validation.md` and `docs/client-validation-record.example.json` already establish sanitized future Codex release evidence and narrow-method intent; this task should extend/cross-reference them without allowing the record to affect `WriteGateDecision`. `docs/live-drive-capability-harness.md` is the parallel operator-only Drive proof pattern; do not reuse its Google credentials, raw Drive API routines, or result schema as client configuration.

Do not change `AGENTS.md`, `src/http/**`, `src/application/**`, `src/domain/**`, `src/auth/**`, `src/drive/**`, `src/write-gate/**`, `src/live-drive/**`, deployment/Terraform, the JSON API contract, or feature/task status artifacts. Preserve all concurrent uncommitted source/package edits. Do not create cloud environments, change network settings, contact an endpoint, invoke `pnpm drive:probe`, load a real secret, or create/commit any live evidence.

## Test strategy and validation

Run focused checks only after the corresponding files exist, then the canonical suite:

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

Operator-only release validation occurs later from a clean, separately configured Codex cloud environment after the current-platform controls have been manually verified. It is never run by CI or implementation work. It must be preceded by the relevant local integrity/build checks and followed by external sanitized evidence review plus generated-file archive cleanup verification.

## Risks and careful checks

- Do not turn a moving Codex cloud UI/documentation surface into checked-in assertions. State the desired controls and record the actual current controls at release time.
- Do not equate a hostname allowlist with an HTTP-method restriction if the platform cannot enforce methods independently. Record that limitation precisely; do not invent a compensating broad rule or falsely report method enforcement.
- Do not include `PATCH`: the CLI maps all three mutations to `POST`; the client-validation example's legacy `PATCH` is not this task's allowlist source of truth.
- Do not let the harness leak generated document content through a child-process error, temporary-file failure, test snapshot, or evidence field. Parse only the minimum stable CLI JSON needed for state transitions.
- A timed-out mutation may have settled at the gateway. Do not retry it; reread before any explicit later action and treat cleanup as potentially manual.
- Keep cloud validation distinct from raw Drive capability proof. A successful client path cannot replace the required stale `If-Match` evidence or signed write approval.

## Open questions

None. The actual gateway origin, cloud environment identifier, secret-injection method, current platform controls, and live release evidence are intentionally operator-owned values to be verified outside Git.
