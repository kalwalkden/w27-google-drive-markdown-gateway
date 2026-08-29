# Codex Cloud Client

## Status

Approved

## Requirements

Provide a checked-in CLI as a diagnostics and fallback client for the JSON API. It must offer safe, machine-readable outputs and Codex cloud configuration/runbook guidance.

## Constraints

The CLI is not a second Drive implementation and is not the primary product interface. It uses only a scoped Codex credential supplied by the environment, never Google credentials. Domain allowlisting stays limited to the gateway hostname and required HTTP methods.

## Success Criteria

A clean, configured Codex cloud environment can use the CLI for all six operations, safely handle conflicts, and emit stable JSON and exit behavior.

## Non-goals / out of scope

Direct Drive calls from Codex, automatic Internet broadening, or changes to `AGENTS.md`.

## Implementation Map

The CLI will consume the JSON contract from `02-authenticated-service-api`; `docs/codex-cloud-preflight.md` establishes the repository's existing cloud-readiness guidance.

## Open Questions

None.

