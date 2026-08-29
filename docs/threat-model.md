# Threat Model

## Current data flow and boundaries

```text
Work MCP JWT principal ---- HTTPS ----\\
                                   Gateway HTTP/API -> MarkdownService -> guarded Drive ports -> Google Drive root
Codex bearer principal --- HTTPS ----/       |                |
                                             |                +-> revision/topology policy
Cloud Run config + mounted secrets ----------+-> verifier / Drive auth
                                             |
                                             +-> allowlisted audit and metric recorder
Operator / Drive admin -> Terraform, Secret Manager, Drive ACLs, guarded live evidence (separate)
```

Trust boundaries are: external client to Cloud Run; Work issuer/JWKS and Codex secret mount to verifier; non-secret configuration and secret mounts to runtime; gateway to Google Drive; application policy to the Drive port; configured root/archive topology; and operator-owned Terraform, Secret Manager, Drive ACLs, and guarded live evidence. Normal tests make no provider, secret, deployment, or telemetry network action.

The current product is intentionally conservative: only direct-root topology is safely implemented. Nested/recursive reads and nested writes are unavailable, and archive is unavailable pending atomic destination-topology proof. `/healthz` is liveness, not Drive readiness.

## Assets, goals, and actors

Protected assets are document confidentiality; document and revision integrity; root/archive confinement; bounded availability; Work, Codex, and Google credentials; runtime identity/configuration; future write-gate evidence/lease; and telemetry integrity/confidentiality. Actors are an unauthenticated or hostile client, Work MCP client, Codex client, runtime service account, Google Drive and JWKS providers, Secret Manager, deployment/Drive administrator, and log/metric destination.

## Abuse cases

| Abuse case | Assets and mitigation | Evidence | Residual risk / owner |
| --- | --- | --- | --- |
| Bearer theft/replay or forged/misconfigured JWT | Credentials and document access; principal-specific verifier, configured issuer/audience/JWKS, separate Codex bearer secret, fixed public errors. | Auth verifier and HTTP authentication tests. | Credential theft and issuer operations remain external; operator owns rotation and response. |
| OAuth/service identity overprivilege or cross-principal rotation | Google credentials and confinement; ADC is attached runtime identity, refresh credentials are mounted secrets, and Drive ACLs are administrator-managed. | Config validation, secret-loading tests, deployment configuration. | Least privilege and rotation are operator/Drive-admin work. |
| Traversal, ID escape, shortcuts, duplicates, or moved topology | Root/archive confinement; opaque-ID validation, guarded ports, direct-root checks, duplicate detection, and conservative unsupported nested/archive behavior. | Domain, service, and Drive-adapter tests. | Provider topology can change after a check; task 003 owns procedures. |
| Stale overwrite, timeout duplicate/retry, archive-delete, or write-gate bypass | Integrity; revision-checked updates, route deadline behavior, default-disabled writes, write-gate boundary, unavailable archive, and no permanent deletion. | Service and HTTP conflict/timeout/write tests. | Distributed timeout and authorization recovery require operational procedures. |
| Drive throttling or outage | Bounded availability; provider failures are normalized, bounded traversal applies, and dependency failures are closed telemetry categories. | Adapter/provider and HTTP failure tests. | Google availability and capacity are external; task 003 owns threshold/paging/recovery. |
| Malformed/oversize input and rate-limit exhaustion | Availability and parser safety; both transports use strict schemas and byte limits. The JSON API additionally enforces request deadlines and per-principal rate/concurrency limits; MCP bounds complete request/response payloads but has no equivalent application-level deadline or limiter today. | HTTP validation, limiter, and timeout tests; MCP wire-cap and protocol tests. | Work issuer controls and Cloud Run/platform limits are the present MCP abuse boundary. Sustained or slow MCP calls can still consume upstream capacity; operational response owns monitoring, and equivalent MCP admission controls remain a hardening follow-up. |
| Telemetry disclosure, log injection, or cardinality DoS | Telemetry confidentiality/integrity; typed allowlists, bounded audit-only IDs, closed metric labels, and Pino redaction. | Observability contract tests. | Destination access/retention is not selected here; task 003 owns policy. |
| Sink failure or live-evidence tampering | Availability and evidence integrity; sink exceptions cannot alter responses, while live evidence is separately guarded and sanitized. | HTTP sink-isolation tests and live-evidence implementation. | Evidence trust and storage administration remain operator work. |
| Broad Cloud Run IAM or ingress | Gateway access and runtime identity; deployment and IAM boundaries are explicitly operator-managed. | Terraform/deployment review. | Misconfiguration remains an administrative risk; operator owns access review. |
| Treating health as Drive readiness | Availability expectations; health endpoint is liveness-only and emits no application telemetry. | HTTP health-route tests and this model. | Readiness policy is deferred to operational follow-up. |

Thresholds, paging, response, recovery, backup, and rotation procedures are intentionally assigned to task 003 rather than this implementation.
