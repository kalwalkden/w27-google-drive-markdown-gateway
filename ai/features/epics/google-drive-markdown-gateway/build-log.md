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
