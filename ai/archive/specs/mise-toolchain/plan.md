# Mise toolchain migration

## Scope

Replace the repository's developer, validation, operator-tool, and container-build command entrypoints
with one checked-in mise configuration. Mise owns tool-version selection and task orchestration.

This is a standalone, non-visual tooling task. It does not change gateway behavior, public APIs,
Drive access, deployment policy, credentials, or operator authorization gates.

## Decisions, constraints, and conflicts

- **Use mise as the canonical tool and task entrypoint.** This is the user's approved task decision.
  New contributor and automation instructions use `mise install` and `mise run ...`, not package
  manager scripts.
- **Retain pnpm only as the JavaScript dependency resolver.** Mise is a tool-version manager and task
  runner; it does not replace the dependency graph represented by `pnpm-lock.yaml`. The migration
  removes competing bootstrap and task authorities, not pnpm's lockfile/install role.
- **Remove Corepack as a project bootstrap path.** `Dockerfile` currently enables Corepack, and the
  local `pnpm` shim is also Corepack-backed. Mise must provision the pinned pnpm executable directly.
- **Move Node and pnpm version authority to `mise.toml` plus `mise.lock`.** Configure the Node 24
  release line and pnpm 11.19.0. Commit a generated mise lockfile so supported platforms resolve to
  immutable tool artifacts and checksums. Keep `package.json#engines.node` as the published runtime
  compatibility contract, but remove `package.json#packageManager` as a second pnpm version pin.
- **Use mise's explicit npm backend for pnpm.** Implementation verification found that the
  Aqua-provided pnpm 11.19.0 standalone artifact runs on an embedded Node 26 and therefore violates
  this repository's Node 24 engine. Mise 2026.9.1's built-in `npm:` backend installs pnpm without an
  external npm or Corepack process; pin `npm:pnpm` explicitly so the mise-managed Node 24 runtime
  executes pnpm and registry-order changes cannot change provenance.
- **Make mise tasks the only task definitions.** Move lint, format, format-check, type-check, test,
  build, vendored-skill verification, aggregate check, and operator CLI launchers out of
  `package.json`. Preserve argument forwarding for focused tests and operator commands.
- **Preserve validation semantics.** `check` remains fail-fast and runs lint, formatting check,
  type-check, tests, production build, and vendored-skill verification. Preserve `CI=true` in
  documented canonical commands rather than hiding it globally from interactive tasks.
- **Keep `pnpm-workspace.yaml`.** Although this is a single-package repository, the file contains the
  `allowBuilds.esbuild` install-script allowlist. Removing it would weaken the current dependency
  installation policy.
- **Keep pnpm state inside the repository's ignored store.** The existing `.gitignore` already
  excludes `.pnpm-store/`. Set `storeDir` in `pnpm-workspace.yaml`, pnpm 11's project configuration
  surface, so restricted development environments and Docker builds do not require a writable
  user-level pnpm cache.
- **Keep the production runtime free of mise and package-manager tooling.** Mise belongs in local,
  CI, and Docker build stages only. The final image remains a non-root Node runtime containing the
  compiled app and production dependencies.
- **Do not rewrite completed planning history.** Checked-in `ai/features/**` briefs, specs, and build
  logs describe prior approved work and retain their historical pnpm commands. Current instructions
  in `AGENTS.md`, `ARCHITECTURE.md`, `README.md`, and operational runbooks must be updated.
- **Bootstrap mise reproducibly.** Use mise 2026.9.1 as the minimum supported task runner because it
  is the shaping environment version and supports the selected locked-tool and structured-task
  behavior. Container bootstrap must pin an immutable release artifact or image digest and verify
  integrity; do not use `latest` or an unverified `curl | sh` build step.

Provenance: the user selected mise; `AGENTS.md` binds the vendored-skill and validation gates;
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `Dockerfile`, and
`tests/deployment/assets.test.ts` bind current toolchain behavior; `ARCHITECTURE.md` and current
runbooks bind the documented commands. The installed mise 2026.9.1 CLI and registry were observed
during shaping. No external template or third-party code is selected for copying.

