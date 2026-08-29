# Rotation, Recovery, and Alerting Runbooks

## Status

Approved

## Context

Credentials rotate independently and Drive revision history is the recovery mechanism, so production ownership must be explicit.

## Objective

Deliver actionable rotation, backup/recovery, alert response, and failure-recovery procedures backed by the existing deployment and observability design.

## Scope

Document independent Codex/JWT/Google credential rotation, Secret Manager version rollout, Drive version-history recovery, token revocation, alerts for auth/Drive/latency failures, ownership, and operator exercise records; align Terraform/monitoring configuration where the chosen platform supports it.

## Non-goals / later

No automatic secret-rotation service, permanent deletion workflow, or external incident-management integration.

## Constraints / caveats

Procedures must not require logging document bodies or exposing secrets. Recovery must restore/retain Drive content without violating the no-permanent-deletion rule.

## Dependent tasks or work

Depends on the threat model, resilience coverage, Secret Manager mounts, and audit/metric contract.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — recovery, rotation, and operational-hardening requirements.

## Expected change surface

Operations documentation, optional infrastructure monitoring resources, and procedure-validation records/harnesses. Core transport interfaces remain unchanged.

## Open Questions

None.

