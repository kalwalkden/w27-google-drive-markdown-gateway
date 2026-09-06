# Deployment-Owned Write Authority — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `src/drive/guarded-drive-write-port.ts` | `GuardedDriveWritePort`, `DisabledDriveWritePort`, guarded dispatch helpers | Remove lease/gate validation while retaining an authenticated, module-private process-local writer capability. |
| `src/application/markdown-service.ts` | `MarkdownWriteSession`, `openWriteSession`, create/update/archive private methods | Remove `WriteLease` plumbing; preserve frozen closures and current direct-root behavior for task 003. |
| `src/drive/google-drive-auth.ts` | `GoogleDriveAuthConfig`, `createGoogleDriveAuth`, Google API construction | Make read versus write scope selection typed and add/factor the authenticated raw HTTP composition seam. |
| `src/drive/google-drive-write-adapter.ts` | `GoogleDriveRawHttp`, `GoogleDriveWriteAdapter` | Consume the new server-auth HTTP seam without moving request construction, response parsing, or no-retry behavior. |
| `src/config/service-config.ts` | `serviceConfigSchema`, `ServiceConfig`, `parseServiceConfig` | Normalize strict `write.enabled` to false when absent and keep cross-limit/mode validation fail closed. |
| `src/runtime/server.ts` | `RuntimeDependencies`, `composeRuntime`, read-adapter config helper | Build writer/auth only when enabled, inject it into the one service, and withhold JSON/MCP sessions until task 003. |
| `src/runtime/config.ts` | config and bounded OAuth secret loading | Existing My Drive credential source; retain pre-listen parsing and bounded/no-leak behavior. |
| `infra/terraform/variables.tf` | new write enablement and acknowledgement variables | Explicit false defaults and descriptions that distinguish runtime enablement from the reviewed acknowledgement. |
| `infra/terraform/cloud-run.tf` | `local.service_config`, Cloud Run lifecycle preconditions | Project `enable_write` into service config and require the separate acknowledgement conditionally. |
| `infra/terraform/terraform.tfvars.example` | operator input example | Show explicit safe false settings without any credential payload. |
| `docs/cloud-run-deployment.md` | deployment/rollback guidance | Describe the two-step gate, scope/identity separation, read-only default, and disable-only rollback. |
| `docs/write-gate-and-client-validation.md` | obsolete gate runbook | Rewrite in place as release evidence plus deployment-owned authority guidance; remove signing/lease/replay instructions. |
| `docs/write-approval.payload.example.json` | obsolete JWS template | Delete with the retired approval contract. |
| `docs/threat-model.md` | write authority assets and abuse-case wording | Replace gate/lease assertions with default-off deployment authority while retaining current topology caveats. |
| `src/write-gate/` and `tests/write-gate/` | approval, evidence proof, JWS, replay, trust, audit, and fixtures | Delete: no remaining runtime path is allowed to mint authority from probe evidence. |

## Entry point and call path

```text
GATEWAY_SERVICE_CONFIG_JSON
  -> parseRuntimeConfigJson
  -> parseServiceConfig (normalized write.enabled)
  -> composeRuntime
       -> loadOAuthCredentials only for My Drive
       -> createGoogleDriveReadAdapter (read-only Google scope)
       -> [enabled only] write-scope Google auth
                         -> authenticated GoogleDriveRawHttp
                         -> GoogleDriveWriteAdapter
                         -> GuardedDriveWritePort
       -> one MarkdownService
       -> JSON + MCP apps with writeSessionProvider still absent

Authorization header
  -> createPrincipalVerifier
  -> Work JWT or Codex bearer verification
  -> gateway route only; never Google auth/raw HTTP

operator command: pnpm drive:probe
  -> src/live-drive/* -> external sanitized evidence
  -> operator release review only (no runtime edge)
```

## Contracts, state, and invariants

