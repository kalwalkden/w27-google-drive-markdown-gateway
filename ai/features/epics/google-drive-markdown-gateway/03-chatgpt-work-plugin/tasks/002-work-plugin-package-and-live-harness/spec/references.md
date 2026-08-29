# Work Plugin Package and Live Harness — References

## Primary edit targets

No plugin/package asset exists in the current tree. Names below are the intended isolated surface;
verify the exact private Work artifact format with the operator before creating it.

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `plugin/chatgpt-work/` (new) | secret-free private-package metadata/template, concise instructions, operator README | Keeps Work-specific registration artifacts isolated from gateway/application code and tenant values. Use a different canonical directory only if current platform requirements demand it. |
| `plugin/chatgpt-work/README.md` (new) | private install and operator input runbook | Identifies required outside-Git inputs, exact deployment/config matching, safe package handling, current-platform verification, and cleanup. |
| `plugin/chatgpt-work/instructions.md` (new) | Work agent/server instruction artifact | Holds read-before-write, revision/conflict, and archive-confirmation guidance. |
| `plugin/chatgpt-work/*example*` (new, exact format TBD) | closed metadata/config template and synthetic fixtures | Encodes only the current platform's verified package/discovery format and obvious placeholders; never a live tenant config. |
| `docs/client-validation-record.example.json` | ChatGPT Work release-evidence template | Reuse/extend only if necessary for sanitized six-operation, conflict, observed approval, and cleanup evidence. It remains non-authoritative for writes. |
| `docs/write-gate-and-client-validation.md` | release-evidence and no-secret policy | Reuse its Work record rules and explicit separation between validation evidence and `WriteGateDecision`. |
| `tests/plugin/` (new) | static package/template/instruction/checklist tests | Proves consistency and redaction using fakes/static fixtures, without platform/network access. |
| `package.json` / `pnpm-lock.yaml` | only if a small static parser is needed | Add a dependency only after the verified Work artifact format requires it; do not add an SDK or client solely to automate live Work validation. |

## Entry point and call path

```text
operator-owned Work tenant inputs + deployment-owned ServiceConfig
  -> private Work plugin registration (current supported format)
  -> deployed HTTPS stateless MCP origin from task 001
  -> PrincipalVerifier.verify(Authorization)
  -> normalized work-mcp principal only
  -> task-001 tool dispatch
  -> shared MarkdownService read call
     or pre-opened MarkdownWriteSession mutation call

operator-owned fresh Work session
  -> six operations + stale-revision conflict checklist
  -> sanitized release record / archive cleanup observation
```

## Contracts, state, and invariants

- `ServiceConfig.authentication.workMcp` in `src/config/service-config.ts` owns deployment values
  for issuer, audience, JWKS URL, allowed algorithms, and JWKS verification bounds. The plugin
  package may describe them as operator inputs but cannot supply defaults or load secrets.
- `PrincipalVerifier` in `src/auth/principal.ts` and `src/auth/principal-verifier.ts` is the sole
  Work JWT normalization boundary. A successful Work request becomes only `{ kind: "work-mcp",
  subject, issuer }`; plugin artifacts must not decode claims or establish another identity path.
- Task 001 owns six exact MCP operations: `list_markdown`, `search_markdown`, `read_markdown`,
  `create_markdown`, `update_markdown`, and `archive_markdown`. It delegates to shared service and
  pre-opened write-session contracts, not a Drive client.
- `MarkdownWriteSession` is injected only after the write gate has issued a private lease.
  `WriteLease`, evidence, approval JWS, and trust values are never tool/package fields or validation
  record material. No session means mutations are expected to be unavailable/denied.
- `docs/client-validation-record.example.json` is a sanitised release-evidence template. Work
  fields are identifiers only and its `writeApprovalCheck` must report observed behavior, not an
  assumed prompt or authorization. It never feeds `WriteGateDecision`.
