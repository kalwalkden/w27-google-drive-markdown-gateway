# TypeScript Service Baseline

## Status

Approved

## Context

The repository has planning-only content and no product runtime or validation tooling.

## Objective

Create the smallest reproducible Node 24/pnpm strict-TypeScript service foundation that can remain green while later adapters are added.

## Scope

Add package metadata, Node 24/container conventions, strict compiler configuration, Biome, Vitest, a minimal application entry point, and repository commands for build, test, and checks.

## Non-goals / later

No Drive client, API, credentials, MCP transport, or deployment behavior.

## Constraints / caveats

Pin dependencies through the pnpm lockfile. Keep the application free of environment-specific credentials and preserve the existing vendored-skill check.

## Dependent tasks or work

Unblocks every subsequent implementation task.

## Likely starting points

- `ARCHITECTURE.md` — records that no product toolchain exists.
- `google-drive-markdown-gateway-handoff.md` — defines the intended service shape.

## Expected change surface

Package/configuration files, a minimal `src/` entry point, and an initial test. Existing planning and skill files remain unchanged.

## Open Questions

None.

