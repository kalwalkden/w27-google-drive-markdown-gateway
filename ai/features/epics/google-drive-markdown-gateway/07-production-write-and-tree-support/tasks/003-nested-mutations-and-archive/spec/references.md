# Nested Mutations and Archive — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `src/application/markdown-service.ts` | `MarkdownService`, `MarkdownWriteSession`, mutation resolvers/snapshot helpers | Replace direct-root create/update gates and unavailable archive with task-001-scoped topology pre/re/postconditions, one dispatch, and unknown-outcome mapping. |
| `src/domain/markdown.ts` | `ErrorCode`, `MarkdownGatewayError`, six-operation contracts | Add the stable domain `OUTCOME_UNKNOWN` code while retaining metadata/result shapes and opaque IDs/revisions. |
| `src/drive/drive-port.ts` | `CreateWriteResult`, `ConditionalWriteResult`, raw writer port | Represent a known pre-dispatch unsupported capability separately from a post-dispatch uncertain result. Retain raw operations accepting only verified opaque IDs/revisions. |
| `src/drive/google-drive-write-adapter.ts` | `GoogleDriveWriteAdapter`, `send`, `createResult`, `conditionalResult` | Preserve exact one raw request and Drive request construction; normalize thrown/non-412/malformed dispatched outcomes to unknown. |
| `src/drive/guarded-drive-write-port.ts` | guarded create/update/move helpers | Use task 002's no-lease process-local writer contract; preserve authentic-instance checks and one delegation. |
| `src/drive/in-memory-drive-port.ts` | fixtures, raw create/update/move, race hooks | Support task-001 scoped reads and deterministic pre/re/post mutation-race test setup; model revision/parent changes without authorizing invalid graphs. |
| `src/runtime/server.ts` | `composeRuntime`, dependency factories | Open exactly one enabled service write session and pass one shared provider to JSON and MCP; retain absent providers in disabled mode. |
| `src/http/json-api.ts` | public failure union/mapping, write routes, `WriteSessionProvider` | Map `OUTCOME_UNKNOWN` to fixed HTTP 503 response and closed telemetry while preserving route/schema/success behavior. |
| `src/mcp/stateless-mcp.ts` | public error schema/mapping, tool outcome classification, write tools | Publish/return the same unknown error and telemetry classification; retain existing confirmation annotations and no transport-side Drive logic. |
| `src/codex-cli/cli.ts` | accepted error pairs, `output`, exit mapping | Strictly parse HTTP 503 unknown response, include read recovery for the known locator, and return exit 9 without retrying. |
| `src/observability/audit.ts` | `MarkdownApiAuditResult`, metric event union | Add only `outcome_unknown` to the closed terminal result vocabulary; do not add sensitive labels. |

## Entry point and call path

```text
authenticated JSON request / authenticated Work MCP tool / Codex CLI request
  -> transport input schema and existing principal verification
  -> one runtime-provided MarkdownWriteSession (only write.enabled)
  -> one MarkdownService create | update | archive operation
  -> task-001 scoped Drive read session: unique source/parent/archive snapshots + complete collision checks
  -> immediate fresh recheck
  -> task-002 guarded writer -> GoogleDriveWriteAdapter raw create | If-Match update | If-Match move (once)
  -> task-001 scoped postcondition snapshot
  -> verified metadata OR stable conflict/safe failure/OUTCOME_UNKNOWN
  -> JSON/MCP response and one closed terminal audit/metric classification
```

Runtime composition after task 002:

```text
GATEWAY_SERVICE_CONFIG_JSON -> parseServiceConfig(write.enabled)
  false -> one read service + disabled writer -> no JSON/MCP write session provider
  true  -> one read service + one server-authenticated guarded writer
        -> one frozen MarkdownWriteSession -> one shared provider for JSON and MCP
```

## Contracts, state, and invariants

- Task 001's final scoped `DriveReadPort`/session owns one request-local budget and fresh root/Shared
  Drive validation. Use it for every mutation lookup, enumeration, recheck, and postcheck; do not
  resurrect current `listDescendants`/direct-root search compatibility methods.
- A topology snapshot must preserve enough facts to compare the target and every ancestor: ID, name,
  kind, single parent, MIME/size, revision or modified fact, and unique same-name sibling proof.
  Archive needs independent source and archive snapshots plus proof that the old source parent no
  longer lists the moved ID.
- `Revision` remains opaque at the service boundary. The service compares expected/pre snapshot
  revisions exactly; `GoogleDriveWriteAdapter` alone validates/passes the raw quoted ETag as
  `If-Match`.
- `CreateWriteResult` and `ConditionalWriteResult` gain a post-dispatch unknown variant. `conflict`
  remains exclusive to conditional update/move 412; `unsupported` is a no-dispatch capability/input
  result. No result type permits a caller or transport to retry.
- Task 002's guarded writer/session has no `WriteLease`, JWS, probe evidence, client credential,
  raw HTTP, or serializable authority. It is a single server-side process-local capability.
- JSON/MCP success data remains metadata only. JSON unknown is 503 with the exact fixed message;
  MCP unknown is an error tool result with the same code/message. The CLI accepts that exact pair
  and returns exit 9 plus its existing safe locator recovery object.
