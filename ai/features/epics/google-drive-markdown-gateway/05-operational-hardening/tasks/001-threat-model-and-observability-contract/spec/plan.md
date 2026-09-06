# Threat Model and Observability Contract — Implementation Plan

## Scope

Document a current-tree threat model and a durable allowlisted observability contract. Tighten routine audit/metric output so it cannot contain paths, revisions, content, credentials, request bodies, or provider payloads. Retain only bounded opaque file IDs in access-controlled audit records where the API already safely knows them; never use them as metric labels. Add fake/static tests proving those rules.

No exporter, dashboard, alert policy, SIEM, runbook, live operation, retry, Drive operation, credential, or write authority is in scope. Task 003 owns alert/runbook configuration; task 002 owns resilience and Drive edge-case coverage.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| Gateway has Work MCP and Codex external principals, Cloud Run runtime, guarded Drive boundary, and operator-managed deployment. | Model each as a trust boundary; do not invent product roles. | Brief, handoff, current tree. |
| Shared Drive ADC and My Drive refresh-token modes are both supported. | Distinguish attached runtime identity from mounted OAuth credentials; Drive ACLs remain out-of-band administrator work. | `src/config/service-config.ts`, Terraform, deployment guide. |
| Work verifies configured issuer/audience/JWKS; Codex verifies a separate mounted bearer secret. | Treat authentication, authorization, rotation, and audit identities as principal-specific. | `src/auth/principal*.ts`, handoff. |
| Current Drive surface is deliberately conservative. | Document that direct-root topology is the only safe implemented surface: nested/recursive reads and nested writes are unavailable; archive is unavailable pending atomic destination-topology proof. | `src/application/markdown-service.ts`. |
| No secret/path/revision/content leakage. | Routine audit and metrics exclude paths, queries, folder IDs, revisions/ETags, excerpts/content/lengths, bodies, raw authorization/JWT, secret references, URLs, provider payload/status/message, and stacks. A bounded opaque file ID is audit-only when safely known. | Task direction, feature constraint, handoff. |
| Handoff requires audit traceability by file ID. | Preserve the current bounded `fileId` field for successful read/create/update/archive audit events. Treat it as restricted operational metadata with retention/access policy owned by task 003; never use it as a metric dimension. | Handoff and completed API contract. |
| Hostile input must not create telemetry series. | Metrics use only closed application-owned enum labels; no IDs, principals, correlation IDs, paths, errors, sizes, or client/provider strings. | This task's cardinality decision. |
| Live-drive evidence is independently sanitized. | Cite but do not import, emit, modify, or run it. | `src/live-drive/evidence.ts`, live-harness docs. |

## Visual design

No visual design applies.

## Detailed implementation approach

### 1. Document data flow, boundaries, and threats

Create `docs/threat-model.md` with this current data flow:

```text
Work MCP JWT principal ---- HTTPS ----\
                                   Gateway HTTP/API -> MarkdownService -> guarded Drive ports -> Google Drive root
Codex bearer principal --- HTTPS ----/       |                |
                                             |                +-> revision/topology policy
Cloud Run config + mounted secrets ----------+-> verifier / Drive auth
                                             |
                                             +-> allowlisted audit and metric recorder
Operator / Drive admin -> Terraform, Secret Manager, Drive ACLs, guarded live evidence (separate)
```

Name the boundaries: external client/Cloud Run; Work issuer-JWKS and Codex secret mount to verifier; non-secret config and secret mounts to runtime; gateway to Google Drive; application policy to Drive port; configured root/archive topology; and operator-owned Terraform, Secret Manager, Drive ACL, and live evidence. State that normal tests do not perform provider, secret, deployment, or telemetry network actions.

List assets/goals: document confidentiality; document/revision integrity; root/archive confinement; bounded availability; Work/Codex/Google credentials; runtime identity/configuration; future write-gate evidence/lease; and telemetry integrity/confidentiality. List actors: unauthenticated/hostile client, Work MCP client, Codex client, runtime service account, Google Drive and JWKS providers, Secret Manager, deployment/Drive administrator, and log/metric destination.

