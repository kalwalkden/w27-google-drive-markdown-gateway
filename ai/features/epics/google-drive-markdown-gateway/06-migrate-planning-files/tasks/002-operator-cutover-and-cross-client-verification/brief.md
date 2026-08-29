# Operator Cutover and Cross-Client Verification

## Status

Approved

## Context

Migration and client access are live operations requiring an authorized operator, credentials, and the deployed gateway.

## Objective

Provide a controlled cutover procedure and evidence harness that verifies the same Markdown file across ChatGPT Work, Codex cloud, macOS, iPhone, and iPad.

## Scope

Add an operator checklist/harness for manifest execution, list/read/create/update/conflict/archive validation, cross-client visibility, source-of-truth declaration, rollback, and completion evidence.

## Non-goals / later

No automatic client-device control, unattended migration, Google credential distribution, or alteration of unrelated content.

## Constraints / caveats

Live execution occurs only after the operator approves the manifest. Preserve revision-safe updates and archive-only removal; failure evidence must be safe to retain in the repository.

## Dependent tasks or work

Depends on the migration manifest, deployed Work/Codex clients, and operational recovery runbooks.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — migration acceptance criteria and cross-client requirements.

## Expected change surface

Cutover/runbook documentation and validation harness assets. No production behavior expansion.

## Open Questions

None.

