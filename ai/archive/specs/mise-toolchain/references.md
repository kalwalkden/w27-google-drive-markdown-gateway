# Mise toolchain implementation map

## Primary edit targets

| Path | Target | Why it changes |
| --- | --- | --- |
| `mise.toml` | New project tool and task configuration | Becomes the canonical Node/pnpm version and task authority. No current edit target exists. |
| `mise.lock` | New project tool lockfile | Pins resolved tool artifacts/checksums for reproducible locked installs. No current edit target exists. |
| `package.json` | `packageManager`, `scripts`, `engines`, package metadata | Remove duplicate version/task authority while preserving package/runtime contracts and dependencies. |
| `pnpm-workspace.yaml` | `allowBuilds`, `storeDir` | Preserve the install-script allowlist and keep pnpm state in the already-ignored `.pnpm-store/`. |
| `Dockerfile` | dependency/build stages | Replace Corepack and pnpm-script entrypoints with pinned mise setup and tasks; preserve the final runtime. |
| `.dockerignore` | build-context allowlist | Admit the mise config/lock and `pnpm-workspace.yaml` required by the new build. |
| `.gitignore` | local tool state exclusions | Ignore only machine-local mise state/config while retaining shared config and lockfiles. |
| `tests/deployment/assets.test.ts` | deployment asset contract | Replace exact Corepack/pnpm assertions with mise build and final-image invariants. |
| `tests/tooling/mise.test.ts` | New tooling contract test | Validate the config, task graph, lock enforcement, and absence of competing package task authority. |
| `AGENTS.md` | Validation and architecture summary blocks | Make mise commands authoritative for future planning and implementation agents. |
| `ARCHITECTURE.md` | Detected stack and command inventory | Keep the current architecture report aligned with canonical tooling. |
| `README.md` | CLI build, local setup, validation table | Give contributors one mise-based workflow from a fresh checkout. |
| `docs/cloud-run-deployment.md` | Deployment prerequisites | Replace manual Node/pnpm prerequisites with mise-managed tooling without changing deployment gates. |
| `docs/codex-cloud-client-setup.md` | Build and client harness invocation | Route existing operator behavior through mise. |
| `docs/live-drive-capability-harness.md` | Build and Drive probe invocation | Route the explicitly gated live probe through mise. |
| `docs/planning-file-cutover.md` | Cutover preflight invocation | Route the local-only preflight through mise. |

## Entry point and call path

Normal validation:

```text
CI=true mise run check
  -> lint
  -> format:check
  -> typecheck
  -> test
  -> build
  -> verify:vendored-skills
```

Dependency setup:

```text
mise install --locked
  -> mise.lock selects Node 24.x and config pins npm:pnpm 11.19.0
mise run install
  -> pnpm install --frozen-lockfile
  -> pnpm-lock.yaml + pnpm-workspace.yaml install policy
```

Operator commands remain explicit:

```text
mise run <operator-task> -- <existing arguments>
  -> node dist/<existing CLI entrypoint>.js <existing arguments>
  -> existing confirmation/config/evidence checks
```

Container build:

```text
pinned mise bootstrap
  -> locked tools
  -> frozen pnpm install
  -> mise build task
  -> production prune
  -> copy package.json + node_modules + dist into non-root Node 24 runtime
```

## Contracts, state, and invariants

- `package.json#engines.node` is the runtime compatibility contract and remains `>=24 <25`.
- `pnpm-lock.yaml` is the dependency-resolution source of truth and remains frozen during installs.
- `pnpm-workspace.yaml#allowBuilds.esbuild` is the dependency build-script allowlist.
- `scripts/mark-cli-executable.mjs` is part of the production build and must still make
  `dist/codex-cli/cli.js` executable.
- `scripts/verify-vendored-skills.sh` remains both the pre-planning/pre-implementation check and the
  final aggregate validation stage.
- `tests/deployment/assets.test.ts` protects the narrow Docker context, non-root runtime, and Node 24
  entrypoint.
- Operator CLI implementations own their existing confirmation, bounded input, and external
  evidence behavior. Mise only forwards arguments; it must add no defaults or automatic execution.
