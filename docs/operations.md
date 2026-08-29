# Gateway Operations Runbook

This is an operator-only procedure for the read-only Google Drive Markdown gateway. There is no
live drill in repository tests: they only read this document and its synthetic record template and
do not perform a rotation, recovery, provider call, deployment, monitoring query, or live action.

Never put credential values, document bodies, authorization headers, provider responses, file
names, paths, identifiers, revision values, URLs, error messages, stacks, or secret references in
commands, logs, tickets, chat, or repository files. Routine audit and telemetry remain limited by
the [observability contract](./observability-contract.md). An exercise or incident record is a
separate, access-controlled, sanitized operator artifact; use the checked-in
[`operations-exercise-record.example.json`](./operations-exercise-record.example.json) only as a
schema-shaped template. It is not live evidence, a credential inventory, write-gate approval, or a
gateway write lease.

No procedure here enables a write session, nested mutation, archive route, Drive delete, or Drive
trash operation. The current read surface is bounded and root-confined, including nested and
recursive reads. `/healthz` proves process composition only; it does not prove Drive readiness or
recovery.

## Roles, authorization, and evidence

The service operator coordinates incidents, owns acknowledgement, and keeps a sanitized external
record. The identity owner owns Work JWT and Codex trust. The Drive administrator owns Drive ACLs,
Google authentication, and version-history recovery. The deployment administrator owns Cloud Run,
Terraform, and Secret Manager changes. A paging alert has a 15-minute acknowledgement target;
access, authorization, or recovery uncertainty is escalated immediately to the relevant owner.

Before an exercise or change, obtain the required approval and change window in the approved
operator system. Record only an opaque exercise reference, procedure kind, environment class,
timestamp, outcome, owner role, bounded step status/reason code, opaque approval-reference digest,
and follow-up state. Keep the completed record outside this repository with the approved
access/retention controls. Do not record raw identifiers, document content, credentials,
request/response bodies, URLs, errors/stacks, or secret references.

## Credential rotation and revocation

Every credential class is a separate principal. Complete authorization, replacement provisioning,
bounded controlled validation, rollback readiness, old-material revocation, and sanitized result
recording for one class before changing another. A successful rotation of one class is not evidence
for another. If validation or revocation is uncertain, stop, retain the prior material for review,
and escalate; do not delete it automatically.

For a confirmed compromise, first disable or revoke only the affected principal through the
approved owner process. Limit traffic or roll back only when needed to stabilize the incident, then
open the matching failure procedure. Do not speculatively rotate unrelated principals.

### Work JWT / Codex Work

1. The identity owner authorizes the change and identifies the configured issuer, audience, and
   JWKS configuration only in the protected operator system.
2. Provision a replacement signing key through the upstream identity provider. Allow overlap for
   the configured JWKS cache, maximum accepted token lifetime, and clock tolerance.
3. Perform a bounded controlled protected-route validation with approved test identity material.
   Never paste a JWT into command history, evidence, or logs.
4. If issuer, audience, or JWKS configuration changes, deploy the reviewed non-secret
   configuration and retain a known-good Cloud Run revision for rollback.
5. After the overlap and validation window, retire or revoke the old signing material upstream.
   Confirm old-token rejection only through approved protected validation, without retaining it.

If `/healthz` fails, treat this as a process composition issue. If protected-route rejection occurs
after the intended rollout, treat it as a Work principal or configuration issue and roll back the
reviewed configuration or traffic through the approved change process.

### Codex bearer

1. The identity owner authorizes a replacement value and version through the approved Secret
   Manager process. Do not expose the value or version reference in this runbook, a command, or a
   record.
2. Update the existing mounted-version policy. The service reads the mounted Codex bearer file on
   each verification, so this does not require an application image rebuild.
3. Perform a bounded controlled new-bearer protected-route check without printing or retaining the
   bearer. Keep a rollback path until acceptance is established.
4. After replacement is accepted and rollback is no longer required, revoke or disable the old
   version through the approved Secret Manager process. Confirm prior-bearer rejection only through
   approved controlled validation.

This procedure does not redeploy code, change Work JWT trust, or alter Google Drive access. A
protected-route rejection after this rollout is a Codex principal/configuration incident; use the
approved rollback path and escalate to the identity owner.

### Google Drive credentials

Identify `drive.authMode` before making any change. A Google credential failure is a Drive/auth
incident, not evidence of document loss and never authorization to enable writes.

For `my-drive-refresh-token`:

1. The Drive and deployment administrators update the existing OAuth credential object through
   the approved Secret Manager process, without storing the object or its reference in evidence.
2. Restart to a reviewed, controlled Cloud Run revision so the replacement mount is observed.
3. Validate only the restricted, read-only controlled operation permitted by the live-harness
   policy. If reauthorization cannot be completed, treat the condition as a Drive outage.
4. Revoke the former refresh token at the OAuth provider only after replacement succeeds and
   rollback readiness is no longer required.

For `shared-drive-adc`, rotate or revoke workload/service-account access, identity bindings, or
impersonation through the approved platform identity process. Do not mint, export, download, or
mount a service-account key file. Recheck least-privilege Drive ACLs separately from project IAM;
do not grant broader Drive scope.

For either mode, Drive failure after the change requires rollback of configuration or traffic only
through the approved process and Drive-administrator escalation. Retain prior external
secret/identity state for review instead of deleting it automatically.

