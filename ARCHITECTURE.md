# Architecture

## Detected stack

- Runtime: strict TypeScript 5.9 compiled to ESM for Node 24, with mise managing the Node 24 and
  pnpm 11 toolchain (`mise.toml`, `mise.lock`, `package.json`, `tsconfig.json`,
  `tsconfig.build.json`). Local imports use `.js` extensions so the
  emitted NodeNext modules run without a loader.
- Service: Express 5 exposes a JSON API and stateless Streamable HTTP MCP; Zod validates every
  configuration and transport boundary, `jose` verifies Work JWTs, and Pino emits allowlisted audit
  records (`src/runtime/server.ts`, `src/http/json-api.ts`, `src/mcp/stateless-mcp.ts`,
  `src/auth/principal-verifier.ts`, `src/observability/audit.ts`).
- Provider: `googleapis` and `google-auth-library` support Shared Drive ADC and My Drive refresh-token
  modes behind Drive ports (`src/drive/`).
- Clients and operator tooling: the `md-drive` JSON CLI, a Codex cloud release harness, an opt-in live
  Drive capability probe, and deterministic planning-file migration/preflight CLIs (`src/codex-cli/`,
  `src/codex-cloud/`, `src/live-drive/`, `src/planning-migration/`).
- Delivery: a multi-stage non-root Docker image runs the stateless service on port 8080; Terraform
  provisions Artifact Registry, Cloud Run, its runtime identity, secret mounts, and guarded IAM
  (`Dockerfile`, `infra/terraform/`).
- Quality: Biome 2, TypeScript strict checking, and Vitest 3 (`biome.json`, `package.json`).

## Runtime shape and boundaries

```text
ChatGPT Work -- JWT ----> /mcp ------------------\
                                                   > MarkdownService --> DriveReadPort
Codex / md-drive -- bearer --> /v1/markdown/* ----/         |                 |
                                                            |                 +--> Google Drive
deployment config + mounted secrets --> runtime composition  +--> guarded write capability
```

- `src/runtime/entry.ts` is the production process entry point. `src/runtime/server.ts` parses
  deployment-owned configuration, creates Drive/auth dependencies, and mounts both transports on
  one Express app. Write capability is composed only when `write.enabled` is true.
- `src/domain/markdown.ts` owns branded IDs/revisions, path/content validation, public result types,
  and the closed domain error vocabulary. It has no outward imports.
- `src/application/markdown-service.ts` is the sole business-policy boundary. It resolves paths or
  opaque IDs inside the configured root, enforces traversal/content/response budgets, verifies
  topology snapshots, and performs revision-checked create, update, and archive operations.
- `src/drive/drive-port.ts` defines provider-neutral read sessions and conditional write outcomes.
  `src/drive/google-drive-read-adapter.ts` and `src/drive/google-drive-write-adapter.ts` translate
  those contracts to Google Drive; `src/drive/in-memory-drive-port.ts` is the deterministic test
  implementation.
- `src/drive/guarded-drive-write-port.ts` is the write-authority seam. Its module-private state keeps
  raw mutation methods out of service and transport dependencies; the default capability is
  disabled.
- `src/http/json-api.ts` and `src/mcp/stateless-mcp.ts` authenticate, validate, bound, audit, and map
  transport input/output. They delegate document decisions to `MarkdownService`; neither should
  implement Drive traversal or mutation policy.
- `src/codex-cli/cli.ts` is the installed `md-drive` entry point. The live probe, release harness,
  and migration tools are separate operator workflows and are not imported by the production
  server.

## Conventions

- Prefer small dependency-injected interfaces and constructor/function seams over global state;
  production composition belongs in `src/runtime/server.ts`.
- Fail closed at every boundary: strict Zod objects, bounded UTF-8/JSON sizes, finite traversal and
  provider-work budgets, exact routes, fixed public errors, and no credential-bearing diagnostics.
- Keep root/archive confinement and revision/topology checks in the application/Drive boundary.
  Provider responses are untrusted until normalized and revalidated.