- `ServiceConfig.write` is a strict normalized readonly `{ enabled: boolean }`; omitted means false. It is non-secret and carries no acknowledgement, credential, scope, evidence, or principal.
- `GoogleDriveAuthConfig` selects only a server-side auth mode: shared-drive ADC or My Drive refresh credentials. A typed access level selects exactly one of the Google `drive.readonly` or `drive` scopes. Gateway client credentials never inhabit this contract.
- `GoogleDriveRawHttp` remains the exact narrow request/response contract used by `GoogleDriveWriteAdapter`. Auth composition may add a token at dispatch but must not alter the adapter's mutation ownership or retry semantics.
- `RawDriveWritePort` continues to accept already verified opaque IDs, ETags, and content. The writer capability has no exported serializable authority payload and must reject unknown/proxy/forged writer objects.
- `MarkdownWriteSession` is a frozen closure over a process-local service writer and has no `WriteLease`. It is not supplied to either runtime transport in this task.
- `PrincipalVerifier` remains the sole Work/Codex gateway-principal boundary. Both authentication configurations stay required; no writer is per-principal and neither principal credential is a Google credential.
- `src/live-drive/evidence.ts` and the live harness may retain their sanitizer/proof contracts, but neither may import runtime composition or drive writer authority, and runtime must not import their auth/token providers.
- Current `MarkdownGatewayError`, `ConditionalWriteResult`, public JSON/MCP schemas, audit result vocabulary, and direct-root/archive behavior remain unchanged. Task 003 owns `OUTCOME_UNKNOWN`, topology pre/postconditions, and enabled session exposure.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/runtime/server.ts` | Dependency-injected construction before listener startup | Add narrow write factories and assert failure before `listen`, with no external I/O in tests. |
| `src/runtime/config.ts` | Bounded mounted-secret reader and generic `RuntimeConfigurationError` | Reuse for My Drive; do not create a new secret path or expose parse details. |
| `src/drive/google-drive-auth.ts` | Provider SDK types contained at a Drive seam | Keep Google auth and raw HTTP internal to Drive composition, not runtime routes. |
| `src/live-drive/auth.ts` | Server-side `getAccessToken` abstraction | Conceptually relevant to token acquisition, but do not import it into runtime; it is operator tooling with a write scope. |
| `src/drive/google-drive-write-adapter.ts` | Narrow injected HTTP and one-send wrapper | Production auth composes this interface; adapter continues to own Drive URLs, `If-Match`, multipart bodies, and result normalization. |
| `src/drive/guarded-drive-write-port.ts` | WeakMap-backed authentic object checks | Retain the non-forgeable/process-local pattern after removing the now-obsolete gate/lease state. |
| `src/http/json-api.ts`, `src/mcp/stateless-mcp.ts` | Optional `WriteSessionProvider` with closed `UNSUPPORTED` fallback | Keep both absent in task 002; task 003 will supply the same enabled session to both. |
| `src/observability/audit.ts` | Typed closed audit/metric allowlist and Pino redaction | Preserve existing `unsupported` outcome; do not add sensitive write-authority labels. |
| `infra/terraform/cloud-run.tf` | JSON config projection plus lifecycle preconditions | Project only the boolean mode and enforce the separate acknowledgement before an enabled revision. |

## Tests and fixtures

| Path | Existing coverage / required update |
| --- | --- |
| `tests/config/service-config.test.ts` | Add absent/true/false/invalid write-mode parsing and preserve strict mode/limit coverage. |
| `tests/drive/google-drive-auth.test.ts` | Prove exact scope selection and constructor no-I/O behavior for both server auth modes. |
| `tests/drive/google-drive-write-adapter.test.ts` | Preserve exact request, ETag, and no-retry tests; add only integration with a fake authenticated raw HTTP seam where useful. |
| `tests/drive/guarded-drive-write-port.test.ts` | Replace synthetic evidence/lease issuance with authentic enabled, disabled, forged, proxy, and once-only writer tests. |
| `tests/application/markdown-service.test.ts` | Remove async top-level synthetic lease fixture; exercise `openWriteSession()` without a lease and retain default-deny/anti-forgery assertions. |
| `tests/runtime/server.test.ts` | Verify disabled mode creates no write auth/HTTP/writer/session; enabled mode constructs one writer/service without exposing JSON/MCP sessions; verify startup failures happen before listener startup. |
| `tests/http/json-api.test.ts`, `tests/mcp/stateless-mcp.test.ts` | Retain disabled session results and add only composition assertions needed to prevent premature enabled exposure. |
| `tests/deployment/assets.test.ts` | Static Terraform/example/doc checks for both default-false variables, conditional risk acknowledgement, and no secret material. |
| `tests/observability/audit.test.ts` and route tests | Confirm the closed terminal/event contract has no scope, mode, token, evidence, or config information. |
| `tests/write-gate/` | Delete together with the production authority system. The live-drive test suite remains. |

Use fake opaque IDs, fake access-token strings confined to a test seam, local test transports, and in-memory raw ports only. Do not add a fixture that resembles a usable bearer, OAuth object, Google access token, JWS, live evidence, or real Drive identifier.

## Expected unchanged boundaries

- `src/live-drive/`, `tests/live-drive/`, `config/live-drive-probe.example.json`, and `docs/live-drive-capability-harness.md` remain operator-only capability tooling. Do not invoke or wire them into runtime.
- `src/http/json-api.ts`, `src/mcp/stateless-mcp.ts`, public endpoint/tool names, Work-only MCP principal behavior, and JSON/Codex endpoint behavior remain functionally read-only for writes until task 003.
- `src/drive/google-drive-read-adapter.ts`, `src/drive/drive-port.ts`, current direct-root read semantics, and task 001's tree work should not be replaced by this task.
- `src/codex-cli/`, `src/codex-cloud/`, Work package workflows, release checklists, client validation templates, and the complete threat/observability/client documentation update belong to task 004 except for removing the central obsolete authority claims named above.
- `package.json` and `pnpm-lock.yaml` should not change: deleting the JWS subsystem does not remove `jose` if other current code still needs it, and this task needs no new package.
- Feature/task status files, `tasks.md`, build log, commits, Terraform apply, deployed config, secrets, ACLs, or client/cloud environment state are outside scope.

## Validation commands

Authoritative source: `AGENTS.md`, `package.json`, and `ARCHITECTURE.md`.

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

## Uncertainties to verify

- Task 001 may change `MarkdownService`, Drive read ports, limits, and tests concurrently. Rebase this task's writer/config changes onto its final committed contracts; do not restore direct-root-only behavior or discard its topology model.
- Confirm the installed `google-auth-library` type surface supports the selected access-level construction and a no-I/O access-token seam without widening exposed SDK types. If an SDK method differs, preserve the stated single-scope/server-only/no-retry contract behind a narrow local interface instead of introducing a second auth library.
- Confirm Node's production fetch configuration can explicitly reject redirects while preserving the raw adapter's response headers/body contract. Do not follow a redirect or retry to make a test pass.
- Before deleting `jose`, search the current tree. It is used by Work JWT verification as well as the retired JWS gate, so retain the dependency unless that separate consumer has changed.
