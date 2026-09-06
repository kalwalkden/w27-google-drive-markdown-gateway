# Deployment-Owned Write Authority — Implementation Plan

## Scope

Replace the runtime evidence/JWS/replay/lease authority with one deployment-owned, process-local writer capability. Add a strict, normalized default-off write setting; compose an authenticated server-side raw Drive HTTP seam only when it is enabled; and make Terraform require a separate write-risk acknowledgement before it can deploy an enabled revision.

The live Drive capability harness remains an opt-in operator release gate. It produces sanitized evidence only. It must have no import, configuration, data, or control-flow path to runtime write authority.

This task deliberately does **not** expose a write session to JSON or MCP. Task 003 owns the mutation pre/postconditions and is the first task allowed to pass the enabled session to either transport. Thus, both authenticated principals remain able to authenticate normally, but both transports continue to return `UNSUPPORTED` for writes in this task, including when deployment write mode is true.

## Binding decisions and constraints

| Decision | Implementation effect | Provenance |
| --- | --- | --- |
| Deployment configuration, not probe evidence, authorizes runtime writes. | Delete `src/write-gate/` and its tests; remove every runtime `WriteGate`, `WriteLease`, approval, JWS, and replay-store dependency. Retain `src/live-drive/` as an isolated operator tool. | Approved feature, Runtime write authority; approved task brief. |
| Missing write configuration means disabled. | Normalize an absent top-level `write` object to `{ enabled: false }`; accept only a strict object with a boolean `enabled` when present. Unknown keys, non-booleans, and malformed runtime JSON fail startup. | Task brief, feature constraints. |
| Terraform remains read-only by default and makes enabling reviewable. | Add `enable_write` and `acknowledge_write_risk`, both `bool`, both default `false`. Put `write.enabled = var.enable_write` in the runtime JSON and add a Cloud Run lifecycle precondition requiring `acknowledge_write_risk` when `enable_write` is true. Include explicit false values in the non-secret `terraform.tfvars.example`. | Task brief acceptance criteria; feature release gate. |
| Scope selection is explicit and mode-specific. | Extend Google auth construction with an internal/read-only versus write selection. Read adapters use exactly `https://www.googleapis.com/auth/drive.readonly`; an enabled raw writer uses exactly `https://www.googleapis.com/auth/drive`. Do not use `drive.file`, scope unions, or a client-provided scope. | Feature runtime-write decision. |
| Google, Work, and Codex credentials stay distinct. | Only the server-side selected Drive auth config can obtain a Google access token. Work JWTs and Codex bearer values remain inputs solely to `PrincipalVerifier`; never pass either into raw Drive HTTP, Google auth, config output, telemetry, or tests. My Drive refresh-token consent is operator-owned and may be broader than the configured root; document that as a reviewed confinement risk. | Feature constraints and tradeoffs; handoff authentication boundary. |
| Writer authority is process-local and non-serializable. | Keep the writer's state in module-private `WeakMap` state and expose only frozen closure methods through `MarkdownWriteSession`; remove all lease parameters and last-moment JWS validation. The capability contains no public raw port, token, evidence, approval, or serializable authority value. A disabled writer still returns the existing `unsupported` raw result. | Task brief; feature runtime-write decision. |
| Current transport mutation safety is unchanged. | Compose an enabled raw writer into `MarkdownService` only after configuration/credential construction succeeds, but retain `writeSessionProvider: undefined` for JSON and MCP. Do not alter public operation DTOs, archive behavior, mutation retries, or error vocabulary. | Task brief caveat; task 003 brief. |
| Startup fails closed; it does not claim Drive readiness. | Parse and cross-validate config before composition; for My Drive load and strictly parse the mounted OAuth secret before listening; construct the selected read and, if enabled, write auth/HTTP/writer seams before listening. Any configuration, mode/credential-source, bounds, or factory error aborts startup rather than downgrading silently. Do not acquire a Google token or make a Drive request at startup: `/healthz` remains process liveness and live capability/ACL verification is operator-only. | Feature constraints; existing runtime behavior; deployment docs. |
| Telemetry remains content-free and closed. | Preserve existing per-operation/principal `unsupported` classification while transport sessions are withheld. Do not add a label/event for write mode, Google scope, token acquisition, config, evidence, or secret state. Raw-auth implementation must not log headers, URLs, bodies, provider responses, or token errors. | Feature constraints; observability contract. |

