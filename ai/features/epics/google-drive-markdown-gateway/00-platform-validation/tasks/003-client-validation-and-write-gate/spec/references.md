# Client Validation and Write Gate — References

## Primary edit targets

Task 003 has no implementation. Task 002 is concurrently adding evidence; inspect final exports before coding.

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `src/live-drive/evidence.ts` | strict `LiveDriveEvidence` parser | Reuse task-002 schema; do not duplicate it. |
| `src/write-gate/evidence-proof.ts` | atomic-proof validator | Semantic validation of task-002 evidence. |
| `src/write-gate/approval.ts` | strict `WriteApproval` parser | Closed JWS payload contract. |
| `src/write-gate/jws.ts` | `JwsVerifier` | Compact Ed25519 verification boundary. |
| `src/write-gate/gate.ts` | gate decision and lease | Default-deny owner. |
| `src/write-gate/replay-store.ts` | `ConsumedApprovalStore` | Durable-store port and test fake. |
| `src/write-gate/trust.ts` | trust and `Clock` | Deployment-owned policy. |
| `src/write-gate/audit.ts` | safe reason mapping | No-disclosure diagnostics. |
| `tests/write-gate/*.test.ts` | gate tests | Evidence/JWS/freshness/replay/lease/redaction/import safety. |
| `docs/write-gate-and-client-validation.md` | operator runbook | Signing/provisioning and Work/Codex validation. |
| `docs/write-approval.payload.example.json` | unsigned synthetic template | Schema documentation only. |
| `docs/client-validation-record.example.json` | synthetic client-check template | Future release evidence format. |
| `package.json`, `pnpm-lock.yaml` | JWS dependency | Minimal audited verification dependency only. |

## Entry point and call path

Current: `tests/index.test.ts` -> `createApp()` in `src/index.ts` -> fresh Express app. Task 002: live-drive CLI -> raw probe -> sanitized evidence outside repo. Future: authenticated mutation handler -> `MarkdownService` mutation boundary -> `WriteGate.evaluate()` -> evidence proof + JWS + runtime binding + consume-once store -> opaque lease -> Drive adapter. This task adds none of handler/service/adapter/config loader.

## Contracts, state, and invariants

- `LiveDriveEvidence`: task-002 strict sanitized schema; eligible only with `SUPPORTED`, archive cleanup, and both stale `If-Match`/412/unchanged proofs.
- `WriteApproval`: binds exact evidence SHA-256, environment, opaque Drive fingerprint, auth/topology, timestamps, and approval ID.
- `RuntimeWriteGateTrust`: deployment-owned expected environment, topology/auth mode, fingerprint, keys, lifetime, and skew; never Git/request supplied.
- `JwsVerifier`: protected compact EdDSA only, configured `kid` only.
- `ConsumedApprovalStore`: atomic record before lease; test memory only, production later external.
- `WriteLease`: opaque/short-lived; future mutations require it; reads do not.

Absent, malformed, unsupported, inconclusive, stale, untrusted, mismatched, replayed, or cleanup-failed evidence/approval is denial. `version`/`headRevisionId` never substitute for atomic proof. No source-controlled setting enables writes. Audit excludes evidence/Drive values, content, credentials, JWS/key material, headers, and paths.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/index.ts` | import-safe no-I/O factory | Keep gate pure/unwired here. |
| `tests/index.test.ts` | finite no-I/O Vitest test | Inject clock/verifier/store fakes. |
| task-002 `src/live-drive/evidence.ts` | strict sanitized serialization | Sole evidence source/parser. |
| task-002 evidence tests | fake/redacted records | Cross-contract fixtures. |
| `package.json` | finite local `check` | Keep external checks out of automation. |
| `AGENTS.md` | credential/revision policy | Do not add trust material/artifacts. |

## Tests and fixtures

`tests/write-gate/evidence-proof.test.ts`: stale proof/cleanup semantics. `approval.test.ts`: closed payload/digest/scope/time. `jws.test.ts`: generated Ed25519 key and invalid header/key/algorithm/tampering cases. `gate.test.ts`: default deny/policy/replay/store/lease. `audit.test.ts`: reason code/redaction. `import-safety.test.ts`: no I/O. Use generated keys and obviously fake data only.

## Expected unchanged boundaries

Keep `src/index.ts`, `tests/index.test.ts`, task-002 behavior, handoff, statuses, vendored skills, and `pnpm check` unchanged. Do not add production Drive, service, JSON/MCP, plugin, Codex CLI, credentials, Cloud Run/Terraform, or actual client validation. Commit no credential, trust key/value, evidence, approval, or environment config.

## Selected external references

| Source | Applicability |
| --- | --- |
| [RFC 7515 — JSON Web Signature](https://www.rfc-editor.org/rfc/rfc7515) | Compact JWS/protected-header integrity. |
| [RFC 8037 — EdDSA for JWA/JWK](https://www.rfc-editor.org/rfc/rfc8037) | Ed25519/EdDSA JOSE constraints. |
| [RFC 8725 — JWT Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725) | Algorithm allowlisting/substitution defenses. |
| [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth) | Later Work OAuth/JWT validation. |
| [OpenAI Codex cloud internet access](https://learn.chatgpt.com/docs/cloud/internet-access) | Later narrow hostname/method validation. |

Task-002 Google Drive and RFC 9110 sources govern raw proof; task 003 does not reinterpret Drive HTTP.

## Validation commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
./scripts/verify-vendored-skills.sh
pnpm check
git diff --check
```

No signing, live probe, Work/OAuth check, Codex call, credential lookup, or network request belongs in CI.

## Uncertainties to verify

Inspect task-002 final module names, parser, check IDs, and `probeVersion` before implementation. If it cannot prove both stale 412/readback conditions, correct task 002 or revise an approved task package; do not accept weaker evidence. Durable replay and external trust provisioning are later tasks; confirm transactional semantics before wiring a live mutation path.
