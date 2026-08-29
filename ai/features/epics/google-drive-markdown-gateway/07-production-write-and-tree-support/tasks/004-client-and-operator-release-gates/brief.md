# Client and Operator Release Gates

## Status

Approved

## Context

Work and Codex currently publish all six operations, but their live guidance and harnesses correctly
report tree writes/archive as blocked. Operator documents still describe the lease gate and a
read-only deployment.

## Objective

Align both clients, observability/security records, deployment guidance, and isolated live harnesses
with the completed tree/write behavior without claiming or performing live cloud success.

## Scope

Update Work packaging/instructions and the project-scoped Codex skill for nested paths,
read-before-write, exact revisions, explicit archive confirmation, conflicts, timeouts, and
`OUTCOME_UNKNOWN` reconciliation. Extend sanitized operator harnesses/checklists for nested
list/search/read/create/update, stale rejection, duplicate refusal, archive verification, and cleanup
inside a dedicated marked test tree. Align threat model, observability contract, deployment/rollback
runbooks, config examples, and release evidence with the default-off write model and trusted-admin
assumptions.

## Non-goals / later

No plugin installation, Codex environment mutation, Drive request, secret provisioning, Terraform
apply, alert backend, production data migration, or declaration that an operator gate passed.

## Constraints / caveats

Harnesses remain opt-in, external-config/output only, secret/content safe, no-shell where already
required, and unable to enable runtime writes themselves. Evidence is sanitized release input, not
runtime authority. Ambiguous create/update/archive or timeout states must stop automatic cleanup and
emit manual reread/recovery direction using only safe opaque references.

## Dependent tasks or work

Depends on tasks 001 through 003. The remaining operational-hardening and migration features follow
this corrective feature.

## Acceptance criteria

- Work and Codex guidance describe the same six nested operations and safe recovery behavior.
- Static/fake harness tests prove correct stage ordering, stop conditions, sanitized publication,
  and disabled-mode reporting without network access.
- Deployment documentation and Terraform examples keep writes disabled by default and require the
  separate reviewed enablement gate.
- Threat/observability records state the exact concurrency residuals and expose only closed,
  content-free terminal categories.
- No artifact states or implies that live Drive, Work, Codex, Cloud Run, ACL, secret, or Terraform
  validation succeeded during implementation.

## Likely starting points

- `plugin/chatgpt-work/instructions.md` and `plugin/chatgpt-work/live-validation-checklist.md` — Work
  mutation workflow and current blocked release state.
- `.agents/skills/codex-cloud-markdown-gateway/SKILL.md` — checked-in Codex operating guidance.
- `src/codex-cloud/harness.ts` and `tests/codex-cloud/harness.test.ts` — isolated staged live flow and
  sanitized evidence publication.
- `docs/codex-cloud-client-setup.md`, `docs/cloud-run-deployment.md`, and
  `docs/write-gate-and-client-validation.md` — operator configuration and obsolete lease/read-only
  descriptions.
- `docs/threat-model.md` and `docs/observability-contract.md` — current direct-root/write-disabled
  security and telemetry contracts.
- `src/live-drive/probe.ts` and `docs/live-drive-capability-harness.md` — dedicated-root provider
  capability evidence to extend or route into the release checklist.
- `tests/plugin/chatgpt-work-package.test.ts` and `tests/codex-cloud/docs.test.ts` — client package and
  guidance contract coverage.

## Expected change surface

Work/Codex instructions and package checks; operator-only harness state machines/templates/tests;
deployment, threat, observability, write-release, and rollback documentation; Terraform example
inputs if needed. Core application/adapter behavior should remain unchanged except bounded defects
found while exercising the completed contract.

## Open Questions

None.