## Visual design

Use the approved feature-level [operation flow](../../visuals/operation-flow.md). This task implements only its deployment-mode branch: absent/false produces no write auth or transport; true constructs an internal server-side writer but still does not expose it to JSON or MCP until task 003. There is no user-facing visual surface.

## Product alignment

The handoff requires one gateway over one server-side Google identity, with Work and Codex as distinct gateway principals. The feature corrects the earlier release-evidence gate: a live test proves observed provider behavior at one point in time, while a reviewed deployment setting determines whether a running revision may hold a writer. Root confinement remains application policy plus operator-managed Shared Drive membership or My Drive consent; enabling mode is not proof of ACL correctness or live provider success.

## Detailed implementation approach

### 1. Remove runtime lease authority and simplify the application boundary

Delete the complete `src/write-gate/` directory and `tests/write-gate/`. Remove the unused JWS approval payload example `docs/write-approval.payload.example.json`. Update all imports and fixtures that currently mint a synthetic lease.

Refactor `src/drive/guarded-drive-write-port.ts` so `GuardedDriveWritePort` is constructed from one `RawDriveWritePort`, with its authenticated state held only in the existing module-private `WeakMap`. Keep a final `DisabledDriveWritePort`, authentic-instance checks, prototype/proxy rejection, and the three narrow guarded dispatch helpers. Each helper takes only verified IDs/revision/content and delegates exactly once when the writer is authentic and enabled; it must not accept or validate a lease. A disabled, forged, proxied, or otherwise unknown writer returns `unsupported` without raw dispatch.

Refactor `MarkdownService` to remove `WriteLease` from `openWriteSession` and its private mutation methods. `openWriteSession()` returns the frozen, process-local closures over the service's private writer. Preserve the writer constructor check and the safe disabled-writer outcome. Task 003 will replace the current direct-root mutation orchestration and decide when runtime may open this session; do not change that boundary here beyond removing the retired lease argument.

### 2. Make the Drive auth boundary choose exactly one access level

In `src/drive/google-drive-auth.ts`, make the access level an explicit typed input rather than a hidden global read scope. Keep `GoogleDriveAuthConfig` limited to the server-side selected auth mode and credentials. The read adapter continues to call the read-only variant; no read path receives the write scope.

For `shared-drive-adc`, instantiate `GoogleAuth` with exactly one selected scope: read-only for reads or `drive` for write transport. For `my-drive-refresh-token`, build the `OAuth2Client` only from the mounted server credential object; the operator must have granted the matching Google scope during OAuth consent. The code must not represent a narrowed refresh-token grant as folder-scoped or claim it can override the grant held by Google.

Add a private-to-Drive composition seam (in `google-drive-auth.ts` or a narrowly named adjacent module) that wraps the selected write auth in `GoogleDriveRawHttp`. For every raw writer request it acquires a server-side access token, adds `Authorization: Bearer <token>` only at the outgoing request boundary, forwards the adapter-created method, URL, body, and non-auth headers, and returns only status, headers, and bytes needed by `GoogleDriveWriteAdapter`. It must neither accept incoming gateway authorization nor expose/token-log the acquired credential. Inject token acquisition and fetch/send seams for tests; production uses Node fetch with no retry and no redirected request. Preserve the write adapter as the only owner of exact Drive mutation URLs, `If-Match`, multipart encoding, and response parsing.

### 3. Normalize deployment config and fail before listening on inconsistency

Extend `src/config/service-config.ts` and `ServiceConfig` with a normalized top-level readonly `write: { enabled: boolean }`. `parseServiceConfig` must return `enabled: false` for a valid legacy config with no `write` key, while rejecting unknown keys in the object and all malformed values. Keep existing strict Drive auth discriminators and cross-limit validation. Add only cross-checks supported by local configuration: write mode does not select a new auth mode, does not accept a missing My Drive secret reference, and cannot relax existing request/Drive bounds.

