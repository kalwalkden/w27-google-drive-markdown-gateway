# Threat Model and Observability Contract

## Status

Approved

## Context

The gateway handles sensitive specifications and credentials while exposing write operations to two external principals.

## Objective

Define the threat model and durable observability contract that guide hardening without adding new product scope.

## Scope

Document trust boundaries, assets, threats, mitigations, audit/metric fields, sensitive-data redaction rules, operational ownership, and alert-relevant service failure categories; add focused tests where the existing logging boundary can prove redaction.

## Non-goals / later

No security certification, SIEM integration, new user roles, or automatic incident remediation.

## Constraints / caveats

Threat assumptions must reflect the actual Shared Drive/My Drive credential modes, external JWT issuer, Codex bearer credential, Cloud Run service identity, and no-permanent-delete contract.

## Dependent tasks or work

Depends on service audit logging and deployment design.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — security rules and required audit metadata.

## Expected change surface

`docs/` threat/operations documentation, observability contracts, and targeted redaction tests. No new Drive operation.

## Open Questions

None.

