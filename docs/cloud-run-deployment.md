# Cloud Run deployment

This guide is for an approved operator deploying the read-only gateway. It does not create secret
payloads, assign Drive permissions, or apply Terraform automatically.

## Prerequisites and access boundaries

Choose one Drive mode before preparing inputs:

- `shared-drive-adc` attaches the dedicated Cloud Run runtime service account. A Drive
  administrator must grant that identity access only to the selected Shared Drive or configured
  root/archive hierarchy. Project IAM does not grant Drive folder access.
- `my-drive-refresh-token` uses an existing Secret Manager OAuth credential object mounted as a
  file. The runtime service account still has no service-account key.

The deployment operator needs organization-approved access to Artifact Registry, Secret Manager,
Cloud Run, and the Terraform state backend. Google Cloud APIs are enabled outside this module to
respect organization policy. Local checks require Node 24 with pnpm and Terraform; image publishing
also requires an approved container build environment and Google Cloud CLI.

Create secret containers and versions through the approved secret-management process. Never put a
bearer credential, OAuth credential object, refresh token, client secret, or service-account key
in a Terraform variable, `tfvars` file, image layer, shell history, or log. This module accepts
only existing secret identifiers and mounted versions.

## Prepare and review a deployment

1. Copy `infra/terraform/terraform.tfvars.example` to an operator-controlled location outside the
   repository. Supply only deployment identifiers, public JWT settings, Drive IDs, and an immutable
   Artifact Registry image digest.
2. Build and push the image using the repository `Dockerfile`, then record its immutable digest.
   Do not use a mutable image tag for `container_image`.
3. From `infra/terraform`, run `terraform init`, then `terraform fmt -check`,
   `terraform validate`, and a reviewed `terraform plan` with the external variable file. Provider
   initialization and all cloud access are operator actions; they are deliberately not repository
   tests.
4. Confirm that the plan grants `roles/secretmanager.secretAccessor` only to the runtime service
   account and only on the named existing secret objects. It must create no service-account key,
   secret payload, project-wide Drive role, or broad Owner/Editor role.
5. Apply only after normal change approval. `allow_public_invoker` defaults to false. Set it and
   `acknowledge_public_invoker` to true only if public Cloud Run invocation has been explicitly
   approved. Otherwise arrange an approved identity-aware ingress or explicit invoker binding.
   Application bearer/OAuth verification remains mandatory in either case.

The Cloud Run service mounts the Codex bearer file for every mode. My Drive additionally mounts its
OAuth credential only when selected. The service config contains the mount paths, never their
contents. The startup probe calls `GET /healthz`; it proves process composition only and does not
test Drive access.

## Rotation and verification

Rotate the Codex bearer by updating its existing mounted Secret Manager secret according to the
approved secret process. The application reads it for each verification, so no application image
rebuild is required. For My Drive, rotate the mounted OAuth credential through Secret Manager and
perform a controlled Cloud Run revision restart so the new mount is observed. Shared Drive ADC
identity rotation is handled through the approved workload/service-account process, not a key file.

After deployment, verify only:

- `GET /healthz` succeeds without provider I/O;
- a protected route without authorization is rejected; and
- any Drive test-folder operation is performed only under the existing live capability-harness
  controls, with an approved operator and no authorization header copied into shell history or logs.

The production runtime intentionally supplies no write session. Protected write endpoints remain
`UNSUPPORTED`; credential rotation and deployment do not enable writes.

## Rollback and cleanup

Rollback by assigning traffic to a prior known-good Cloud Run revision, or by deploying a prior
immutable image digest through the normal reviewed plan. Recheck `/healthz`, protected-route
rejection, and that writes remain disabled after rollback.

Do not automatically delete Secret Manager versions, secret containers, or Drive data during
rollback or teardown. Review retained revisions, state, Secret Manager retention policy, Artifact
Registry retention, and Drive administrator access separately before any cleanup.
