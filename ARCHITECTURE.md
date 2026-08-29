# Architecture

## Detected stack

- Selected product stack: strict TypeScript on Node 24 with pnpm. The first implementation task will
  add the product manifest and production source tree.
- Selected service libraries: Express, the official TypeScript MCP SDK, `googleapis`,
  `google-auth-library`, Zod, and Pino.
- Selected validation toolchain: Biome, TypeScript, and Vitest.
- Current executable support code: Bash and Python 3 in
  `scripts/verify-vendored-skills.sh` and
  `.agents/skills/archive-work-artifact/scripts/archive_work_artifact.py`.
- Deployment target: one stateless Google Cloud Run service built with Docker and provisioned with
  Terraform; no deployment configuration exists yet.
- External boundaries: Google Drive API, a stateless Streamable HTTP MCP interface for ChatGPT Work
  and Codex cloud, and a small JSON HTTPS/diagnostics CLI fallback.

## Conventions

- Repository guidance lives in `AGENTS.md`.
- Product scope and initial safety constraints live in
  `google-drive-markdown-gateway-handoff.md`.
- Codex workflow skills are checked in under `.agents/skills/` and verified without machine-local
  symlinks.
- Cloud setup guidance lives in `docs/codex-cloud-preflight.md`.
- The approved seven-feature implementation program lives under
  `ai/features/epics/google-drive-markdown-gateway/`.
- Product formatting, linting, type-checking, and test configuration will land in the first task.

## Linting and testing commands

- Setup integrity and vendored helper tests: `./scripts/verify-vendored-skills.sh`, defined by
  `scripts/verify-vendored-skills.sh` and required by `AGENTS.md`.
- Product lint/format: not configured.
- Product type-check: not configured.
- Product tests: not configured.

## Project structure hotspots

- Product entry points: none yet.
- Approved boundaries: pure domain contracts, one `MarkdownService` application boundary, a Drive
  port/Google adapter, authentication/configuration, JSON and MCP transports, diagnostics CLI, and
  observability. These are specified but not implemented yet.
- Dependency centrality: not measurable without production modules or imports.
- Change-risk hotspots: not applicable. The full repository history through `a23f121` contains only
  the handoff, vendored skills, and preflight documentation.
- Orchestration hubs: none in product code. `scripts/verify-vendored-skills.sh` only validates the
  repository workflow setup.

## Analysis coverage and limitations

- Covered the complete tracked repository tree, root instructions, handoff, setup script, and Git
  history through `a23f121`.
- Reveal 0.122.0 was installed and its local agent help was inspected. No adapter was queried because
  the repository has no meaningful production source root; Reveal contributed no structural claims.
- Dependency graphs, call relationships, cycles, churn-plus-complexity rankings, and runtime flows
  cannot be quantified until product code exists.
- No TypeScript analyzer coverage exists yet because the product source tree has not been created.
- `README.md` does not yet point to this report; adding that pointer is a follow-up for a later
  repository documentation change.

## Do and don't patterns

- Do keep durable workflow and security guidance in checked-in files (`AGENTS.md`,
  `google-drive-markdown-gateway-handoff.md`).
- Do keep reusable Codex skills repository-scoped and free of machine-local paths
  (`.agents/skills/`, `scripts/verify-vendored-skills.sh`).
- Do keep credentials out of the repository (`AGENTS.md`,
  `google-drive-markdown-gateway-handoff.md`).
- Don't treat the handoff's proposed directories or adapters as implemented architecture
  (`google-drive-markdown-gateway-handoff.md`).
- Don't assume local-only files are available to Codex cloud (`docs/codex-cloud-preflight.md`).

## Open questions

None. Live Google Drive and client-platform capability results remain explicit deployment gates, not
unresolved implementation choices.

## Deep-dive references

None yet. Once implementation exists, the best initial candidates are the request-to-Drive
read/update flow, folder-boundary resolution, and authentication/principal mapping.
