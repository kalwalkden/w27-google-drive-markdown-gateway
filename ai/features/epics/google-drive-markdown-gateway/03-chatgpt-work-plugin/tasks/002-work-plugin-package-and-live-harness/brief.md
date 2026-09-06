# Work Plugin Package and Live Harness

## Status

Approved

## Context

The remote endpoint cannot be declared compatible with the target Work tenant until an authenticated installation is exercised there.

## Objective

Provide the private-plugin packaging/instructions and a narrow, repeatable operator-run validation harness for all six operations and conflict behavior.

## Scope

Add supported private-plugin metadata/configuration artifacts, concise read-before-write and archive-confirmation instructions, Work OAuth issuer setup documentation, and a live test checklist/harness.

## Non-goals / later

No public marketplace publication, tenant administration automation, or embedded user credentials.

## Constraints / caveats

Keep platform-specific configuration isolated and updatable. A failed live test is evidence to fix the adapter, not permission to relax conflict or authorization rules.

## Dependent tasks or work

Depends on the stateless MCP adapter and deployed service infrastructure.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — Work plugin acceptance criteria and instructions.

## Expected change surface

Plugin/configuration artifacts, Work runbook, and live validation assets. No core document behavior changes.

## Open Questions

None.