In `src/runtime/server.ts`, preserve one selected server-side Drive identity for the read adapter. When disabled, build no write-scope auth object, raw HTTP composition, raw writer, or write session. When enabled, load My Drive credentials once as today, construct one write-scope auth/raw HTTP/`GoogleDriveWriteAdapter`/`GuardedDriveWritePort`, and inject that writer into the same `MarkdownService` that both transports share. Do not create a second service, a second Drive implementation, a principal-specific writer, or a session provider. Keep `writeSessionProvider` absent for JSON and MCP in this task; task 003 will make one enabled session available to both only after it supplies complete nested mutation checks.

Expand runtime dependency injection only with narrow factories needed to test enabled/disabled composition. Any selected-factory failure, malformed config, invalid limits, missing/invalid My Drive secret, or invalid port must reject before `listen`. Do not read a Work/Codex credential, fetch JWKS, acquire a Google token, or issue a Drive request during composition.

### 4. Make Terraform acknowledgement explicit and update authority documentation

Add documented boolean Terraform variables named `enable_write` and `acknowledge_write_risk`, defaulting false. Feed only `enable_write` into `local.service_config.write.enabled`; never serialize the acknowledgement into service config. Add the lifecycle precondition `!var.enable_write || var.acknowledge_write_risk` with an error that says both settings must be reviewed for a write-enabled revision. Retain all existing mode, secret-mount, service-apply, public-invoker, timeout, and limit preconditions.

Update `infra/terraform/terraform.tfvars.example` and `docs/cloud-run-deployment.md` to explain the two-step review, the default read-only outcome, and rollback by deploying an explicit false setting without deleting credentials or Drive data. State that an enabled setting is not a Terraform/live-Drive success claim and must follow the approved dedicated-root evidence and release checks.

Rewrite `docs/write-gate-and-client-validation.md` in place as the deployment-owned write-authority/release-evidence runbook so existing links remain valid. Remove all signing, JWS, approval, replay store, lease issuance, and evidence-submission instructions. It must state that the live capability harness is required operator evidence before a reviewed enablement but is never a runtime input, that Terraform's separate acknowledgement is mandatory for enablement, and that neither Work nor Codex credential authenticates to Google. Limit this task's client-text changes to removing obsolete lease claims; task 004 owns completed cross-client workflows and harness/checklist changes.

Update `docs/threat-model.md` only where it names the retired gate/lease or misstates the production deployment model. Keep the current direct-root and unavailable-archive caveats until tasks 001 and 003 complete. `docs/observability-contract.md` should remain unchanged unless an implementation would otherwise create a new write-authority telemetry fact; the explicit decision is not to add one.

## Expected control flow and invariants

```text
Cloud Run Terraform
  enable_write (false by default) + acknowledge_write_risk
    -> strict service config: write.enabled
      -> composeRuntime
        false -> read-only Google auth + reader + disabled writer
                 -> no write-scope auth/raw HTTP/writer/session
        true  -> selected server Google auth with drive scope
                 -> authenticated raw HTTP -> raw writer -> guarded writer
                 -> same MarkdownService (no JSON/MCP session yet)

Work JWT or Codex bearer
  -> PrincipalVerifier only
  -> JSON/MCP authenticated route
  -> no client credential reaches Google

operator live capability probe
  -> sanitized external evidence -> reviewed release decision only
  -/> runtime config, writer, session, or request authorization
```

Invariants to preserve:

- Absence, false, malformed, or unknown-key write configuration cannot construct a write-scoped Google auth object or writer.
- An enabled process has exactly one selected server Google identity and one raw writer composition; callers cannot supply a token, scope, credential, writer, lease, evidence, or approval.
- The raw HTTP seam dispatches once per adapter call and never retries, redirects, logs, or exposes a credential.
- The current write adapter remains the only mutation protocol owner; its `If-Match` and response handling do not move into runtime/auth code.
- Work and Codex remain separately authenticated gateway principals. Their existing authentication/configuration remains required even though the session is still withheld.
- No secret, refresh token, bearer, access token, Google credential object, raw header, content, path, revision, Drive ID, evidence, approval, or raw provider payload is added to logs, config examples, Terraform values, or fixtures.
- Runtime composition and all new tests make no live Google, Work, Codex, Cloud Run, Terraform, secret-manager, or Drive call.

## Task-local sequencing