- `MarkdownApiAuditResult` and `MarkdownMetricObservation` may add `outcome_unknown` only. Audit
  file IDs remain opaque/safe; paths, folder IDs, names, contents, revisions, raw statuses, headers,
  provider bodies, secrets, and dispatch details remain absent.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/application/markdown-service.ts` | strict path parsing, `resolveSegments`, ID chain resolution, node fact comparison, safe metadata conversion | Retain validation concepts but replace direct-root mutation checks with task 001's complete unique snapshots and explicit pre/post error split. |
| `src/drive/google-drive-write-adapter.ts` | narrow injected `GoogleDriveRawHttp`, multipart creation, `If-Match` update, parent move, no retry | Keep this adapter as sole mutation protocol owner; change only its result normalization to preserve uncertainty. |
| `src/drive/google-drive-read-adapter.ts` | root validation, normalized provider nodes, fatal UTF-8, parent enumeration | Task 001 refactors it to a scope; mutation work must consume that final scope rather than add unbounded provider calls. |
| `src/drive/guarded-drive-write-port.ts` | module-private `WeakMap` authentic writer capability | Use task 002's final no-lease form; guard helpers still dispatch raw methods exactly once. |
| `src/http/json-api.ts` / `src/mcp/stateless-mcp.ts` | optional `WriteSessionProvider`, fixed public failure mapping, telemetry isolation | Runtime supplies the same enabled session provider; extend the typed error/result mapping without leaking provider details. |
| `src/codex-cli/cli.ts` | exact response validation, machine JSON, locator-based conflict recovery, manual redirect/timeout handling | Add unknown pair/recovery/exit code without weakening strict response validation or automatic retry prohibition. |
| `src/observability/audit.ts` | closed typed audit/metric schemas | Add one terminal result atom only and preserve sink-failure isolation. |

## Tests and fixtures

| Path | Required coverage |
| --- | --- |
| `tests/application/markdown-service.test.ts` | nested operations, exact revisions, archive descendant/destination proof, already-archived no-op, all collision/topology failures, one-dispatch counts, and adversarial pre/re/post races including unknown postconditions. |
| `tests/drive/google-drive-write-adapter.test.ts` | exact raw request construction; 412 conflict only; non-412 status, throw, malformed response, and malformed 2xx as unknown; no retry. |
| `tests/drive/guarded-drive-write-port.test.ts` | task-002 authentic enabled writer dispatches once; disabled/forged/proxied writers dispatch zero; new result union propagates safely. |
| `tests/drive/google-drive-read-adapter.test.ts`, `tests/drive/in-memory-drive-port.ts` consumers | scoped topology facts and deterministic race hooks necessary for mutation pre/post checks, without external calls. |
| `tests/runtime/server.test.ts` | false config retains absent provider; true config sends the same service/session provider to JSON and MCP and composes no second Drive service/writer. |
| `tests/http/json-api.test.ts`, `tests/mcp/stateless-mcp.test.ts` | session delegation, JSON/MCP unknown parity, fixed/redacted response, exact single terminal telemetry result, disabled regression, timeout reconciliation behavior. |
| `tests/codex-cli/cli.test.ts` | exact HTTP 503 unknown parser, output recovery, exit 9, unchanged conflict/auth exits, no automatic retry. |
| `tests/domain/markdown.test.ts`, `tests/observability/audit.test.ts` | closed public/audit unknown vocabulary and absence of sentinel sensitive fields. |

Use synthetic opaque IDs, revisions, paths, and sentinel bodies only; no fixture may resemble a usable token, credential, or live Drive resource.

## Expected unchanged boundaries

- `src/auth/**`, gateway principal verification, credential formats/loaders, and Work/Codex principal separation remain unchanged. Gateway credentials never become Google credentials.
- `src/live-drive/**`, `tests/live-drive/**`, capability evidence, probe config, and live harness documents stay operator-only; task 003 neither invokes nor wires them into runtime.
- Terraform, deployment defaults/acknowledgement, Docker, secret provisioning, Drive ACLs, cloud configuration, and any live release test belong to task 002/operator gates/task 004, not this task.
- Public six-operation names, request shapes, success metadata/document shapes, HTTP route names, MCP tool names, and existing success statuses remain unchanged except for the added stable unknown error and CLI exit mapping.
- Work/Codex user guidance, release checklists, and final operator/client documentation are task 004 work. Do not create a live validation record.
- Feature status, `tasks.md`, build log, commits, vendored skills, package dependencies, and the product handoff are outside scope.

## Validation commands

Authoritative source: `AGENTS.md`, `package.json`, and `ARCHITECTURE.md`.

```bash
./scripts/verify-vendored-skills.sh
CI=true pnpm test -- tests/application/markdown-service.test.ts
CI=true pnpm test -- tests/drive/google-drive-write-adapter.test.ts tests/drive/guarded-drive-write-port.test.ts
CI=true pnpm test -- tests/runtime/server.test.ts tests/http/json-api.test.ts tests/mcp/stateless-mcp.test.ts tests/codex-cli/cli.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
CI=true pnpm check
git diff --check
```

Do not run `pnpm drive:probe`, Terraform, Docker, `gcloud`, OAuth/JWKS requests, or live
Drive/Work/Codex calls.

## Selected external material

None. Binding inputs are the approved feature/task artifacts, handoff, repository instructions,
and committed HEAD `e36ccaba9d7070e35b146bfd965e62880f8b7a8f`. No moving external reference is
selected as policy.

## Uncertainties to verify

- Task 001/002 implementation may choose different internal names for scoped reads, snapshots,
  writer creation, and runtime factory injection. Verify their final symbols immediately before
  editing; preserve the contracts stated here rather than copying pre-task current code.
- Confirm the Google raw transport's timeout/abort semantics cannot prove a request was not
  received after `send()` begins. Preserve `unknown` and no retry if a fake or library surface makes
  this distinction awkward.
- Confirm final response/body-size protection still permits the fixed unknown JSON/MCP error. If a
  serializer changes, keep the exact fixed public pair and reduce no safety limit to make it pass.