- `archive_markdown` moves a revision-matched Markdown file into the archive; no package/test flow
  may create permanent deletion/trash/sharing capability.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/config/service-config.ts` | strict, deployment-owned config with validated HTTPS secret-free references | Keep Work issuer/audience/JWKS inputs outside plugin examples; validate only format-safe non-secret template values after the platform format is known. |
| `src/auth/principal-verifier.ts` | deferred JWT/JWKS work and generic authentication failure | Package guidance must use the configured server-side verifier and never log/probe tokens or issuer internals. |
| `src/http/json-api.ts` | default-disabled `WriteSessionProvider`, strict inputs, safe error behavior | Explain that writes may be unavailable without an authorized session; do not make private installation a write bypass. |
| `src/observability/audit.ts` | allowlisted audit payloads and redaction | Static tests and runbook use minimal identifiers/outcomes, never raw protocol transcript/request objects. |
| `docs/live-drive-capability-harness.md` | explicit opt-in dedicated-fixture cleanup with no delete/trash | Mirror operator ownership and bounded archival cleanup; do not invoke its live probe from this task. |
| `docs/write-gate-and-client-validation.md` | current Work record requirements and deployment-owned authority | Reuse its evidence fields/no-secret rule and distinction between client checks and write authority. |
| `tests/http/json-api.test.ts` | injected fakes, sentinel redaction assertions, no external calls | Use static fixtures/sentinels to test package instructions, templates, and record schemas. |

## Tests and fixtures

- `tests/plugin/*.test.ts` (new): static template/metadata shape, placeholder-only values, exact
  six-tool reference, instruction requirements, release-record/checklist coverage, and forbidden
  data redaction checks.
- Use synthetic identifiers such as `example-*`, `.invalid` URLs, fake revisions, and sentinel
  secret/content/token/path values. Assert all sentinels are absent from committed template output,
  error messages, and recorded examples.
- Test only a selected, versioned Work package format once the operator has verified it. Until then,
  do not hand-roll a speculative manifest parser or encode a moving public documentation example as
  repository policy.
- Never run a live Work install, Work session, MCP origin, Drive operation, OAuth/JWKS request,
  credential lookup, `pnpm drive:probe`, or cloud test in unit/static validation.

## Expected unchanged boundaries

- All gateway domain/application/Drive rules: `src/domain/**`, `src/application/**`, `src/drive/**`.
- Auth semantics and secrets: `src/auth/**`, deployment configuration delivery, and `workMcp`
  runtime values.
- Write-gate evidence, approval, trust, lease, and replay behavior: `src/write-gate/**`.
- Raw Drive capability probe and its live evidence: `src/live-drive/**`, `tests/live-drive/**`,
  `docs/live-drive-capability-harness.md`, and `pnpm drive:probe`.
- Core MCP adapter/protocol behavior from task 001 except a final, necessary package-reference seam.
- Cloud Run/Terraform/listener, Work tenant administration, public marketplace publication, Codex
  cloud client, external credentials/configuration/evidence, feature/task statuses, build logs, and
  concurrent working-tree edits.

## Validation commands

Authoritative commands are from `package.json`, `ARCHITECTURE.md`, and `AGENTS.md`:

```bash
CI=true pnpm test -- tests/plugin
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

The Work private-install/fresh-session harness is a manual operator release gate after deployment.
It is never part of tests, build, `pnpm check`, or any automated setup script.

## Selected external material

None. The handoff names OpenAI learning references but explicitly says the relevant product surfaces
can change. This shaping pass made no network call and did not promote a moving platform example to
repository policy. The operator must select and record the current tenant-supported package/auth
format before implementation.

## Uncertainties to verify

- Exact current Work tenant private-plugin discovery/metadata envelope, artifact name/location,
  remote MCP endpoint requirements, and any allowed origin/header constraints.
- Exact issuer, audience, redirect URI, JWKS/key identifier, supported algorithms, required claims,
  scoped principal, and deployment-to-tenant configuration mapping. All are operator inputs, not
  source defaults.
- Final task-001 MCP route/SDK/export contract and whether its existing tool annotations render in
  the target tenant without adding server state.
- Actual write-approval behavior in a fresh Work session with the exact package/deployment. Record
  the observed outcome; do not infer it from tool annotations, tenant settings, or absent UI.
- Dedicated test-fixture/archive ownership and cleanup completion before accepting a live validation
  record.
