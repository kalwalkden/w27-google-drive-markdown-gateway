# Cloud Run Container and Infrastructure — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `src/runtime/` (new) | explicit server bootstrap and bounded deployment-config loader | Converts deployment-owned non-secret config and mounted secret references into the existing read-only service/API composition, then starts the listener. |
| `src/index.ts` | task-002 exported HTTP factory | Runtime consumes its final public factory; it must not recreate routes, auth middleware, limiters, errors, or audit events. |
| `src/config/service-config.ts` | `parseServiceConfig`, final `http` type | Keeps strict configuration ownership. Reuse after task 002 adds transport limits; do not move environment/file I/O into this import-safe module. |
| `src/auth/principal-verifier.ts` | `createPrincipalVerifier` | Runtime creates the configured verifier; Codex secret rotation remains its per-request mounted-file reader behaviour. |
| `src/application/markdown-service.ts` | `MarkdownService` constructor | Compose its existing read operations with the default `DisabledDriveWritePort`; never open a write session in deployment code. |
| `src/drive/google-drive-auth.ts` | `GoogleDriveAuthConfig`, `createGoogleDriveAuth` | Selects attached-identity ADC versus parsed mounted My Drive OAuth credentials behind the existing Google seam. |
| `src/drive/google-drive-read-adapter.ts` | `GoogleDriveReadAdapter` | Supplies the existing root-confined read port. The bootstrap configures it from typed Drive config only. |
| `Dockerfile` / `.dockerignore` (new) | Node 24 production image | Defines reproducible locked build, compiled exec entry point, non-root runtime, and safe build context. |
| `infra/terraform/` (new) | Artifact Registry, dedicated service account, Cloud Run v2, secret IAM/mounts, variables | Captures repeatable, least-privilege deployment references without secret values or automatic apply. |
| `docs/cloud-run-deployment.md` (new) | operator setup, rotation, rollout, rollback | Makes the production gate and out-of-band Drive permission steps explicit without committing secrets. |
| `tests/runtime/` / `tests/deployment/` (new) | fake bootstrap and static asset checks | Proves composition/policy without Docker, Terraform cloud APIs, Drive, OAuth, JWKS, or secret files. |

Recheck all targets immediately before implementation: task 002 is concurrently changing the HTTP
factory and `ServiceConfig` shape. There are no container/infra files in the current tree, so their
exact filenames are deliberately an implementation choice within the listed boundaries.

## Entry point and call path

```text
Cloud Run container command
  -> compiled explicit runtime entry point
  -> bounded non-secret config JSON -> parseServiceConfig
  -> Drive auth selection
       shared-drive-adc -> attached dedicated Cloud Run service account / ADC
       my-drive-refresh-token -> bounded mounted OAuth secret parsing
  -> GoogleDriveReadAdapter -> MarkdownService (default disabled writer)
  -> PrincipalVerifier -> task-002 JSON API factory -> Express listener on PORT
```

The deployment layer is intentionally not a write-authority path:

```text
HTTP principal or Terraform variable
  -/-> WriteGate.evaluate
  -/-> WriteLease
  -/-> MarkdownService.openWriteSession
  -/-> GoogleDriveWriteAdapter mutation
```

Cloud Run `/healthz` starts through the app's health endpoint but bypasses the Drive/auth/session
path. Startup health means only that the process was composed and is listening.

## Contracts, state, and invariants

- `ServiceConfig` (`src/config/service-config.ts`) is a strict caller-supplied non-secret object.
  Runtime config must supply valid `drive`, `authentication`, and final task-002 `http` fields but
  must never include a bearer, OAuth JSON, access token, key, or private credential.
- `SecretFileReference` is an absolute mounted-file reference, not a readable value in Terraform
  output/log/audit contracts. Codex is always a mount; My Drive OAuth is a mount only in that mode.
- `AuthenticatedPrincipal` remains exactly `{ kind, subject, issuer }`. Runtime code passes raw
  authorization processing only through `PrincipalVerifier`, not an environment/default principal.
- `MarkdownService` owns Drive path/Markdown/revision/root policy. It is supplied a
  `GoogleDriveReadAdapter` and default disabled writer. `MarkdownWriteSession` and `WriteLease`
  remain outside container infrastructure.
- `GoogleDriveReadAdapter`/`GoogleDriveAuthConfig` distinguish `shared-drive-adc` and
  `my-drive-refresh-token`; service configuration's `rootFolderId`, `archiveFolderId`, byte and
  traversal bounds map to their existing constructor options.
- Task 002 owns the `/healthz` response, protected operation schemas, rate limits, deadline,
  response envelopes, HTTP statuses, and Pino audit events. Infrastructure may set container
  timeout/concurrency but must not alter those semantics.