1. Replace the writer/session contract and delete the write-gate modules, synthetic gate fixtures, tests, and approval example; update service and direct unit fakes.
2. Add typed access-level auth selection and the authenticated raw HTTP composition seam with fake token/send tests.
3. Normalize `write.enabled`; wire enabled-only writer composition and fail-closed factory seams while withholding transport sessions.
4. Add Terraform variables/precondition/config projection and non-secret example/docs updates.
5. Run focused tests, complete validation, and inspect the diff for retired runtime authority references. Do not alter task status, build log, or commits.

## Test strategy and exact validation

Add or revise fake/static Vitest tests; none may use real credentials, environment secrets, network, Drive, Work, Codex, Cloud Run, Terraform apply, or the live harness.

- `tests/config/service-config.test.ts`: valid legacy config normalizes to disabled; explicit true/false parse; malformed/unknown write objects reject; existing mode/limit checks remain.
- `tests/drive/google-drive-auth.test.ts`: read construction selects only `drive.readonly`; write construction selects only `drive`; My Drive is built only from supplied fake credentials; all constructors remain token/network-free.
- New or expanded Drive raw-auth tests: enabled writer's fake token provider adds one authorization header only to an outgoing fake request, preserves adapter headers/body, rejects token/send failure without leaking a value, follows no redirect, and does not retry. Disabled runtime never calls either write auth or raw HTTP factory.
- `tests/drive/guarded-drive-write-port.test.ts`: authentic enabled writer dispatches each raw method once without a lease; disabled/forged/proxied/replaced-instance paths do not dispatch. Remove every JWS/evidence/lease case.
- `tests/application/markdown-service.test.ts`: sessions no longer require a lease; disabled writer remains unavailable; authentic writer still cannot be forged. Preserve direct-root current behavior; do not add task-003 topology/mutation behavior.
- `tests/runtime/server.test.ts`: disabled config has no write factory, writer, or provider for either JSON/MCP; enabled config builds exactly one server-side writer using the selected auth mode/credentials and one shared service but still has no transport session; malformed write config or enabled setup failure rejects before listening; ADC never reads OAuth; My Drive reads/parses its bounded fake secret once. Assert the same verifier/service remains shared, without testing live principal credentials.
- `tests/deployment/assets.test.ts`: assert both variables, false defaults, JSON projection, and the conditional acknowledgement precondition; continue rejecting secret payloads/keys and keep deployment docs credential-free.
- Existing JSON/MCP tests remain default-disabled and retain the `UNSUPPORTED` write assertions. Add only assertions needed to prove no session was accidentally exposed under enabled runtime composition; defer enabled write-route behavior to task 003.
- `tests/observability/audit.test.ts` and route telemetry tests: retain closed `unsupported` classification and assert no configuration/scope/token/evidence fields or labels were introduced.

Run, from repository root:

```bash
./scripts/verify-vendored-skills.sh
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
CI=true pnpm check
git diff --check
```

Do not run `pnpm drive:probe`, obtain a Google token, invoke any client, run Terraform, provision a secret, or contact a live service as part of this task.

## Current-tree deviations, boundaries, and risky edges

The brief names `src/write-gate/gate.ts` as a runtime issuer, but current `composeRuntime` never imports or constructs it; it is presently coupled only through `guarded-drive-write-port.ts`, `MarkdownService`, and tests. Delete the whole authority subsystem rather than retaining an unused alternative. `src/live-drive/auth.ts` already has a separate write-scope token provider for the operator probe; do not import it into runtime, and do not move live tooling into production composition.

`GoogleDriveWriteAdapter` is already a raw unauthenticated mutation seam. This task adds its production server-auth composition but does not reinterpret `unsupported` provider outcomes or add `OUTCOME_UNKNOWN`; task 003 owns that result, all mutation pre/postconditions, and transport session exposure.

The prior `docs/write-gate-and-client-validation.md`, Work package, Codex guidance, and client validation records contain lease wording. Task 002 must remove/rewrite the central obsolete runtime-authority document and threat/deployment claims necessary to avoid a second authority model. Task 004 remains owner of full Work/Codex user instructions, release records, and harness state-machine alignment. Do not change feature/task status, feature-wide task list, build log, vendored skills, package dependencies, external configuration, or current public operation shapes.

No open product decision remains. Before editing, the implementer must verify the concurrent task-001 tree-model diff and retain its current service/port contracts rather than overwriting it.