- Treat `OUTCOME_UNKNOWN` as a reconciliation state. Clients reread; they do not blindly retry a
  mutation. Archive is a Drive move, never permanent deletion.
- Mirror production areas under `tests/`; use injected fakes or `InMemoryDrivePort` for normal tests.
  Live Drive, cloud, client, and migration evidence workflows require explicit confirmation and
  write outside the repository.
- Keep deployment inputs non-secret and operator-owned. Credentials enter only through ADC or
  mounted files; neither Terraform variables nor repository configuration contain secret payloads
  (`docs/cloud-run-deployment.md`, `docs/threat-model.md`).
- Planning history and feature decisions live under `ai/features/epics/google-drive-markdown-gateway/`;
  operational contracts and runbooks live under `docs/`.

## Linting, testing, and operational commands

- Tool and dependency setup: `mise install` followed by `mise run install`
- Lint: `CI=true mise run lint`
- Formatting check: `CI=true mise run format:check`; deliberate rewrite: `mise run format`
- Type-check: `CI=true mise run typecheck`
- Unit/integration tests: `CI=true mise run test`
- Production build: `CI=true mise run build`
- Complete repository validation: `CI=true mise run check` (also verifies the ten vendored workflow
  skills)
- Vendored-skill integrity only: `./scripts/verify-vendored-skills.sh`
- Built operator tools: `mise run codex-cloud:harness`, `mise run drive:probe`,
  `mise run migration:plan`, and `mise run migration:cutover-preflight`; use only with their
  corresponding `docs/` runbook and required
  external configuration/evidence paths.
- Terraform validation is operator-scoped: from `infra/terraform/`, run `terraform fmt -check` and
  `terraform validate` after `terraform init`; plans/applies require the approvals documented in
  `docs/cloud-run-deployment.md`.

## Project structure hotspots

### Entry points and architectural boundaries

| Area | Role | Change implication |
| --- | --- | --- |
| `src/runtime/entry.ts`, `src/runtime/server.ts` | Production startup and dependency composition | New production capabilities must be explicitly wired here and remain safe when disabled. |
| `src/http/json-api.ts` | Health plus six JSON endpoints | Preserve authentication, admission controls, error mapping, and audit completion on every path. |
| `src/mcp/stateless-mcp.ts` | Exact `/mcp` route plus six MCP tools | Keep schemas and error envelopes aligned with JSON semantics and MCP SDK constraints. |
| `src/codex-cli/cli.ts` | Installed `md-drive` executable | Output is a bounded machine-readable protocol; exit codes and recovery hints are compatibility surface. |
| `src/application/markdown-service.ts` | Domain orchestration | Document behavior changes belong here, not in transports or Google-specific adapters. |
| `src/drive/drive-port.ts` | Provider boundary | Contract changes affect the service, both Drive adapters, tests, and runtime composition. |

### Dependency centrality

Static TypeScript import analysis over `src/` found no cycles. The most load-bearing modules are
`src/domain/markdown.ts` (fan-in 12), `src/config/service-config.ts` and
`src/auth/principal.ts` (6 each), `src/drive/drive-port.ts` (5), and
`src/drive/provider-error.ts` (4). The widest importers are `src/runtime/server.ts` and
`src/mcp/stateless-mcp.ts` (fan-out 13 each) and `src/http/json-api.ts` (11), which confirms that
composition and transports depend inward on shared contracts rather than the reverse.

### Change-risk hotspots

The history window is the 70 commits after `a23f121` through `cd55e64` (2026-08-28 to 2026-08-29).
“Touches” means commits naming the current file; complexity is Reveal's TypeScript AST cyclomatic
metric, not a line-count heuristic.

| File | Touches | Highest observed function complexity | Why it matters |
| --- | ---: | ---: | --- |
| `src/application/markdown-service.ts` | 13 | 20 (`searchMarkdown`) | Highest churn, 1,379 lines, and the root-confinement/revision policy center. |
| `src/drive/google-drive-read-adapter.ts` | 10 | 20 (`openReadSession`) | Provider pagination, metadata budgets, and topology evidence meet here. |
| `src/http/json-api.ts` | 8 | 41 (`createJsonApiApp`) | Large transport orchestrator with auth, limits, deadlines, metrics, and six operations. |
| `src/mcp/stateless-mcp.ts` | 7 | 27 (`publicToolError`) | MCP schema publication, SDK response capture, and parity with JSON semantics. |
| `src/codex-cloud/harness.ts` | 7 | 39 (`runHarness`) | Release-evidence state machine; isolated from runtime but sensitive to CLI protocol changes. |

