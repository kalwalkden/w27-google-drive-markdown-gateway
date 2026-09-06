# Threat Model and Observability Contract — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `docs/threat-model.md` (new) | data flow, boundaries, assets, abuse cases, mitigations, residual risk | Required current-tree threat model. |
| `docs/observability-contract.md` (new) | audit/metric schemas, redaction, cardinality, SLO inputs | Normative hardening contract. |
| `src/observability/audit.ts` | audit event/types, Pino redaction, principal/file-ID sanitization | Existing typed seam; retain bounded audit traceability and add narrow metric typing. |
| `src/http/json-api.ts` | request context, `complete`, public failure mapping | Sole terminal request lifecycle; emits typed facts. |
| `src/drive/provider-error.ts` | finite Drive failure/operation values | Safe private dependency classification. |
| `tests/observability/audit.test.ts` (new) | schema/redaction/cardinality tests | Proves no sensitive/hostile telemetry values. |
| `tests/http/json-api.test.ts` | route lifecycle/audit tests | Coordinate extension of existing fake-route coverage. |

## Entry point and call path

```text
HTTP request -> createJsonApiApp context -> PrincipalVerifier -> limiter
  -> MarkdownService / guarded session -> complete()
  -> typed AuditLogger + MetricRecorder -> public JSON response
```

Runtime composes non-secret Cloud Run config, selected Drive auth/read adapter, MarkdownService, and PrincipalVerifier. Threat documentation additionally maps Work JWT/JWKS, Codex bearer, Google Drive, operator-managed Terraform/Secret Manager/Drive ACLs, and the separate live-evidence flow. `GET /healthz` bypasses verifier, service, audit, and application metrics.

## Contracts, state, and invariants

- `MarkdownApiOperation` is exactly the six named Markdown operations; `MarkdownApiAuditResult` is the current finite terminal result vocabulary.
- Routine audit permits operation ID, operation, bounded normalized principal facts, result, status, duration, bounded result count, a bounded safely known opaque file ID, and closed Drive dependency categories only. No path, query, revision, content/excerpt, credentials, raw provider data, error, or arbitrary context. File ID never becomes a metric label.
- Metrics use closed application-owned labels only; no correlation, identity, document, error, or caller/provider-derived values.
- `DriveProviderError.failure` and `.operation` are closed safe categories. Optional status/message stay outside public/audit/metric contracts.
- `AuthenticatedPrincipal` stays `{ kind, subject, issuer }`; only bounded normalized authenticated facts appear in audit, never metrics. Failed/hostile values collapse to unauthenticated.
- `MarkdownService` remains policy owner. Direct-root-only reads/mutations and unavailable archive are topology protections, not monitoring failures.
- `ServiceConfig` supports ADC and mounted My Drive OAuth; Terraform has non-secret config and secret references. Live evidence stays a separate redacted artifact.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/observability/audit.ts` | narrow typed logger event | Preserve and strengthen allowlisting. |
| `src/http/json-api.ts` | `complete()` clears timeout/releases limiter/isolates audit sink | Add metrics without duplicate terminal behavior. |
| `tests/http/json-api.test.ts` | injected audit logger and fake route dependencies | Use for local redaction/lifecycle tests. |
| `src/write-gate/audit.ts` and its test | literal reason allowlist plus serialized sentinel assertion | Mirror closed-schema discipline; keep semantics separate. |
| `src/live-drive/evidence.ts` and tests | strict evidence schema and forbidden-key walk | Supporting redaction evidence only; do not combine artifacts. |
| `src/config/service-config.ts`, deployment docs, Terraform | explicit auth modes, mounted secrets, least privilege, composition-only health | Cite as mitigation; do not edit deployment assets. |

## Tests and fixtures

Existing `tests/http/json-api.test.ts` covers audit allowlisting, response-content omission, provider-error public redaction, timeout, sink isolation, health isolation, safe bounded file-ID inclusion, and hostile file-ID omission. Auth, application/Drive, runtime/deployment, and live-evidence tests provide supporting controls.

Add only local fake events/recorders. Test exact keys, forbidden sentinels, no arbitrary labels, bounded principals, Drive-category mapping, lifecycle-once behavior, and sink failure isolation. No real credential, JWT, provider payload, Google call, telemetry endpoint, or live evidence fixture.

## Expected unchanged boundaries

- Drive behavior, domain/application policy, write-gate semantics, conservative topology limits, public HTTP envelope, and credentials stay unchanged except private consumption of existing Drive failure categories at telemetry seam.
- `src/live-drive/**`, its tests/docs/evidence examples, Terraform, Docker, deployment guide, external backends, alert rules, dashboards, runbooks, and recovery procedures are out of scope.
- Do not edit task statuses, build log, handoff, or task lists.

## Validation commands

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

No Docker, Terraform, `gcloud`, exporter, remote JWKS/OAuth, Google Drive, or `pnpm drive:probe`.

## Selected external material

None. Repository handoff, approved artifacts, current source/tests, deployment assets, and live-evidence documentation are binding inputs.

## Uncertainties to verify

- Re-read final concurrent `src/observability/audit.ts`, `src/http/json-api.ts`, and route tests immediately before implementation; all are dirty in the shared worktree.
- Confirm added Pino redaction paths are defense in depth only; typed events remain the safety proof.
- Choose metric file/interface split only after checking runtime composition; retain a no-op default until a separately approved backend exists.
- Escalate rather than silently hash/add to metrics if audit subject/issuer conflicts with selected log-destination retention/access policy.
