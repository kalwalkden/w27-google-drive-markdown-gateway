# Rotation, Recovery, and Alerting Runbooks — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `docs/operations.md` (new) | rotation, revocation, alerts, incident/recovery/cleanup/ownership runbooks | The current tree lacks a unified operator procedure. |
| `docs/operations-exercise-record.example.json` (new) | synthetic, sanitized operator-drill record | Gives operators a safe evidence shape without retaining live data. |
| `tests/operations/runbooks.test.ts` (new) | static prose/template safety assertions | Proves the checked-in runbook names the mandatory boundaries without live activity. |
| `docs/cloud-run-deployment.md` | existing deployment rotation/restart/rollback guidance | Reference only unless a minimal cross-link is necessary; preserve concurrent edits. |
| `docs/write-gate-and-client-validation.md` | write-disabled and client-release limits | Reference only; recovery must not weaken the gate. |
| `docs/live-drive-capability-harness.md` and `src/live-drive/evidence.ts` | dedicated-root cleanup and sanitized external evidence | Reference only; task does not change the harness or evidence schema. |

## Entry point and call path

```text
typed metric/audit terminal fact -> approved backend query -> alert threshold
  -> service operator triage -> identity, deployment, or Drive administrator procedure
  -> external sanitized drill/incident record

Drive version history -> authorized administrator restores one direct-root Markdown version
  -> constrained verification -> retained Drive content/version history
```

Runtime facts that the runbook must accurately reflect:

```text
HTTP request -> configured principal verifier -> MarkdownService -> guarded Drive boundary
             -> one terminal typed observability fact -> public response
```

`GET /healthz` bypasses Drive work and is composition-only. The standard runtime leaves write sessions absent. `MarkdownService` currently permits only direct-root reads/mutations and keeps archive unavailable.

## Contracts, state, and invariants

- `ServiceConfig.authentication.workMcp` has issuer, audience, JWKS URL, algorithms, clock tolerance, JWKS timeout, and cache max age. It has no Work secret mount in this repository.
- `ServiceConfig.authentication.codex.bearerSecretFile` identifies the mounted Codex secret file. `ConfiguredPrincipalVerifier` reads it for each Codex verification and uses timing-safe comparison; the runbook must never surface the value.
- `ServiceConfig.drive.authMode` is either `shared-drive-adc` or `my-drive-refresh-token`. Only the latter loads a mounted OAuth credential object; neither mode authorizes a Google service-account key file.
- Task 001’s approved observability contract reserves these metric names: `gateway_http_requests_total`, `gateway_http_request_duration_ms`, `gateway_http_in_flight`, `gateway_rate_limit_rejections_total`, `gateway_request_timeouts_total`, and `gateway_dependency_failures_total`. The alert procedure uses the five applicable terminal/latency counters/histogram and their closed dimensions only.
- Routine audit permits bounded operation/principal/result/status/duration and safely known audit-only file ID under the Task 001 contract. It excludes paths, revisions, content, credentials, raw provider data, and arbitrary context. File ID must never be an alert or metric label.
- `LiveDriveEvidence` is schema versioned and prohibits raw identifiers, content, credentials, bodies, URLs, error, and stack keys. A task-003 exercise template stays separate from it and has the same no-sensitive-data intent.
- `WriteGateDecision` and a `WriteLease` are unrelated to an operator exercise. No drill or recovery record authorizes a write lease.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `docs/cloud-run-deployment.md` | mode-specific secret mounting, rotation/restart, health, rollback, retention guidance | Preserve terminology and accurately cross-link the deployment boundary. |
| `docs/write-gate-and-client-validation.md` | explicit release evidence vs. write authority separation | Keep operator evidence from being misrepresented as write authorization. |
| `docs/live-drive-capability-harness.md` | explicit operator opt-in, dedicated root, exact-file archive cleanup, no delete/trash | Apply the same constraints to any exercise involving Drive. |
| `src/live-drive/evidence.ts` and `tests/live-drive/evidence.test.ts` | strict parsed schema, forbidden-key walk, exclusive evidence output | Reuse the redaction discipline in the synthetic record test; do not reuse/alter the live schema. |
| `tests/deployment/assets.test.ts` | read repository assets and assert safety constraints | Use the same local static-test style for operations documentation. |
| `src/auth/principal-verifier.ts` | independently configured Work JWT and per-request Codex mounted-secret verification | Ensures rotation instructions reflect actual principal seams. |

## Tests and fixtures

- `tests/operations/runbooks.test.ts` should read the two new static assets using repository-local file reads.
- Parse the example record and assert its exact top-level/step allowlist, string bounds/enums, synthetic values, and all sensitive-data flags set to false.
- Use inert text sentinels only to assert that the documents contain no token/bearer/credential payload, OAuth JSON, raw Drive IDs/paths/URLs, authorization header, content/body, provider error, or stack material.
- Assert coverage for independent Work/Codex/Google rotation and revocation, typed thresholds, Drive version history, no delete/trash, direct-root/archive-disabled policy, timeout no-retry, owners/escalation, and operator-only execution.
- No fixture is a real credential, live evidence result, deployment identifier, document, Drive artifact, or monitoring query response.

## Expected unchanged boundaries

- No `src/**` product implementation change, including authentication, observability recorder, Drive adapter, runtime, write gate, or public transport contracts.
- No Terraform resource/variable/provider/state change and no monitoring backend, exporter, dashboard, notification, or alert-policy implementation.
- No `src/live-drive/**`, live config, evidence schema/example, live capability run, secret/version change, external provider call, Cloud Run rollout, or real operator record.
- No update to task status, task list, feature documentation, build log, handoff, or concurrent files already dirty in the working tree.

## Validation commands

```bash
CI=true pnpm test -- tests/operations/runbooks.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

The commands are authoritative in `package.json`, `AGENTS.md`, and `ARCHITECTURE.md`. Do not run an opt-in Drive probe, Docker, Terraform, `gcloud`, remote JWKS/OAuth/Google/Secret Manager/monitoring service, or a live endpoint.

## Selected external material

None. The approved handoff, feature/task artifacts, current source, deployment guide, Terraform, write-gate guide, and live-harness documentation are the binding inputs. The eventual monitoring backend is intentionally unselected.

## Uncertainties to verify

- Re-read `src/observability/audit.ts` and `src/http/json-api.ts` immediately before implementation. Task 001’s spec names typed metrics, but current source has not yet introduced a metric-recorder/exporter seam; align final metric names/dimensions with that completed task rather than adding a parallel contract.
- Re-read dirty `docs/cloud-run-deployment.md` and Terraform files before any cross-link. Do not overwrite concurrent deployment changes.
- Confirm the current `MarkdownService` and runtime continue to keep archive and production write sessions unavailable. If they change under approved later work, preserve the no-permanent-delete rule and update only the accurately supported operator procedure.
- Confirm the operator’s selected monitoring backend and evidence-retention/access policy before activating the documented thresholds. Those choices are outside this task and require explicit approval.
