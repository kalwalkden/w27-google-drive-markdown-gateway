# Rotation, Recovery, and Alerting Runbooks — Implementation Plan

## Scope

Add an operator-facing operations runbook and a sanitized, non-secret exercise-record template for independent Work JWT, Codex bearer, and Google credential rotation; credential revocation; typed-metric alert response; Drive version-history recovery; outage, timeout, cleanup, and administrator procedures. Add fake/static tests that lock the runbook’s safe boundaries and record shape.

This task does not perform a rotation, revoke a credential, contact Google or a telemetry system, create a dashboard/exporter/notification integration, deploy Terraform, enable writes, alter the write gate, change Drive behavior, or record a live exercise. It does not add an automatic secret-rotation service, permanent deletion, or an external incident-management integration.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| Work JWT, Codex bearer, and Google Drive credentials are separate principals and must rotate independently. | Give each a separate trigger, rollout, validation, rollback, revocation, owner, and evidence procedure. Never treat one successful rotation as proof for another. | Task brief; handoff; `src/config/service-config.ts`; `src/auth/principal-verifier.ts`. |
| Codex bearer is an existing Secret Manager version mounted at `/var/run/secrets/codex/bearer`; the verifier reads it on every request. | Codex rotation can use the existing secret process without an image rebuild. Prove old/new behavior only through an approved controlled operator check; do not expose either value. | `infra/terraform/cloud-run.tf`; `docs/cloud-run-deployment.md`; `src/auth/principal-verifier.ts`. |
| Work verification uses configured issuer/audience/JWKS and a bounded JWKS cache; Work key/token issuance is external to this repository. | The Work procedure changes upstream issuer/JWKS configuration through its owning identity provider, accepts overlap during cache/token lifetime, then retires old signing material. It never substitutes the Codex bearer or Google credential. | `src/config/service-config.ts`; `src/auth/principal-verifier.ts`; Terraform variables. |
| Google auth modes differ. | For `my-drive-refresh-token`, rotate the Secret Manager credential object and restart to a controlled Cloud Run revision before verification. For `shared-drive-adc`, rotate/revoke workload or service-account access by the approved identity process, never create/download a key file. | `docs/cloud-run-deployment.md`; `src/drive/google-drive-auth.ts`. |
| Typed observability is finite and content-free. | Alert queries use only Task 001’s named counters/histogram and closed labels. Runbooks prohibit path, file ID, revision, body, token, header, provider message, URL, stack, and secret-reference collection. | Task 001 approved spec; `src/observability/audit.ts`; task brief. |
| No exporter, alert backend, dashboard, or notification target exists in the current tree. | Document backend-neutral query semantics and ownership; do not add Terraform monitoring resources or pretend alerts are deployed. Before activation, the operator maps each query to an approved sink with access/retention review. | Current tree; `infra/terraform/**`; Task 001 scope. |
| Current product surface is direct-root only and writes/archive are disabled in runtime. | Recovery never enables the write session, archive route, nested access, or a Drive delete/trash operation. It restores a selected version through Drive’s operator interface only, then verifies a direct-root Markdown file with a content-free, access-controlled record. | `src/application/markdown-service.ts`; `src/runtime/server.ts`; `docs/write-gate-and-client-validation.md`. |
| Drive capability evidence is external, strict, and sanitized. | Operator exercises use an unused external output path and no permanent repository record. Store only the template in the repository; real evidence contains no raw identifiers, content, credentials, bodies, URLs, errors, or stacks. | `src/live-drive/evidence.ts`; `docs/live-drive-capability-harness.md`; AGENTS.md. |

## Visual design

No visual design applies. This task creates operational procedures and machine-checkable static templates.

## Detailed implementation approach

### 1. Establish a single operations runbook and safe exercise-record template

Create `docs/operations.md` as the normative operator procedure. It must begin with scope and safety boundaries: operator-only; no live action in tests; no secret values in commands, logs, tickets, or repository files; no document bodies; no permanent delete/trash; and no claim that `/healthz` proves Drive readiness. State that routine telemetry and audit data have the Task 001 allowlist, while any exercise record is separately access-controlled and sanitized.

Create `docs/operations-exercise-record.example.json` as a schema-shaped synthetic template rather than a completed record. Use closed fields such as schema version, opaque exercise ID/reference, procedure kind, environment class, timestamp, outcome, owner role, bounded step status/reason codes, approval/reference digest, and follow-up state. Use explicit redaction booleans that are all false for raw identifiers, content, credentials, request/response bodies, URLs, errors/stacks, and secret references. Do not include a real endpoint, Drive file/version/revision/ETag, secret version, tenant, issuer, URL, key ID, token, document name, or credential location.

Keep this record distinct from `LiveDriveEvidence` and write-gate approvals. It documents an operator drill; it neither proves write safety nor authorizes a gateway lease.

### 2. Document independent credential rotation and revocation drills

