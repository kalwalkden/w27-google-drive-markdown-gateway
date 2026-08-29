# Cloud Run Container and Infrastructure — Implementation Plan

## Scope

Package the authenticated JSON service as a repeatable Cloud Run deployment. Add a Node 24
non-root production image, a narrow runtime bootstrap, Terraform for Artifact Registry, the Cloud
Run v2 service, its dedicated runtime identity, and per-secret Secret Manager access, plus operator
documentation and fake/static deployment checks.

The service remains read-only by default. This task must compose the existing read adapter and the
task-002 HTTP factory, but it must not invent a write authority, create a `WriteLease`, evaluate a
`WriteGate`, add MCP/plugin/client work, create secret payloads, or apply infrastructure. It must
not make a live Drive, OAuth, JWKS, Secret Manager, Artifact Registry, or Cloud Run call while
implementing or testing.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| Cloud Run is the one service deployment target. | Provision one regional Cloud Run v2 service and publish the container port expected by Cloud Run. Do not introduce a VM, GKE, or a second control plane. | Handoff architecture baseline; task brief. |
| Runtime is Node 24. | Use the repository's Node `>=24 <25` contract in both build and runtime stages; the container starts the compiled server, never a development watcher or TypeScript runner. | `package.json`; task brief. |
| The container must run as non-root and contain only production runtime material. | Use a multi-stage Docker build, production dependencies and `dist/` only in the final image, an unprivileged user, read-only-friendly application paths, no credential copy, and no shell-based startup. | Task brief; `AGENTS.md` security requirements. |
| `/healthz` is the deterministic process health endpoint. | The runtime listener exposes task 002's unauthenticated health route on `$PORT` (Cloud Run default 8080). Configure a Cloud Run startup probe to that route. It proves the application was composed, not live Drive reachability. | Task 002 spec; handoff health-check requirement. |
| Service configuration is typed, non-secret, and parsed before listening. | Add a narrow runtime composition/bootstrap that reads bounded deployment configuration, parses it with `parseServiceConfig`, creates the Drive/auth/API dependencies, and fails closed before binding a port. Do not add an import-time environment reader. | Task 001 plan and contracts; task 002 API factory. |
| Configuration does not carry credential values. | Terraform supplies only non-secret values and mounted file paths. The runtime receives Codex/OAuth credentials only by Secret Manager volume mount paths already represented by `SecretFileReference`; no `*_TOKEN`, key, or JSON secret value is an environment variable, Terraform variable default, output, test fixture, image layer, or log field. | Task brief; handoff Google/client auth sections; `AGENTS.md`. |
| Shared Drive and My Drive use distinct server-side Google authentication. | For `shared-drive-adc`, attach the dedicated Cloud Run service account and create no service-account key or OAuth mount. For `my-drive-refresh-token`, mount an existing OAuth credential secret and load it only after config parsing during process composition; credential rotation is completed by a controlled Cloud Run revision restart without rebuilding the image. | Handoff Google authentication decision; task 001 `ServiceConfig`; task brief. |
| Codex bearer rotation must not require application-image redeployment. | Always mount the existing Codex bearer secret at the configured path. Keep task 001's per-verification file read; Secret Manager volume `latest` rotation may be observed by the mount without embedding/caching the bearer in deployment configuration. | Handoff client authentication; task 001 plan; task brief. |
| Google and client credentials remain independent. | Grant the runtime service account `roles/secretmanager.secretAccessor` only on the named Codex secret and, in My Drive mode, the named OAuth secret. Do not put a Drive credential in the Codex secret or forward a gateway bearer to Google. | Handoff; task 001 plan; task brief. |
| Drive access is least privilege and folder-confined. | The runtime service account has no service-account key and no broad project Drive role. Operators grant it access only to the selected Shared Drive/folder outside Terraform; root/archive IDs remain config and application policy. My Drive uses the selected user refresh credential. | Handoff Google authentication; Drive Core constraints; task brief. |
| Public reachability is deliberate, not implicit. | Use Cloud Run HTTPS ingress suitable for the approved remote callers, but make any `allUsers` Cloud Run Invoker binding an explicit, false-by-default Terraform gate with a precondition/message. App-layer bearer/OAuth auth remains mandatory even when the route is public. Do not expose an unauthenticated Drive operation. | Handoff requires authenticated HTTPS clients; task 002 authentication contract; least-privilege task brief. |
| Resources are bounded and operations are reversible. | Parameterize validated Cloud Run region/name/image, CPU/memory, concurrency, request timeout, min/max instances, startup timeout, and secret versions. Use conservative finite defaults and Terraform variable validation. Do not auto-promote production traffic or create CI/CD rollout logic. | Task brief; task 002 request bounds; handoff production caveat. |
| Secrets are references only. | Terraform accepts secret IDs and versions, uses Secret Manager volume references, grants resource-level IAM to existing secrets, and produces no secret data source, `secret_data`, secret creation-with-payload, output, or rendered example containing secret text. | Task brief; `AGENTS.md`; handoff. |
| Deployment requires a deliberate operator gate. | Documentation separates formatting/plan from apply, requires an explicit production variable/confirmation, and records a rollback procedure to a prior Cloud Run revision or known image digest. No `terraform apply` or live validation is part of repository checks. | Task brief; handoff definition of done. |
| Tests are fake/local/static only. | Test runtime composition with injected/fake Drive/auth/API collaborators where needed. Inspect generated deployment assets/config plans without Docker, Terraform, cloud APIs, mounted secrets, or a live Drive call. Docker/Terraform commands are documented opt-in operator checks only. | `AGENTS.md`; task brief; task 001/002 fake-first test strategy. |

