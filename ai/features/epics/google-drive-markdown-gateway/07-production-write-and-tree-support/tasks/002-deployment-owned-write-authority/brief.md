# Deployment-Owned Write Authority

## Status

Complete

## Context

The signed live-evidence gate issues a short process-local lease, but production has no replay store,
approval submission/renewal path, authenticated write transport, or write session. It is a release
proof mechanism rather than a practical ongoing service authorization mechanism.

## Objective

Establish the smallest production-capable, default-deny write authority: authenticated gateway
principals plus an explicit deployment setting and server-side Google write transport.

## Scope

Retain the live capability harness as an operator release gate, but retire JWS approval, durable
replay, expiring lease, and evidence-to-runtime authority. Add a strict write-mode configuration that
normalizes absence to disabled, a separately acknowledged Terraform default, and a server-side
authenticated raw Drive HTTP seam using only the selected Google identity and the exact Drive write
scope selected in `feature.md`. Simplify the guarded writer/session boundary so write capability is
process-local and non-serializable. Compose no write-capable transport or transport-facing session
when write mode is disabled.

## Non-goals / later

No nested mutation semantics, archive enablement, live credentials, Terraform apply, Drive ACL
change, Work/Codex environment change, or per-request operator approval.

## Constraints / caveats

Work JWT and Codex bearer credentials never authenticate to Google. Shared Drive ACL confinement is
operator-owned; My Drive OAuth's broader grant is a documented review risk. Enabled configuration
must fail startup on inconsistent credentials or limits. Remove obsolete gate code/tests/docs rather
than leaving two sources of write authority. Runtime transport exposure may remain disabled until
task 003 lands the complete mutation pre/postconditions.

## Dependent tasks or work

Depends on task 001's tree/topology model. Task 003 consumes the configured writer and session
boundary.

## Acceptance criteria

- Missing/disabled configuration performs no Google write-auth construction and exposes no write
  session to either transport.
- Enabled configuration can construct one authenticated raw writer from the server-side Drive auth
  mode without any client credential or secret in logs/config output.
- Live evidence remains a documented operator gate but can no longer mint runtime authority.
- Terraform requires both an explicit enable setting and a separate acknowledgement while defaulting
  to read-only.

## Likely starting points

- `src/write-gate/gate.ts` — current evidence/JWS/replay lease issuer to retire from runtime.
- `src/drive/guarded-drive-write-port.ts` — current non-forgeable writer coupled to the expiring
  lease.
- `src/drive/google-drive-auth.ts` — server-side ADC/OAuth construction and current read-only scope.
- `src/drive/google-drive-write-adapter.ts` — unauthenticated exact-request mutation seam.
- `src/config/service-config.ts` — strict deployment configuration and cross-limit checks.
- `src/runtime/server.ts` — shared service composition and absent production session.
- `infra/terraform/cloud-run.tf` and `infra/terraform/variables.tf` — runtime JSON and deployment
  acknowledgements.
- `tests/write-gate/`, `tests/drive/guarded-drive-write-port.test.ts`, and
  `tests/runtime/server.test.ts` — current authority/default-deny evidence.

## Expected change surface

Write-authority modules and tests; Google auth/raw HTTP composition; service/runtime config;
Terraform variables/preconditions/static tests; operator documentation references to the old lease.
The six public operation shapes and tree read behavior remain unchanged.

## Open Questions

None.
