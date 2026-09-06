# TypeScript Service Baseline — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `package.json` | package metadata and scripts | Does not exist. It will declare Node/pnpm/tool dependencies and all product validation commands. |
| `pnpm-lock.yaml` | resolved dependency graph | Does not exist. It will pin the dependency graph selected by `package.json`. |
| `tsconfig.json` | strict no-emit type-check configuration | Does not exist. It will own source/test compiler settings. |
| `tsconfig.build.json` | production emit configuration | Does not exist. It will compile the runtime source to `dist/` while excluding tests. |
| `biome.json` | formatter/linter configuration | Does not exist. It will configure Biome checks and generated-directory exclusions. |
| `src/index.ts` | application factory and optional direct-execution bootstrap | Does not exist. It will be the minimal import-safe Express-ready source entry point. |
| `tests/index.test.ts` | baseline application construction test | Does not exist. It will prove the entry module imports and constructs without credentials or I/O. |
| `ARCHITECTURE.md` | Linting and testing commands | Existing architecture record says tools are unconfigured; update its canonical command section only after the scripts exist. |

## Entry point and call path

No product entry point currently exists. This task introduces this minimal path:

`tests/index.test.ts` → exported application factory in `src/index.ts` → Express application instance

If `src/index.ts` includes direct execution, that path is separate and must only be reached when the compiled module is run as the program:

`node dist/index.js` → direct-execution guard → application factory → listener startup

The test path must not start a listener, invoke external services, or read credentials.

## Contracts, state, and invariants

No domain contracts, schemas, service state, configuration types, or Drive ports exist yet.

- The application factory is the only task-local composition contract; it returns a fresh Express application instance.
- The source root must remain free of Google Drive, Google authentication, gateway bearer/authentication, MCP, and document-operation behavior.
- There are no registered service routes in baseline scope. In particular, do not introduce a health endpoint early; it would be unscoped unauthenticated API behavior.
- The lockfile is committed and is the reproducibility boundary for dependencies.
- Tool commands must be safe without secret configuration or network access, apart from the package installation step resolving the lockfile.

## Patterns to reuse

| Path | Pattern | Applicability |
| --- | --- | --- |
| `scripts/verify-vendored-skills.sh` | Repository-owned, executable setup validation | Reuse unchanged through a package script and as the final aggregate-check step. Do not fold its logic into JavaScript tooling. |
| `AGENTS.md` | Repository policy and validation/security constraints | Binding source for preserving the vendored-skill check and avoiding credentials. |
| `ARCHITECTURE.md` | Canonical architecture and validation-command record | Update its existing commands section when product commands are created. |

There are no current TypeScript, package-management, testing, linting, or runtime examples in the repository.

## Tests and fixtures

| Path | Purpose | Cases |
| --- | --- | --- |
| `tests/index.test.ts` | New Vitest baseline test | Import succeeds; factory returns an Express-compatible application; no credentials, Drive access, network access, or listener startup is required. |
| `scripts/verify-vendored-skills.sh` | Existing setup integrity check | Must continue passing unchanged as part of aggregate validation. |

No fixtures are needed. Introducing credential samples or live integrations is outside this task.

## Expected unchanged boundaries

- `google-drive-markdown-gateway-handoff.md` remains the product baseline, not executable configuration.
- `AGENTS.md`, vendored `.agents/skills/`, and `scripts/verify-vendored-skills.sh` remain unchanged.
- All `ai/features/` feature/task status fields, briefs, and task lists remain unchanged except for this task's new `spec/` package.
- No `src/domain/`, `src/application/`, `src/drive/`, `src/auth/`, `src/http/`, `src/mcp/`, CLI, Docker, Terraform, Google API, or live-harness implementation is added.

## Validation commands

After implementation, the canonical aggregate command is:

```bash
pnpm check
```

Its required exact coverage is, in order:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
./scripts/verify-vendored-skills.sh
```

Authoritative sources: the approved task objective/scope for build, test, and checks; feature constraints for Biome/Vitest/strict TypeScript/pnpm; `AGENTS.md` for the vendored-skill check. Before this task is implemented, the only executable repository validation command is `./scripts/verify-vendored-skills.sh`; `ARCHITECTURE.md` confirms product commands are not yet configured.

## External material

None selected. The approved repository artifacts provide the task's Node 24, pnpm, TypeScript, Biome, Vitest, and Express decisions. The implementation worker should resolve compatible current package releases through pnpm and record them in `pnpm-lock.yaml`; moving documentation is not task policy.

## Uncertainties to verify

- Confirm the generated pnpm lockfile, declared pnpm version, and Node 24 work together in the target implementation runtime.
- Confirm the selected ESM TypeScript compiler settings allow both Vitest imports and execution of the emitted Node build.
- Confirm the chosen Biome configuration checks the intended new files and excludes only generated/dependency output.
- Confirm no user-created uncommitted work appeared before implementation; the current shaping tree had no product files or uncommitted changes.