## Visual design

No visual design applies. This is backend packaging and infrastructure. The approved feature-level
source is `02-authenticated-service-api/feature.md`; it has no visual artifact.

## Current-tree alignment

`package.json` already fixes Node 24, pnpm, TypeScript compilation to `dist/`, Express, Google
libraries, and the aggregate `pnpm check`. `src/index.ts` is currently only an Express scaffold, but
task 002 is concurrently replacing it with JSON API composition. Re-read its exported factory and
HTTP configuration before implementation; this task must consume that factory rather than duplicate
routes, auth, limits, errors, or audit behaviour.

`src/config/service-config.ts` has no runtime-loader and currently models only Drive/auth config.
Task 002 is expected to add its `http` section. The implementation may add a focused runtime config
loader and server bootstrap, but it must retain caller-injected parsing in `parseServiceConfig` and
avoid module-import I/O. `src/drive/google-drive-read-adapter.ts` and
`src/drive/google-drive-auth.ts` provide the existing read/Google authentication seams. The latter
currently accepts parsed refresh credentials, so the My Drive bootstrap needs a bounded, redacted
secret-file parsing seam; it must not reuse the live-probe configuration loader or alter its local
operator policy.

The Drive core's `MarkdownService` defaults to `DisabledDriveWritePort`. Preserve that default in
runtime composition until a separately reviewed operator-owned write-session provider exists. Do
not use `GoogleDriveWriteAdapter` merely because it is available: doing so would create an
auth-to-write bypass and violate the guarded-write design.

There is no `Dockerfile`, `.dockerignore`, `infra/`, deployment runtime module, or Terraform lock
file yet. Add only assets necessary for this task; avoid changing domain, application policy,
write-gate, live-drive harness, MCP, plugin, and Codex client areas.

## Detailed implementation approach

### 1. Add deliberate, import-safe production composition

Create a focused runtime module (for example `src/runtime/server.ts` and supporting
`src/runtime/config.ts`) with a callable bootstrap. Keep import side effects at zero. The executable
entry point alone may:

1. read a bounded `GATEWAY_SERVICE_CONFIG_JSON` environment value containing non-secret JSON;
2. parse JSON and call `parseServiceConfig` exactly once before listening;
3. build the configured read-only `MarkdownService` from `GoogleDriveReadAdapter` and the correct
   `GoogleDriveAuthConfig`;
4. create the task-001 `PrincipalVerifier` and task-002 JSON API app through their public factories;
5. bind only to the numeric Cloud Run `PORT` (default 8080 for local container use), handle SIGTERM
   by stopping acceptance of new HTTP work, and fail with a bounded/redacted startup message if
   composition is invalid.

Make filesystem, environment, listener, and external-client construction injectable enough for
fake-only tests. The listener must not print configuration JSON, secret file paths, raw errors,
tokens, or credential objects. It may print a fixed readiness/start message and validated port.

For My Drive, read at most a small bounded OAuth JSON secret file after the non-secret config has
selected that mode. Validate its required client ID/client secret/refresh token structure without
returning or logging its content, then use it to create the existing adapter. For Shared Drive ADC,
create the existing ADC path only; no OAuth mounted secret is allowed. The normal Google client may
acquire credentials only after a future Drive request, not during import or `/healthz`.

The runtime must supply no `MarkdownWriteSession` provider, so task-002 write endpoints keep their
documented `UNSUPPORTED` response. It must not invoke `WriteGate.evaluate`, evidence/trust/replay
work, the raw write adapter, or any mutation on startup, health, or request flow.

### 2. Build a minimal Node 24 production image

Add `Dockerfile` and a defensive `.dockerignore`.

- Use a Node 24 slim base in distinct dependency/build/runtime stages. Enable the repository-pinned
  pnpm through Corepack, install from `pnpm-lock.yaml` with `--frozen-lockfile`, compile with the
  project build script, and transfer only compiled output, production dependencies, package manifest
  and needed runtime metadata to the final image.
