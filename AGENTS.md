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

The current setup check is:

```bash
./scripts/verify-vendored-skills.sh
```

Once the product is scaffolded, record its canonical lint, type-check, and test commands here and in
the repository architecture documentation.

## Security

- Never commit Google credentials, refresh tokens, service-account keys, OAuth client secrets, or
  gateway bearer credentials.
- Keep Google Drive operations confined to the configured Markdown root.
- Preserve revision-checked updates and the no-permanent-deletion constraint from the handoff.