## Visual design

No visual design is needed. This task changes repository tooling and command documentation only.

## Product alignment

The product brief and completed epic require strict TypeScript on Node 24 and reproducible,
credential-free local validation. This migration keeps those outcomes and does not touch the service
or security model. Operator-only commands remain explicit and must never become dependencies of
`check`, setup, image build, or automated tests.

## Implementation approach

### 1. Add the mise tool and task contract

Create `mise.toml` at repository root.

- Declare the explicit `npm:pnpm` 11.19.0 tool followed by the Node 24 release line. Mise gives the
  first tool's pnpm launcher precedence over Node's bundled Corepack shim; the launcher then resolves
  `node` from the following Node 24 tool path.
- Require mise 2026.9.1 or newer using the configuration's supported minimum-version mechanism.
- Enable project tool lockfiles and require project tools to resolve from the committed lockfile.
- Do not declare secrets, service endpoints, credential paths, hooks, or automatic live actions.
- Define short TOML tasks for:
  - `install`: `pnpm install --frozen-lockfile`;
  - `lint`: invoke the local Biome binary through pnpm;
  - `format`: apply Biome formatting;
  - `format:check`: check formatting without writes;
  - `typecheck`: run TypeScript with `--noEmit`;
  - `test`: run Vitest and forward all trailing arguments unchanged;
  - `build`: compile with `tsconfig.build.json`, then run `scripts/mark-cli-executable.mjs`;
  - `verify:vendored-skills`: execute `scripts/verify-vendored-skills.sh`;
  - `check`: invoke the six validation tasks sequentially and fail on the first failure;
  - `codex-cloud:harness`, `drive:probe`, `migration:plan`, and
    `migration:cutover-preflight`: run their existing built Node entrypoints and forward arguments;
  - an internal production-prune task if the Docker build needs it.
- Keep operator tasks callable but never referenced by setup, build, test, or `check`.
- Prefer structured mise task references for `check` so task definitions are not duplicated. Verify
  the final syntax with the pinned CLI before relying on it.

Generate and commit `mise.lock` from the completed configuration for the repository's supported
Linux container targets and normal developer platforms. Run mise's locked resolution checks to
prove the config does not fall back to a moving registry decision.

### 2. Remove duplicate package task/version authority

Edit `package.json` to remove `packageManager` and the `scripts` object after every command has a
mise task. Keep package identity, ESM mode, `bin`, Node engine range, dependencies, and dev
dependencies unchanged.

Keep `pnpm-lock.yaml` and `pnpm-workspace.yaml`. A metadata-only package edit should not re-resolve
dependencies; verify a frozen install leaves the pnpm lockfile unchanged.

Update `.gitignore` for mise's local-only config/cache artifacts while retaining `.pnpm-store/`.
Add `storeDir: .pnpm-store` to `pnpm-workspace.yaml`. Do not ignore the shared `mise.toml` or
`mise.lock` files.

### 3. Convert the container build without changing runtime behavior

Update `Dockerfile` and `.dockerignore` so the build context contains `mise.toml`, `mise.lock`,
`package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`.

- Bootstrap a pinned, integrity-checked mise 2026.9.1 build-stage binary or copy it from an
  immutable image digest.
- Install the locked build tools, install dependencies with the `install` task, build with the
  `build` task, and prune to production dependencies through mise.
- Preserve layer caching by copying tool/dependency manifests before source files.
- Keep the final Node 24 slim stage, `NODE_ENV`, port, copied artifacts, `USER node`, and command
  behavior unchanged. Do not copy mise configuration, mise state, pnpm stores, source, or dev tools
  into the runtime stage.
- Keep the Docker Node major aligned with `package.json#engines.node` and the mise Node request.

### 4. Update current documentation and repository policy

Replace active pnpm task invocations with their mise equivalents in:

- `AGENTS.md`, including the mandatory canonical validation block;
- `ARCHITECTURE.md`, including detected stack, command inventory, operator tools, and analysis notes;
- `README.md`, including prerequisites, fresh-checkout setup, CLI build, focused tests, and command
  table;