For every following abuse case, record assets, mitigation, evidence, residual risk, and owner: bearer theft/replay or forged/misconfigured JWT; OAuth/service identity overprivilege and cross-principal rotation; traversal/ID escape/shortcuts/duplicates/moved topology; stale overwrite/timeout duplicate/retry/archive-delete/write-gate bypass; Drive throttling/outage; malformed/oversize input and rate-limit exhaustion; telemetry disclosure/log injection/cardinality DoS; sink failure/live-evidence tampering; broad Cloud Run IAM/ingress; and mistaking health for Drive readiness. Reference existing conservative topology, revision, rate-limit, timeout, secret mount, public-response, write-gate, and evidence-redaction controls. Assign thresholds, paging, response, recovery, backup, and rotation procedures to task 003.

### 2. Define the audit and metric contract

Create `docs/observability-contract.md`. Each externally reachable Markdown route emits at most one terminal audit outcome when it has a route context. `/healthz` stays unaudited and uninstrumented by the application. An audit/metric sink failure cannot change the classified HTTP response.

Define `markdown-api-request` as this closed event schema:

| Field | Allowed value | Policy |
| --- | --- | --- |
| `event` | literal `markdown-api-request` | Schema discriminator. |
| `operationId` | server-generated UUID-like value | Audit-only correlation; never client input or metric label. |
| `operation` | `MarkdownApiOperation` enum | Closed six-operation vocabulary. |
| `principal.kind` | `work-mcp`, `codex`, `unauthenticated` | Closed enum. |
| `principal.subject`, `principal.issuer` | existing bounded normalized authenticated facts | Audit-only, absent on failed auth; never metrics. |
| `result` | `MarkdownApiAuditResult` enum | Stable terminal category. |
| `statusCode`, `durationMs` | finite HTTP integer; non-negative rounded integer | Response class and duration only. |
| `fileId` | optional bounded, control-free opaque identifier | Audit-only for safely known read/write targets; never a metric label or failure-derived value. |
| `dependency`, `dependencyFailure` | optional closed values for dependency failure | Initially `drive` plus `DriveProviderFailure`, not provider payload/status. |
| `resultCount` | bounded integer on successful list/search only | No individual result identity. |

Preserve the current bounded `fileId` and `auditFileId` helper. Forbid arbitrary `metadata`, `error`, `request`, `response`, `labels`, and `context` fields. Pino redaction stays defense in depth for authorization/token/secret/content/path/revision keys; typed allowlisting is the primary control.

Specify a small dependency-free `MetricRecorder` seam constructed at composition time and accepting typed closed facts, never a request/error object or generic labels API. Its no-op default preserves local tests.

| Metric | Type | Allowed dimensions | Purpose |
| --- | --- | --- | --- |
| `gateway_http_requests_total` | counter | `operation`, `principal_kind`, `result` | volume/outcomes/auth failures |
| `gateway_http_request_duration_ms` | histogram | `operation`, `result` | latency distribution |
| `gateway_http_in_flight` | gauge | `operation` | request pressure |
| `gateway_rate_limit_rejections_total` | counter | `operation`, `principal_kind` | limit pressure |
| `gateway_request_timeouts_total` | counter | `operation` | deadline pressure |
| `gateway_dependency_failures_total` | counter | `operation`, `dependency`, `failure` | Drive failure pressure |

Prohibit all other labels, including operation ID, subject/issuer, document identifiers, paths, revisions, queries, sizes, URLs, status text, exception content/class/stack, bodies, token/secret, and timestamp. Closed labels must be app-generated, never copied from a client/provider.

Document SLO/alert inputs only: request totals/outcomes for availability and sustained auth failures; dependency failures for Drive issues; timeout totals and duration histogram for latency; rate-limit rejections for abuse/capacity pressure. Do not choose thresholds, sinks, dashboards, notification policy, or procedures; task 003 consumes this contract.