## Alert semantics and activation

No monitoring backend, exporter, dashboard, notification target, or deployed alert policy exists
in this repository. The following are conservative, backend-neutral activation thresholds, not an
SLO. Before activation, the backend owner maps each semantic to an approved sink/query language,
preserves closed-label aggregation, configures notification routing, and completes access and
retention review. Revisit thresholds after controlled drills or representative traffic evidence.

Use only these typed metrics and dimensions from the observability contract:

| Metric | Allowed dimensions for this procedure |
| --- | --- |
| `gateway_http_requests_total` | `operation`, `principal_kind`, `result` |
| `gateway_http_request_duration_ms` | `operation`, `result` |
| `gateway_request_timeouts_total` | `operation` |
| `gateway_dependency_failures_total` | `operation`, `dependency`, `failure` |
| `gateway_rate_limit_rejections_total` | `operation`, `principal_kind` |

Do not add file IDs, paths, revisions, document content, principal subjects/issuers, operation IDs,
provider status/message, exception data, URLs, headers, tokens, secret references, or arbitrary
labels. For deadline, latency, and rate-limit alert math, filter both numerator and denominator to
only the six JSON operations: `list_markdown`, `search_markdown`, `read_markdown`,
`create_markdown`, `update_markdown`, and `archive_markdown`. Exclude `mcp` and `/healthz` from
those calculations. The MCP transport has no equivalent application-level deadline or limiter, so
these alerts do not monitor MCP deadline or admission-control pressure; use approved platform
capacity monitoring and treat equivalent MCP controls as a hardening follow-up. Missing telemetry
or sink failure is an observability incident, not evidence that the gateway or Drive is healthy.

| Alert class | Backend-neutral threshold | Initial owner and action |
| --- | --- | --- |
| Sustained authentication failures | `unauthenticated` terminal results are at least 10 in 5 minutes and at least 20% of routed terminal requests in that interval. | Service operator investigates configuration, revocation, or hostile traffic; escalate to identity owner. |
| Drive dependency degradation | `gateway_dependency_failures_total` with `dependency="drive"` rises for at least 10 requests in 10 minutes and is at least 5% of routed terminal requests in the same interval. | Service operator treats this as a Drive, provider, or authentication incident; escalate to Drive administrator. |
| Deadline/latency degradation | For the six JSON operations only, timeouts are at least 5 in 10 minutes and at least 2% of matching JSON routed terminal requests, **or** p95 `gateway_http_request_duration_ms` is at least 80% of configured `requestTimeoutMs` for 10 minutes with at least 20 completed matching JSON routed requests. | Service operator checks timeout configuration and bounded provider state. |
| Rate-limit pressure | For the six JSON operations only, `gateway_rate_limit_rejections_total` is at least 20 in 10 minutes and at least 10% of matching JSON routed requests. Start as a ticket/non-page; page only when paired with the latency or dependency alert. | Service operator assesses client behavior or capacity; escalate to client owner. |

## Common incident response

1. Acknowledge the page within 15 minutes, establish severity and the service-operator incident
   coordinator, and capture only bounded, allowlisted typed counters and audit facts.
2. Classify the condition as authentication, Drive dependency, timeout, rate-limit, runtime, or
   observability failure. Do not treat `/healthz` as a Drive check.
3. Stabilize with an approved traffic/configuration rollback or the matching principal-specific
   credential procedure. Escalate Drive provider, ACL, version-history, or Google-auth issues to
   the Drive administrator.
4. Validate process composition with `/healthz` and protected-route denial separately. A healthy
   process does not prove Drive recovery.
5. Record a sanitized external outcome and follow-up. It does not authorize a write lease or prove
   write-gate safety.

## Drive version-history recovery

An authorized Drive administrator needs a specific incident or change approval before restoring a
version. In the approved Drive interface, locate the affected file without copying its path, name,
identifier, content, or version identifier into the repository, chat, alert payload, or exercise
template. Confirm that it remains a root-confined Markdown file (the current read surface permits
bounded nested and recursive reads). Select a known-good version and restore it through Drive
version history.

Never delete or trash versions, replace content through an unguarded gateway write, recover to a
nested location, or use unavailable archive functionality. The current runtime has no write
session, and archive is disabled. The authorized operator verifies restricted post-recovery
metadata/content and writes only an opaque target reference, a non-content integrity/result
indicator, and outcome to the access-controlled external record. Escalate wrong-parent, missing
version, conflict, access, or uncertain outcomes rather than guessing or broadening access.

## Outage and timeout recovery

First distinguish process health, authentication failure, Drive dependency failure, and caller
deadline. A timeout can leave an already-dispatched provider operation unresolved: do not retry or
replay a mutation. Writes, nested mutations, and archive remain unavailable. After recovery, use
only the bounded, root-confined nested/recursive read surface; involve the Drive administrator for
provider or Google-auth conditions.

## Cleanup and retention

Retain Secret Manager versions, Cloud Run revisions, Drive data, external sanitized evidence, and
Terraform state according to approved retention policies. Do not automatically delete any of them.
The live-harness manual cleanup may move only the exact marked disposable file to its direct-child
archive; it never deletes or trashes a file. This exception is a harness cleanup constraint, not a
production archive capability.
