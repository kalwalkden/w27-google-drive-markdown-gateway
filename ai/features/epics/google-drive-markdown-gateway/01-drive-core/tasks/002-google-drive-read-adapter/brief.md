# Google Drive Read Adapter

## Status

Approved

## Context

The domain boundary needs a real Drive implementation for safe root discovery and read-only operations.

## Objective

Implement the Google-backed authentication modes and root-confined list, search, and read adapter behavior.

## Scope

Use `googleapis` and `google-auth-library` for Shared Drive ADC and externally mounted My Drive OAuth refresh-token modes; resolve/cache the configured root by ID; enforce parent ancestry and reject shortcuts/ambiguous paths.

## Non-goals / later

No create, update, archive, HTTP, MCP, or secret provisioning implementation.

## Constraints / caveats

The adapter must never broaden Drive queries outside the configured root. Normalize Google failures into domain errors and keep document bodies out of logs.

## Dependent tasks or work

Depends on domain contracts; enables guarded write work.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — Drive authentication and folder-boundary baseline.
- `ARCHITECTURE.md` — current repository boundary orientation.

## Expected change surface

Google adapter/auth provider modules, configuration inputs, fake-to-real adapter tests, and optional live-read harness coverage.

## Open Questions

None.