- Tool state belongs in mise's external/local cache. Credentials and operator evidence never belong
  in `mise.toml`, `mise.lock`, or repository-local task state.

## Patterns to reuse

- Keep the current fail-fast order from `package.json#scripts.check` when expressing the mise
  aggregate task.
- Keep the current `Dockerfile` manifest-first/source-second copy order for dependency layer caching.
- Keep the current README command table and runbook-specific examples, changing the entrypoint while
  retaining explanatory safety text.
- Mirror production/tooling areas under `tests/`; `tests/deployment/assets.test.ts` is the nearest
  asset-contract pattern for the new mise test.
- Use short TOML tasks for these one-line commands. Do not add executable file tasks unless a command
  grows enough to benefit from a separately linted script.

## Tests and fixtures

- `tests/deployment/assets.test.ts`: revise the first test for mise bootstrap/build and final-image
  exclusions; keep Cloud Run and documentation tests unchanged.
- `tests/tooling/mise.test.ts`: new focused toolchain contract test; use child-process execution of
  the already-required mise binary and JSON output where supported.
- `tests/codex-cloud/docs.test.ts`: inspect after doc changes because it enforces client setup and
  skill wording, though it currently has no pnpm-specific assertion.
- `tests/operations/runbooks.test.ts`: inspect after runbook edits to ensure operational headings and
  evidence constraints remain intact.
- `tests/live-drive/**` and `tests/planning-migration/**`: application behavior should not change;
  these suites validate that task argument forwarding still reaches the same CLIs.

No credential fixture, live Drive folder, cloud environment, Terraform backend, or external evidence
file is needed.

## Expected unchanged boundaries

- `src/**` service, adapter, transport, client, and operator implementation.
- `infra/terraform/**` provider/runtime declarations; Terraform version policy remains
  `>= 1.8.0, < 2.0.0` in `infra/terraform/versions.tf` and is not pulled into routine checks.
- `plugin/**` packaging and live-validation behavior.
- `google-drive-markdown-gateway-handoff.md` as the original product baseline.
- `ai/features/**` as completed planning and implementation history.
- `pnpm-lock.yaml` dependency versions and `pnpm-workspace.yaml` build allowlist.
- Runtime auth, root confinement, guarded writes, revision checking, `OUTCOME_UNKNOWN`
  reconciliation, and archive-without-deletion policies.

## Validation commands

The pre-change authority is `AGENTS.md`, `ARCHITECTURE.md`, and `package.json`. The task replaces
their pnpm task entrypoints with these mise equivalents:

```bash
./scripts/verify-vendored-skills.sh
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

Run a local Docker build and runtime smoke test only when Docker is available. Do not publish,
deploy, authenticate, run Terraform, or invoke any operator task as routine validation.

## External material

The user selected mise as the technology. No external code, template, or configuration was selected
for copying into the repository. Official mise documentation for configuration, task definitions,
locked tools, Node, CI, and Docker was consulted as moving discovery material on 2026-09-06; it is
not repository policy or an immutable implementation input. Before editing, the implementer must
verify syntax and bootstrap artifacts against the pinned mise 2026.9.1 release and record immutable
release checksums or an image digest. Mise is MIT-licensed; no source incorporation or attribution
change is expected.

## Uncertainties to verify

- Confirm the pinned CLI's exact TOML key for minimum mise version and project-scoped locked-tool
  policy before committing `mise.toml`.
- Confirm the explicit `npm:pnpm` declaration exposes a Node-based `pnpm` launcher on every
  supported platform and that it reports Node 24 for the project engine check.
- Confirm structured task references preserve sequential fail-fast behavior and that raw argument
  forwarding accepts the repository's current `-- run ...` operator syntax.
- Resolve and verify the immutable mise 2026.9.1 container artifact digest/checksum for each Docker
  build architecture; do not use a floating tag.
- Confirm the final Docker stage contains neither mise nor pnpm while
  `node dist/runtime/entry.js` and the executable `md-drive` artifact still work.
- Confirm removal of `package.json#scripts` does not affect any unpublished consumer; current-tree
  evidence shows only repository docs, Docker, and historical planning artifacts call them.