- Run the final process as the image's unprivileged `node` user (or a named user with a fixed
  non-zero UID) with owned application files. Do not `USER root` in the final stage, expose a debug
  shell, or install build tooling there.
- Set `NODE_ENV=production`, document `PORT=8080`, and use exec-form `node dist/...` startup.
  The image must not copy `.env`, credentials, `node_modules`, `dist`, `.git`, test fixtures, or
  untracked local configuration from the build context. The ignore file should be deny-by-default or
  explicitly exclude those sensitive/high-noise paths.
- Keep build inputs compatible with the existing NodeNext output and task-002 exports. Do not add a
  Docker-based test dependency to standard CI. A local operator may run a container with a synthetic
  non-secret config and fake/unreachable client endpoints solely to reach `/healthz`; it must not
  include a real mounted secret or call Drive.

### 3. Define Terraform with resource-scoped identities and secret mounts

Create `infra/terraform/` with a conventional, reviewable split such as `versions.tf`,
`providers.tf`, `variables.tf`, `artifact-registry.tf`, `service-account.tf`, `secrets.tf`,
`cloud-run.tf`, `outputs.tf`, and a checked-in non-secret `terraform.tfvars.example`. Pin a
compatible Google provider constraint and commit the dependency lock only if a local, non-live
`terraform init` can produce it without weakening reproducibility; otherwise document the exact
operator initialization as a prerequisite.

Terraform must model:

- one regional Docker Artifact Registry repository suitable for the service image, with image input
  preferably supplied as an immutable digest rather than mutable tag;
- one dedicated runtime service account, no key resource, and no project-wide Owner/Editor/Drive
  role;
- Cloud Run v2 service with the runtime service account, explicit `container_concurrency`,
  request `timeout`, min/max instance bounds, CPU/memory limits, `PORT`, and only non-secret
  `GATEWAY_SERVICE_CONFIG_JSON` assembled from validated variables;
- a `GET /healthz` startup probe on the container port and an explicit Cloud Run ingress setting;
- exactly one mounted Codex secret volume/path and a conditional My Drive OAuth secret volume/path;
  secret IDs and versions are input references. Do not place values in environment variables;
- resource-level `roles/secretmanager.secretAccessor` IAM bindings for the runtime identity only on
  those selected existing secrets. Model conditional mode selection with `for_each`/validated locals
  so an ADC deployment gets no OAuth binding/mount;
- an explicitly gated, documented optional Cloud Run Invoker IAM binding for public gateway
  reachability. A default Terraform plan must not silently create an `allUsers` binding. If the gate
  remains false, document that an approved identity-aware ingress/proxy or explicit operator binding
  is needed before remote clients can call the app-layer bearer endpoint;
- minimal safe outputs: service name, region, Artifact Registry repository, and service URI only.
  No environment JSON, secret IDs/paths, service-account tokens, or Terraform sensitive values are
  output.

Use variable validation/preconditions to reject blank IDs, invalid auth mode, missing/shared
drive ID mismatch, missing OAuth secret for My Drive, secret paths that do not match the JSON config,
unbounded resource values, and `allow_public_invoker` without an explicit acknowledgement variable.
Avoid automatic API enablement or destroy-time disabling unless it is separately approved: operators
may need organization-specific policy/permissions. State clearly that Drive folder membership is an
out-of-band Google Drive administrator action and cannot be replaced by project IAM.

### 4. Write operator-facing deployment and rollback guidance

Add a focused document such as `docs/cloud-run-deployment.md` that explains:

- prerequisites: selected Drive mode/root/archive, existing Artifact Registry/Secret Manager/Cloud
  Run permissions, Node 24/pnpm for local checks, Terraform, and Google Cloud CLI only for
  operator-run deployment;
- creation/rotation of secret *containers* through the approved secret-management process, without
  showing payload values, exporting a secret, or instructing a user to paste a credential into a
  committed file. Codex bearer is rotated by updating its mounted secret; My Drive refresh rotation
  is followed by a controlled revision restart; Shared Drive ADC rotates through workload identity;
- how to fill only non-secret Terraform variables, build/push an image digest, run `fmt`,
  `validate`, and review `plan`; production apply needs the explicit public/production gate if
  applicable;
- post-deploy verification limited to `/healthz`, unauthenticated protected-route rejection, and
  audited test-folder operations performed only under the existing live capability-harness operator
  controls. Never put a real authorization header in shell history or logs;
- rollback via Cloud Run revision traffic reassignment or a previous immutable image digest, then
  confirmation that writes stayed separately disabled. Include cleanup cautions: no automatic secret
  deletion and no Drive data deletion.

### 5. Prove packaging and policy without cloud side effects

Add focused static/runtime tests, using only fakes/local files, for:

