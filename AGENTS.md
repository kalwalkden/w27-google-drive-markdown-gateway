# Repository guidance

## Product source

`google-drive-markdown-gateway-handoff.md` is the initial product brief and architecture baseline.
Treat it as input to feature planning, not as an already approved task-level implementation spec.

## Workflow

1. Run `./scripts/verify-vendored-skills.sh` before planning or implementation.
2. Use the repository-scoped skills under `.agents/skills/`; do not depend on user-level skills or
   paths outside this repository.
3. If `ARCHITECTURE.md` does not exist, use `$discover-architecture` before `$architect-feature`.
4. Use `$architect-feature` to record decisions and create a reviewable feature plan. Respect its
   approval gate before creating task briefs.
5. Use `$ship-feature` only with an explicit, approved feature root under `ai/features/` and only in
   a runtime that passes the fresh-subagent and explicit-model-selection checks in
   `docs/codex-cloud-preflight.md`.
6. Preserve the task shaping, implementation, task review, feature review, and archival gates in the
   vendored workflow. Do not collapse them into one undocumented implementation pass.

## Validation

Run the vendored-skill integrity check before planning or implementation:

```bash
./scripts/verify-vendored-skills.sh
```

The canonical project validation is:

```bash
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
CI=true pnpm check
```

`CI=true pnpm check` runs the complete lint, formatting, type-check, test, build, and vendored-skill
validation sequence. Keep `ARCHITECTURE.md` aligned if these commands change.

## Security

- Never commit Google credentials, refresh tokens, service-account keys, OAuth client secrets, or
  gateway bearer credentials.
- Keep Google Drive operations confined to the configured Markdown root.
- Preserve revision-checked updates and the no-permanent-deletion constraint from the handoff.

<!-- discover-architecture:start -->
## Architecture

Full report: `ARCHITECTURE.md`

- Domain policy: `src/domain/markdown.ts`, `src/application/markdown-service.ts`
- Provider boundary: `src/drive/`; production composition: `src/runtime/server.ts`
- External surfaces: `src/http/json-api.ts`, `src/mcp/stateless-mcp.ts`, `src/codex-cli/cli.ts`
- Operator-only workflows: `src/live-drive/`, `src/codex-cloud/`, `src/planning-migration/`
- Lint/format/type-check/test: `CI=true pnpm lint`, `CI=true pnpm format:check`,
  `CI=true pnpm typecheck`, `CI=true pnpm test`
- Full validation: `CI=true pnpm check`
- Keep document rules in `MarkdownService`, compose write authority only in the runtime, and never
  bypass `GuardedDriveWritePort` or automatically retry an `OUTCOME_UNKNOWN` mutation.
<!-- discover-architecture:end -->
