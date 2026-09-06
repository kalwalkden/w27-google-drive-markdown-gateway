# Cloud Run Container and Infrastructure

## Status

Approved

## Context

The authenticated service needs repeatable Cloud Run deployment while secrets and production identities stay out of repository state.

## Objective

Add Docker and Terraform definitions for a least-privilege Cloud Run service with Artifact Registry, service identity, Secret Manager mounts, and safe runtime defaults.

## Scope

Define container build/start behavior for Node 24, Cloud Run v2 settings, dedicated service account/IAM, secret-volume references without values, ingress, concurrency/timeout/scaling defaults, and deployment/operator documentation.

## Non-goals / later

No secret creation with payloads, CI provider selection, custom domain, broad network access, or automatic production rollout.

## Constraints / caveats

Use mounted secrets for rotation-sensitive credentials. Terraform may reference names/versions but must never create or print secret values. Preserve a deliberate operator gate for production apply.

## Dependent tasks or work

Depends on the JSON service composition and its typed configuration.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — Cloud Run, Secret Manager, and least-access architecture baseline.

## Expected change surface

Docker build assets, `infra/terraform/`, deploy documentation, and container smoke coverage. Application API behavior remains unchanged.

## Open Questions

None.