- bootstrap config shape/size failures before binding, valid Shared Drive/My Drive composition
  selection, no OAuth loader in ADC mode, and the default-disabled write session;
- import safety: runtime modules do not inspect environment, load files, listen, fetch JWKS, create
  Google credentials, or call Drive just because they are imported;
- Docker asset assertions: Node 24, multi-stage build, locked install, build output, non-root final
  user, exec-form compiled startup, and Dockerignore exclusions. Do not invoke Docker from Vitest;
- Terraform asset assertions: Cloud Run v2, bounded resource variables, service account without
  key, resource-scoped Secret Manager access, secret volume references rather than secret values,
  conditional OAuth mount, startup health probe, and no unguarded public-invoker binding or secret
  output. Assertions must not snapshot/render actual credentials;
- documentation checks for required rotation, least-privilege, `healthz`, validation, and rollback
  sections, with no credential-shaped test string.

Where practical run `terraform fmt -check` and `terraform validate` only against local source after
checking that Terraform is installed and without provider/network initialization. If initialization
or Docker is unavailable, record it as an opt-in operator validation—not a reason to fabricate a
success. Never run `apply`, authenticate `gcloud`, load mounted secrets, or run the live Drive
probe for this task.

## Expected control flow and invariants

```text
Cloud Run revision
  -> non-secret GATEWAY_SERVICE_CONFIG_JSON + Secret Manager volume references
  -> explicit runtime bootstrap (bounded parse, then composition)
     -> shared-drive-adc: attached runtime service account / ADC
     -> my-drive-refresh-token: bounded mounted OAuth file read after boot selection
     -> PrincipalVerifier: static JWT policy + per-request mounted Codex bearer read
     -> task-002 createJsonApiApp
        -> /healthz: composition only, no Drive/auth/session call
        -> protected read routes: existing MarkdownService / folder-confined Drive adapter
        -> protected write routes: no session, therefore UNSUPPORTED
```

- The Cloud Run service is stateless. No document, token, lease, credential, rate-limit state, or
  Drive metadata is stored in the container filesystem.
- The image, Terraform state/config, documentation, logs, test output, and public HTTP envelopes
  contain no secret value. Secret paths/IDs stay internal deployment references and are not audit
  data.
- An unauthenticated Cloud Run invocation (where public invoker is explicitly enabled) reaches only
  application auth and cannot use a document operation. Cloud Run IAM is not a substitute for the
  two-principal verifier.
- Health works before a Drive call and must not be used to assert Drive permissions. Drive access is
  still root-confined by the existing application/adapter contracts.
- A process response deadline remains task 002's response deadline; container/request timeout must
  be longer than the API deadline plus a small shutdown/serialization margin. Neither introduces a
  write retry or proves a timed-out mutation did not settle.
- Secret rotation changes credentials independently of source/image changes. It never changes the
  configured root, archive, auth principal rules, or write-gate authority.

## Test strategy and exact validation

Run focused tests only once their paths exist, then the repository-required suite:

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

Optional local/operator checks, never as an implementation-time cloud action:

```bash
terraform -chdir=infra/terraform fmt -check
terraform -chdir=infra/terraform validate
docker build --tag google-drive-markdown-gateway:local .
```

Only run the latter two after confirming their tools are present and that the command does not need
cloud credentials, pull an unreviewed image, or read an actual secret. Do not run Terraform apply,
`gcloud auth`, Cloud Run deploy, remote JWKS/OAuth, or `pnpm drive:probe` in this task.

## Risks and careful checks

- Cloud Run's `latest` secret-volume semantics and permission propagation are deployment concerns.
  The application must continue to collapse missing/malformed Codex secret reads to the stable
  authentication failure; never add a bearer cache as a workaround.
- Cloud Run startup probes do not prove a service account can reach the selected Drive folder. Keep
  Drive credential/folder validation under the guarded live harness after explicit operator setup.
- Do not write Terraform in a way that requires `allUsers` access merely to plan. Public invoker is
  an explicit application-auth deployment decision and may be constrained by organization policy.
- Do not treat project IAM as Drive ACL management. Shared Drive/folder membership must be granted
  to the dedicated runtime identity by the Drive administrator, and should be limited to the
  configured Markdown root/archive hierarchy.
- Recheck the exact task-002 API factory, `ServiceConfig.http` bounds, and compiled entry output
  before coding. This spec intentionally names integration seams, not stale pre-implementation
  symbols or a fixed JSON schema.
- If Terraform/provider syntax needs a version-specific adjustment, use only a pinned provider
  version and record that exact version in the lockfile/documentation; do not silently switch to a
  moving beta API.

## Open questions

None. Deployment-specific values—project, region, image digest, Drive IDs, issuer/audience/JWKS,
secret references, resource limits, and any public-invoker approval—are intentionally operator
inputs rather than repository defaults.
