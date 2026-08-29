# TypeScript Service Baseline — Implementation Plan

## Scope

Create the repository's first product runtime and validation foundation: Node 24 and pnpm metadata, a committed pnpm lockfile, strict TypeScript compiler settings, Biome, Vitest, a buildable minimal Express-ready application module, and one executable baseline test. Add the repository commands needed to build and validate that foundation.

This task does not add Google Drive access, configuration or credential loading, domain contracts, `MarkdownService`, HTTP/MCP routes, authentication, deployment assets, or live platform harnesses.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| Use Node 24 and pnpm. | Declare Node `24.x` in the package engine range and pin the chosen pnpm release through `packageManager`; generate and commit `pnpm-lock.yaml`. Do not add a different package manager lockfile. | Approved task brief; epic direction; feature constraints |
| Use strict TypeScript. | Configure `strict: true` and a Node 24-compatible module/runtime setup. Include source and tests in type checking; keep generated output and dependencies excluded. | Approved task brief; epic direction; `ARCHITECTURE.md` |
| Use Biome and Vitest. | Add their configuration and package scripts. Biome checks all tracked TypeScript/JSON/Markdown configuration files within its supported scope; Vitest runs a non-watch baseline test. | Approved task brief; feature constraints; `ARCHITECTURE.md` |
| Keep a minimal Express-ready service foundation only. | Install Express and its TypeScript declarations, export an app-construction seam from the application entry module, and keep that app route-free. The process-start seam must not read environment values or require credentials. | User-provided shaping direction; task non-goals; epic direction |
| Preserve existing setup validation. | Keep `scripts/verify-vendored-skills.sh` unchanged and invoke it from the aggregate validation command. | `AGENTS.md`; task brief |
| Do not commit secrets. | Do not create `.env` files, credential examples containing values, Google SDK setup, or secret-bearing test fixtures. | `AGENTS.md`; task constraints; product handoff |

The existing architecture says the baseline tools are not configured. That is current-tree evidence, not an instruction to reuse nonexistent product conventions.

## Visual design

No visual design applies. This task creates service/tooling infrastructure and deliberately exposes no user-facing interface.

## Product alignment

The baseline establishes a single typed runtime that later work can extend without creating a second service path. It must remain intentionally neutral about Drive, transport contracts, and credential modes so later tasks can implement the approved `MarkdownService` boundary and adapters independently.

## Implementation approach

1. Add `package.json` as the authoritative project manifest.
   - Set private package metadata, Node 24 engine requirement, and a Corepack-compatible `packageManager` pnpm pin.
   - Add runtime dependency `express`; add development dependencies for TypeScript, Node/Express types, Biome, Vitest, and a TypeScript execution/build configuration only if needed by the selected scripts.
   - Use scripts with these names and responsibilities: `lint`, `format`, `format:check`, `typecheck`, `test`, `build`, `verify:vendored-skills`, and aggregate `check`.
   - `check` must run, in a deterministic fail-fast sequence: `lint`, `format:check`, `typecheck`, `test`, `build`, then `verify:vendored-skills`. It is the canonical aggregate validation command for this baseline.
2. Install with pnpm and commit the generated `pnpm-lock.yaml`. The lockfile is the dependency pinning mechanism; avoid hand-editing it.
3. Add root TypeScript configuration for strict compilation of `src/` and `tests/` without emitting. Add a build-specific configuration that emits the production entry module to a clean `dist/` tree and excludes tests. Use an ESM-compatible Node configuration consistently across source, test, and build settings; avoid experimental runtime loaders.
4. Add `biome.json` with formatter and linter configuration suitable for the new TypeScript repository. Ignore dependency and build output directories, not source/tests or task planning artifacts.
5. Add the minimal application entry module under `src/`.
   - Construct and export an Express application using an explicit factory/seam appropriate for future composition.
   - Do not register health, JSON, Drive, authentication, MCP, or other routes in this task.
   - Keep the start/bootstrap behavior import-safe for Vitest. If a process listener is included, it must be behind the module's direct-execution boundary and use no environment-dependent configuration.
6. Add an initial Vitest file under `tests/` that imports the entry module and proves the minimal app can be constructed without credentials or external I/O. Keep the assertion limited to the foundation; route-level expectations belong to the authenticated service API task.
7. Update `ARCHITECTURE.md` only if implementation establishes the concrete canonical command names. Update the marked architecture command section rather than adding a competing source of truth. Do not update feature/task statuses or planning artifacts.

## Expected control flow and invariants

At this stage the only product control flow is local composition:

`test or future bootstrap` → `src application factory` → `Express application instance`

The factory must have no Google calls, credential reads, network calls, route behavior, or mutable shared request state. Future HTTP and MCP composition will depend on this source root but must add their own explicit configuration and dependencies rather than implying them here.

Invariants:

- A clean checkout can install from the lockfile and run every aggregate validation step.
- `pnpm check` includes format checking, not formatting/writing.
- `pnpm build` produces only build output and does not type-check tests as part of emitted production code.
- `pnpm test` is finite/non-watch and does not need credentials, Drive access, or network connectivity.
- The baseline does not expose an unauthenticated endpoint, including a health endpoint.
- No generated output, dependency directory, or credentials are committed.

## Current-tree deviations and reference implementation

There are no existing product modules, package manifests, lockfiles, test roots, or runtime entry points to edit. `ARCHITECTURE.md` explicitly records that product linting, type checking, and tests are unconfigured. The task brief's likely starting points are planning documents only; implementation begins with new root configuration and source/test files.

There is no repository implementation to reuse. The existing `scripts/verify-vendored-skills.sh` is the one validated repository command and remains an unchanged aggregate-validation dependency.

## Test and validation strategy

Add the single unit test described above, then validate from a clean dependency state using:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
./scripts/verify-vendored-skills.sh
pnpm check
```

The first six commands isolate failures; `pnpm check` verifies the canonical aggregate path. Confirm the build output is ignored by version control and inspect the staged change for absent credentials and absent unrelated planning/status edits.

## Risks and implementation checks

- Verify the pnpm release selected in `packageManager` works with Node 24 in the implementation environment before finalizing the generated lockfile.
- Verify Biome's format check covers the new configuration/source/test files without trying to reformat vendored skill content.
- Verify the selected TypeScript module settings let Vitest import the ESM application module and let Node execute the emitted build without a TypeScript loader.
- Keep the package/version choices current at implementation time through the package manager resolution and lockfile; no external documentation has been selected as task policy.

## Open questions

None. Dependency patch versions and the exact pnpm pin are deliberately resolved by the implementation worker through the generated lockfile, subject to the Node 24 and tool constraints above.