### 3. Enforce at the existing seam

Update `src/observability/audit.ts`, then only the `src/http/json-api.ts` and runtime-composition seams needed to emit typed terminal facts. Preserve operation ID generation, one-terminal-completion behavior, `no-store`, public failure mapping, and audit-sink isolation. `createJsonApiApp` must not pass locators, response metadata, or request data to telemetry.

Map `DriveProviderError` privately using only its finite `failure` and `operation`; do not expose its status/message or change the public `UPSTREAM_UNAVAILABLE` response. Existing authentication, invalid input, rate limit, timeout, topology `UNSUPPORTED`, conflict, and internal classifications remain. Do not add exporter, scrape endpoint, SDK, secret, Terraform monitoring resource, sink, or deployment change. Recheck dirty concurrent route/audit files before editing.

### 4. Test with fakes

Create `tests/observability/audit.test.ts` and coordinate additions to dirty `tests/http/json-api.test.ts`. Use local fakes and sentinels resembling a path, unsafe/oversized file ID, folder ID, revision/ETag, document/excerpt, authorization/bearer/OAuth secret, secret file reference, provider body, and stack. Prove prohibited values cannot enter serialized audit events or metric observations, while one safe bounded opaque file ID remains audit-only.

Cover exact event keys/closed enums and bounded audit-only file ID; bounded principal handling; audit-only principal subject/issuer; one terminal event per route; health isolation; successful/auth/validation/rate-limit/timeout/Drive-failure classification; no locator/body/error/provider data in labels; and throwing sinks preserving exactly one public response with no fallback sentinel logging. No live exporter, credential, JWT, Drive call, probe, or live evidence may appear in tests.

## Expected control flow and invariants

```text
incoming request -> strict route/auth/rate-limit/deadline/service lifecycle
  -> one normalized terminal result -> typed audit + typed metric observations -> public response

locator/content/authorization/provider payload/error stack -/-> audit, metrics, fallback logs
```

- Telemetry describes an operation; it never copies a document or credential.
- Audit and metric schemas are finite allowlists; caller/provider data cannot add fields or series.
- Audit correlation and authenticated identity facts never become metric dimensions.
- Sinks are best-effort for availability but fail-closed for disclosure.
- Existing root confinement, direct-root topology restrictions, revision safety, default-disabled writes, no-permanent-delete policy, and public-response redaction remain intact.

## Current-tree deviation and unchanged boundaries

The handoff is only an initial baseline. Current code has `src/observability/audit.ts`, the `createJsonApiApp` terminal lifecycle, and Cloud Run/Terraform assets. It intentionally blocks nested/recursive reads, nested writes, and archive rather than providing the aspirational full-tree contract. Documents must reflect current behavior.

Do not change `src/live-drive/**`, live evidence/docs/examples, Drive adapter behavior, write-gate authorization, Terraform/Docker/deployment guide, credentials, task statuses, build log, task lists, or task-003 procedures. Preserve unrelated concurrent edits.

## Validation

```bash
CI=true pnpm test -- tests/observability tests/http/json-api.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

Inspect fake serialized events/metric observations for prohibited sentinels. Do not run the Drive probe, Docker, Terraform, `gcloud`, remote JWKS/OAuth, exporter, or any live service.

## Risks and careful checks

- Do not copy file IDs into metrics or replace the bounded audit value with a stable hash; either form creates unsafe metric cardinality and correlation.
- Principal subject/issuer are audit-only; revisit log retention/access before a real sink is added.
- Pino redaction cannot rescue a newly allowlisted field; exact event typing plus serialization tests are the enforcement mechanism.
- The repository has no exporter. Keep instrumentation no-op/dependency-free until a separately approved backend and retention/access design exists.

## Open questions

None. Backend, retention/access policy, thresholds, notification, recovery, and rotation procedure are deliberately deferred.
