# Migration Taxonomy and Manifest

## Status

Approved

## Context

The gateway becomes useful only when the planning source of truth is clearly organized and the exact move is auditable.

## Objective

Define the target Drive taxonomy, source-of-truth policy, and explicit migration manifest/tooling for the approved planning files.

## Scope

Add documentation and narrowly scoped manifest support for briefs, specifications, drafts, and archives; enumerate intended files, target relative paths, preconditions, archive behavior, and rollback/recovery information.

## Non-goals / later

No broad Drive inventory, implicit bulk copy, permanent deletion, credential handling, or migration of unrelated repository files.

## Constraints / caveats

The manifest is reviewable before any live operation. The gateway must reject collisions and ambiguous paths; repository code and operational documentation remain repository-owned.

## Dependent tasks or work

Depends on the completed gateway and its safe write/archive behavior.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — Epic 6 folder and source-of-truth requirements.

## Expected change surface

Migration documentation and manifest/helper assets using the gateway contract. No core Drive or transport behavior change.

## Open Questions

None.