- `docs/cloud-run-deployment.md` prerequisites;
- `docs/codex-cloud-client-setup.md` build and harness command;
- `docs/live-drive-capability-harness.md` build and probe command;
- `docs/planning-file-cutover.md` preflight command.

Document that mise is the prerequisite and that it provisions Node and pnpm. Keep pnpm visible only
where explaining dependency resolution or the retained lockfile. Preserve all existing explicit
confirmations, external path requirements, and warnings on operator-only commands.

Do not alter `ai/features/**`, the original handoff, generated `dist/`, or vendored skill text merely
to replace historical or generic pnpm mentions.

### 5. Add tooling contract coverage

Update `tests/deployment/assets.test.ts` so it checks the mise-based build inputs and commands rather
than Corepack/pnpm-script strings, while retaining all non-root and narrow-context assertions.

Create `tests/tooling/mise.test.ts` if no equivalent exists at implementation time. Without adding a
TOML parser dependency, use the pinned mise CLI's machine-readable task/config output from a child
process to assert:

- required tools and tasks are discoverable;
- Node and pnpm authority comes from mise and `package.json` has no competing `packageManager` or
  scripts;
- `check` includes every canonical validation stage but no operator-only task;
- operator tasks preserve argument forwarding and remain opt-in;
- the committed lockfile is accepted in locked mode without changing it.

Tests must not install tools, access the network, invoke Docker/Terraform, authenticate, run a live
operator command, or write outside normal test temporary directories.

## Control flow and invariants

```text
developer / CI / Docker builder
  -> pinned mise
  -> locked Node + pnpm tools
  -> mise task
  -> pnpm resolves the committed dependency graph or launches a local binary
  -> existing TypeScript/test/build/operator entrypoint
```

Preserve these invariants:

- frozen dependency installation remains mandatory;
- Node stays within `>=24 <25` and the runtime image stays on Node 24;
- aggregate validation includes the vendored-skill integrity check;
- focused test and operator arguments reach the existing executable unchanged;
- no normal task performs a live Drive, gateway, cloud, OAuth, Terraform, or secret operation;
- Docker's final image remains non-root and contains no build-only tooling;
- gateway write guards, revision checks, and no-permanent-deletion policy are untouched.

## Test and validation strategy

Before implementation, rerun the repository-required preflight:

```bash
./scripts/verify-vendored-skills.sh
```

After editing:

```bash
mise --version
mise install --locked
mise run install
CI=true mise run test -- tests/tooling/mise.test.ts tests/deployment/assets.test.ts
CI=true mise run lint
CI=true mise run format:check
CI=true mise run typecheck
CI=true mise run test
CI=true mise run build
CI=true mise run verify:vendored-skills
CI=true mise run check
git diff --check
```

Also verify that a second `mise install --locked` and `mise run install` do not modify either
lockfile. If Docker is available, build the image locally and inspect its user, entrypoint, Node
major, absence of mise/pnpm, and `/healthz` startup behavior. Do not publish or deploy the image.

## Current-tree deviations and risky edges

- The request says to migrate package managers to mise, but the current repository has one actual
  dependency manager, pnpm, plus Corepack as its bootstrapper. The plan therefore consolidates
  tool/version/task management under mise while retaining pnpm's dependency role.
- There is no checked-in CI workflow. This task establishes canonical CI commands in repository
  policy and docs but does not invent a provider-specific pipeline.
- The current `pnpm` shim failed during shaping because Corepack could not create its user cache in
  this restricted environment. This reinforces removal of Corepack but is not a product defect or a
  reason to weaken frozen installs.
- The exact immutable mise container digest and release checksums must be verified against the
  selected 2026.9.1 release during implementation and recorded in the Dockerfile or adjacent
  dependency-update metadata. Do not substitute a floating tag.
- Mise trust handling in Docker must be narrow to the copied project config. Do not use a broad
  trust-all operation if the pinned CLI supports trusting the exact config path.
- `pnpm-workspace.yaml` is easy to misclassify as redundant; its `allowBuilds.esbuild` policy is why
  it remains.