In `docs/operations.md`, provide three separate, reversible drills with common phases: authorize/change window; identify the credential class without its value; add/provision replacement through the approved external identity/secret system; bounded controlled validation; revoke or retire the old material only after the overlap/rollback window; record sanitized result; escalate if validation or revocation is uncertain. An emergency compromise path first disables/revokes the affected principal, limits traffic/rolls back only as needed, and opens the matching failure runbook; it must not rotate unrelated principals speculatively.

- **Work JWT/Codex Work:** record configured issuer/audience/JWKS identifiers only in the approved protected operator system. Add a new signing key upstream, wait for the configured JWKS cache and maximum accepted token lifetime/clock tolerance to permit controlled validation, then retire/revoke the old key upstream. Confirm an old-token rejection only through approved test identity material and a protected route; never paste a JWT into command history or evidence. If issuer/audience/JWKS configuration changes, deploy the reviewed non-secret configuration and retain a known-good revision for rollback.
- **Codex bearer:** create a new value/version through the approved Secret Manager process, update the existing mounted-version policy, and use the existing per-request file read for a controlled new-bearer check. Revoke/disable the old version only after the replacement is accepted and rollback is no longer required. Confirm a prior bearer is rejected without retaining or printing it. This rotation does not redeploy code, change the Work JWT trust, or change Google Drive access.
- **Google:** first identify the configured `drive.authMode`. For My Drive, update the existing OAuth credential object in Secret Manager and perform a reviewed Cloud Run revision restart; validate only the restricted, read-only controlled operation allowed by the live-harness policy. Revoke the former refresh token at the OAuth provider after replacement succeeds, and treat inability to reauthorize as a Drive outage. For Shared Drive ADC, rotate/revoke identity bindings/impersonation or workload credentials through the platform process; do not mint, export, or mount a service-account key. Recheck least-privilege Drive ACLs separately from project IAM. This procedure does not grant broader Drive scope.

For every drill, include explicit stop/rollback conditions: failed `/healthz` means process composition issue; protected-route rejection after intended credential rollout means principal/config issue; Drive failure after a Google change means do not infer document loss or enable writes. Roll back configuration/traffic or restore prior external secret/identity state only through the approved change process, leaving prior versions retained for review rather than deleting them automatically.

### 3. Define backend-neutral alert thresholds from the typed metric contract

Add an alert table in `docs/operations.md`. It consumes only the following Task 001 contract names and closed dimensions: `gateway_http_requests_total{operation,principal_kind,result}`, `gateway_http_request_duration_ms{operation,result}`, `gateway_request_timeouts_total{operation}`, `gateway_dependency_failures_total{operation,dependency,failure}`, and `gateway_rate_limit_rejections_total{operation,principal_kind}`. Do not introduce file, principal subject/issuer, operation ID, path, revision, provider status/message, exception, URL, or arbitrary labels.

Specify each threshold as backend-neutral rate/histogram semantics, with a minimum request count so an isolated request does not page. Starting alert policy is:

| Alert | Typed signal and threshold | Initial action / owner |
| --- | --- | --- |
| Sustained authentication failures | `unauthenticated` terminal results are at least 10 in 5 minutes and at least 20% of routed terminal requests in that interval. | Investigate configuration/revocation/hostile traffic; primary service operator, identity owner escalation. |
| Drive dependency degradation | `gateway_dependency_failures_total{dependency="drive"}` rises for at least 10 requests in 10 minutes and is at least 5% of routed terminal requests in the same interval. | Treat as Drive/provider/auth incident; primary service operator, Drive administrator escalation. |
| Deadline/latency degradation | Timeouts are at least 5 in 10 minutes and at least 2% of routed terminal requests, **or** p95 duration is at least 80% of configured `requestTimeoutMs` for 10 minutes with at least 20 completed routed requests. | Check timeout/configuration and bounded provider state; primary service operator. |
| Rate-limit pressure | Rate-limit rejections are at least 20 in 10 minutes and at least 10% of routed requests. Start as a ticket/non-page; page only if paired with the latency or dependency alert. | Assess client behavior/capacity; service operator, client owner escalation. |

State these are conservative activation thresholds, not an SLO or a deployed alert policy. The backend owner must translate them to its approved query language, preserve closed-label aggregation, set notification routing, and review after operator drills or traffic evidence. Alert evaluation must fail safely: missing telemetry or sink failure is an observability incident, not evidence that the gateway or Drive is healthy.

### 4. Define response, recovery, cleanup, and administration procedures

Document a short common incident sequence: acknowledge; establish severity/owner; inspect only allowlisted typed counters and bounded audit facts; classify auth, Drive dependency, timeout, rate-limit, runtime, or observability failure; stabilize using traffic rollback or the matching credential procedure; validate `/healthz` and protected-route denial separately; and record sanitized outcome. `/healthz` is process-only and must not be used as a Drive recovery check.