`src/live-drive/probe.ts` has the highest single-function complexity (62 in
`runLiveDriveCapabilityProbe`) but only two touches in this window and no production-server import.
Treat it as an isolated operator-tool refactoring candidate, not the same risk class as the
high-churn request path.

### Orchestration hubs

- `composeRuntime` (`src/runtime/server.ts`) selects auth mode and write authority, then joins the
  Drive adapters, service, verifier, telemetry, JSON API, and MCP transport.
- `MarkdownService` (`src/application/markdown-service.ts`) coordinates bounded read snapshots and
  guarded mutations across provider calls.
- `createJsonApiApp` and `createStatelessMcpApp` own request lifecycle orchestration for their
  protocols; duplicated public-error semantics are a deliberate parity obligation.
- `runHarness` (`src/codex-cloud/harness.ts`) and `runLiveDriveCapabilityProbe`
  (`src/live-drive/probe.ts`) coordinate destructive-capability checks and sanitized evidence, but
  remain outside normal service startup.

## Analysis coverage and limitations

- Inspected all 36 current `src/` files, 29 mirrored test files, root configuration, Docker and
  Terraform assets, operator/client packaging, `docs/`, feature artifacts, and Git history through
  `cd55e64`.
- Reveal 0.122.0 identified TypeScript as tier-1 verified. Its `imports`, `hotspots`, `architecture`,
  and `surface` adapters were checked against known source files before use. A direct `src/` import
  query found zero static cycles; dynamic dispatch and runtime dependency injection are outside that
  claim.
- Hotspot complexity is structural, not proof of defects. Churn covers a short, implementation-heavy
  one-day history, so it predicts near-term coordination cost better than long-term incident risk.
- The Vitest suite mirrors every major production boundary, but no coverage provider or threshold is
  configured; file adjacency and test names are not a coverage percentage.
- No network, credential, live Drive, cloud, or Terraform-provider action was performed for this
  report. Those remain explicitly gated operator workflows.
- `README.md` and `AGENTS.md` link to this report. The other root product document,
  `google-drive-markdown-gateway-handoff.md`, remains the original architecture baseline and does not
  link back to the current report.

## Do and don't patterns

- Do put shared vocabulary and invariants in `src/domain/markdown.ts`; keep it provider- and
  transport-free.
- Do add document behavior through `MarkdownService` and a port contract, then adapt JSON, MCP, and
  CLI surfaces consistently.
- Do compose write authority only in the deployment-controlled runtime branch and test the disabled
  branch first.
- Do preserve bounded provider work, stable topology checks, closed telemetry labels, and sanitized
  external evidence.
- Don't pass a raw Drive writer to application or transport code, bypass `GuardedDriveWritePort`, or
  infer root membership from a caller-supplied file ID.
- Don't retry `CONFLICT` or `OUTCOME_UNKNOWN` mutations automatically, permanently delete Drive
  content, or make normal tests depend on live services.
- Don't add credentials, live evidence, generated `dist/`, Terraform state, or operator-specific
  configuration to source control.

## Open questions

None currently alter the implemented module boundaries. Live Drive semantics, Cloud Run/IAM
configuration, ChatGPT Work packaging, Codex cloud installation, and planning-file cutover remain
release gates with evidence procedures, not unresolved code-architecture choices.

## Deep-dive references

No `trace-domain-flow` deep dive exists yet. The best candidates are:

1. Authenticated JSON/MCP read through root-confined topology verification to Google Drive.
2. Revision-checked update/archive through guarded write authority and `OUTCOME_UNKNOWN`
   reconciliation.
3. Planning-file cutover from manifest digest verification through external release evidence.