- Terraform secrets are existing Secret Manager object references. Runtime service account access is
  resource-scoped to those objects; no secret payload, service-account key, token, or `allUsers`
  binding is created by default.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/config/service-config.ts` | strict Zod parser, no I/O at import/parse time | Keep config validation separate from runtime reading; use its typed mode discriminator rather than raw environment branching. |
| `src/auth/principal-verifier.ts` | injected secret/JWT dependencies and stable failure collapse | Let the existing verifier own credentials. Do not cache/print the mounted Codex secret in bootstrap code. |
| `src/drive/google-drive-auth.ts` | authentication factory performs no immediate token acquisition | Use it behind runtime composition; never prove configuration by a startup Drive request. |
| `src/drive/google-drive-read-adapter.ts` | provider boundary and root-confinement contract | Construct only the read adapter with configured bounds. Do not duplicate folder validation in Terraform or runtime. |
| `src/application/markdown-service.ts` | default-deny writer and application-owned policy | Preserve the no-write default when composing the production process. |
| `src/live-drive/config.ts` | explicit bounded local secret parsing techniques | It is supporting evidence only. Do not import its local owner/mode/no-symlink rules into Cloud Run mounted-secret handling. |
| `tests/auth/import-safety.test.ts` | import-only side-effect assertion | Mirror it for runtime bootstrap modules; imports must not listen/read env/files/contact providers. |
| `scripts/verify-vendored-skills.sh` | repository integrity validation | Keep deployment additions compatible with the required aggregate check. |

## Tests and fixtures

Use only injected or static local test material:

- fake environment/file/listener/adapter/auth/API factories with call counters to prove bootstrap
  sequencing and no Drive call on startup/health;
- generated in-memory non-secret config values and opaque placeholder secret *paths* only;
- textual/static assertions over Docker and Terraform source that look for positive safety controls
  and reject `secret_data`, service-account-key resources, secret outputs, `allUsers` outside the
  explicit gate, and root final image execution;
- tests proving ADC does not ask for an OAuth file and My Drive does not instantiate ADC before its
  bounded OAuth loader succeeds;
- documentation tests or manual review checklist using non-credential sentinel text.

No fixture may contain an OAuth client secret, refresh token, bearer token, JWK/private key,
service-account JSON, mounted Secret Manager value, real project/Drive identifier, or live URL. Do
not run Docker, Terraform initialization/apply, `gcloud`, the Drive probe, a remote issuer/JWKS, or
any Google API in normal tests.

## Expected unchanged boundaries

- `src/domain/**`, `src/application/markdown-service.ts` document policy, `src/drive/**` adapter
  protocol, and `src/write-gate/**` capability policy remain unchanged except for wiring their
  existing public read/default-deny surfaces. In particular, no deployment code evaluates a gate or
  creates a lease/session.
- `src/live-drive/**`, its tests, test evidence, and live-probe documents remain isolated. This
  task does not run or alter the capability harness.
- The task-002 HTTP contract and audit schema stay owned by task 002. Docker/Terraform must not add
  extra routes, logging of config/secrets, or a transport-level authentication fallback.
- MCP, ChatGPT Work plugin packaging, Codex CLI/skill, CI provider, custom domain, broad network
  policy, production rollout, secret payload creation, and automatic Drive ACL management remain
  out of scope for later features/operator action.

## Validation commands

Authoritative project validation comes from `package.json`, `ARCHITECTURE.md`, and `AGENTS.md`:

```bash
CI=true pnpm test -- tests/runtime
CI=true pnpm test -- tests/deployment
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

`CI=true pnpm check` is the canonical aggregate check. When tooling is installed and configured
locally without authenticating or contacting cloud services, the implementation may additionally
run `terraform -chdir=infra/terraform fmt -check` and `terraform -chdir=infra/terraform validate`.
Docker build/run and all Terraform apply/deployment actions are operator-only validations, not
routine test commands.

## Selected external material

None. The binding inputs are the repository handoff, task brief, and existing source contracts.
Before implementation, use the installed Terraform binary/provider schema and Docker/Node 24 image
documentation only if they are explicitly selected and version-pinned in the resulting assets; do
not turn a moving web page into repository policy.

## Uncertainties to verify

- Re-read task 002's final `createJsonApiApp` export, its dependency-injection shape, and the exact
  `ServiceConfig.http` schema before adding bootstrap code. Keep any adapter between them thin and
  tested.
- Confirm the locally selected Google provider version supports the exact Cloud Run v2 secret-volume
  and startup-probe syntax before writing Terraform. Pin it in `infra/terraform/.terraform.lock.hcl`
  if initialization is available without a live deployment.
- Confirm the final compiled runtime filename from `tsconfig.build.json` before writing Docker's
  exec-form `CMD`. The startup module must be part of `src/` and therefore emitted under `dist/`.
- If organization policy forbids `allUsers` Cloud Run invocation, keep the default false and obtain
  the separate approved ingress/identity design rather than weakening application authentication or
  silently changing the task scope.