For **Drive version-history recovery**, require an authorized Drive administrator and a specific incident/change approval. Locate the file in the approved Drive interface without copying its path, name, ID, content, or version identifier into the repository, chat, alert payload, or exercise template. Confirm it is a direct child of the configured root and remains Markdown; select a known-good version and restore it using Drive version history. Never delete/trash versions, replace content through an unguarded gateway write, recover to a nested location, or use unavailable archive functionality. Verify restricted post-recovery metadata/content by the authorized operator; record only an opaque target reference, a non-content integrity/result indicator, and outcome in external sanitized evidence. Escalate any wrong-parent, missing version, conflict, access, or uncertain outcome rather than guessing or broadening access.

For **outage/timeout**, first distinguish gateway health, auth failure, Drive dependency failure, and caller deadline from one another. Do not retry or replay a mutation: a timeout can leave an already-dispatched provider operation unresolved. Keep writes unsupported, use the existing conservative direct-root read surface only after recovery, and involve the Drive administrator for provider/auth issues. For **cleanup**, retain Secret Manager versions, Cloud Run revisions, Drive data, evidence, and Terraform state according to approved retention; do not automatically delete any of them. Live-harness manual cleanup may move only the exact marked disposable file to its direct-child archive and never deletes/trashes. For **administration**, name the service operator as incident coordinator, the identity owner for Work/Codex trust, the Drive administrator for ACL/version history/Google auth, and the deployment administrator for Cloud Run/Terraform/Secret Manager. Include a 15-minute acknowledgement target for paging alerts and explicit escalation to the relevant owner on access, authorization, or recovery uncertainty.

### 5. Add fake/static proof only

Create `tests/operations/runbooks.test.ts` (or a narrowly named equivalent) that reads `docs/operations.md` and `docs/operations-exercise-record.example.json` as repository assets. Parse the template and assert its closed schema/required redaction declarations, no unexpected keys, and synthetic safe sentinel values. Assert the operations document names all three independent rotation paths, token revocation, the five typed metric names, the four threshold classes, Drive version-history recovery, no-delete/no-trash, direct-root/archive-disabled limits, timeout no-retry, ownership/escalation, and the operator-only/no-live-test boundary.

Use negative assertions for token-like values, raw secret/credential fields, raw Drive identifiers/paths, document content, authorization headers, URL/query strings, provider errors, and stack text. Tests must not parse credentials, start a server, issue a JWT, make a Google/JWKS/Secret Manager/telemetry call, use Terraform, or execute a live drill. They validate repository documentation and synthetic examples only.

## Expected control flow and invariants

```text
typed terminal metrics/audit -> approved monitoring backend mapping -> threshold alert
  -> service operator -> credential / runtime / Drive-admin runbook -> sanitized external exercise record

authorized Drive administrator -> Drive version history -> direct-root Markdown verification
  -> no gateway write enablement, archive, trash, or permanent delete
```

- Credential rotation and revocation are principal-specific; a failure in one does not authorize change to another.
- Alert dimensions remain the Task 001 closed application-owned vocabulary.
- Recovery preserves retained Drive content and version history; no permanent deletion workflow exists.
- Current direct-root-only behavior and disabled archive/write runtime remain fail-closed.
- Sanitized evidence is operator-only, external, exclusive where a harness creates it, and never contains secret or document material.
- Static/fake tests prove documentation/template safety; they are not operational validation.

## Current-tree alignment and expected unchanged boundaries

Task 001’s approved specification defines typed metrics, but the current tracked implementation only has the typed audit seam and no metric recorder/exporter/backend. This task must not fill that dependency by adding an ad hoc exporter or Terraform monitoring integration. Re-read `src/observability/audit.ts` and `src/http/json-api.ts` immediately before implementation; if Task 001’s eventual exact exported names or closed fields differ, update the runbook to the completed approved contract rather than inventing labels.

Do not modify application/domain/Drive behavior, auth verifier behavior, write-gate trust/replay/lease semantics, live-harness code/schema, JSON/MCP/CLI contract, runtime write composition, credentials, Secret Manager payloads, Cloud Run/Terraform resources, deployment state, task status, feature task list, build log, or the handoff. Do not overwrite current concurrent changes in application/domain/HTTP/Terraform/deployment files.

## Validation

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

Manually inspect the synthetic JSON and prose for real-looking identifiers, secret values, document content, command examples that would expose authorization, and claims that the current runtime supports archive or production writes. Do not run `pnpm drive:probe`, Docker, Terraform, `gcloud`, remote OAuth/JWKS/Google/Secret Manager/monitoring calls, or a live service.

## Risks and careful checks

- Metric threshold math must aggregate only the allowlisted terminal route metrics; `/healthz` is not a denominator or availability proof.
- Do not convert a static record template into a credential/secret-version inventory. Record opaque external references and procedural outcome only.
- Work key retirement must account for the configured JWKS cache, token lifetime, and clock tolerance; retain overlap until controlled validation completes.
- My Drive refresh-token revocation can make recovery impossible without new authorization. Treat it as a planned, independently authorized rotation with rollback readiness.
- Drive version history is a recovery mechanism, not authorization to expand topology, archive, or mutation capabilities.

## Open questions

None. Selection of a monitoring backend, retention/access policy, and notification integration remains a separately approved operational decision.
