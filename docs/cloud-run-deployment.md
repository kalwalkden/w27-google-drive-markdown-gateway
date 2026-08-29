# Cloud Run deployment

This guide is for an approved operator deploying the gateway. It does not create secret
payloads, assign Drive permissions, or apply Terraform automatically. The default deployment is
read-only; a separately reviewed revision may compose the server-side writer.

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

Work JWT verification also requires a finite issued-at (`iat`) and expiry (`exp`) claim. The
deployment-owned `work_mcp_max_token_lifetime_seconds` setting defaults to 3600 seconds and must
match the identity owner's approved issuance policy. Clock tolerance applies only when comparing
those claims to the gateway clock; it does not extend the signed issued-to-expiry lifetime.

## Prepare and review a deployment

1. Copy `infra/terraform/terraform.tfvars.example` to an operator-controlled location outside the
   repository. Supply only deployment identifiers, public JWT settings, Drive IDs, and the two
   applicable acknowledgements. For the registry bootstrap, set `container_image` to a syntactically
   valid placeholder digest; Terraform validates required inputs before it honors the target, but the
   targeted plan never creates a Cloud Run revision from that placeholder.
2. From `infra/terraform`, run `terraform init`, `terraform fmt -check`, and `terraform validate`.
   Then review and apply a deliberately scoped bootstrap plan using
   `-target=google_artifact_registry_repository.gateway`. This one-time bootstrap creates the
   destination repository in Terraform state before any image push; it does not create or change the
   Cloud Run service. For example, with the external non-secret variable file, use a placeholder
   only for this targeted operation:

   ```sh
   terraform plan -target=google_artifact_registry_repository.gateway -var-file=/operator/path/gateway.tfvars -var='container_image=bootstrap.invalid/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000000'
   terraform apply -target=google_artifact_registry_repository.gateway -var-file=/operator/path/gateway.tfvars -var='container_image=bootstrap.invalid/gateway@sha256:0000000000000000000000000000000000000000000000000000000000000000'
   ```

   Do not import the repository after this bootstrap.
3. Build and push the image to that created repository using the repository `Dockerfile`, then
   record its immutable digest. Set `container_image` to that digest; do not use a mutable tag.
4. Review a full Terraform plan with `acknowledge_production_service_apply=true`. It is required
   before Terraform can create or change the production Cloud Run service, and is separate from the
   public-invoker acknowledgement. Provider initialization and all cloud access are operator
   actions; they are deliberately not repository tests.
5. Confirm that the plan grants `roles/secretmanager.secretAccessor` only to the runtime service
   account and only on the named existing secret objects. It must create no service-account key,
   secret payload, project-wide Drive role, or broad Owner/Editor role.
6. Apply the reviewed full plan only after normal change approval. The service acknowledgement is
   false by default and must remain false for registry-only bootstrap work. `allow_public_invoker`
   also defaults to false; set it and `acknowledge_public_invoker` to true only if public Cloud Run
   invocation has been explicitly approved. Otherwise arrange an approved identity-aware ingress or
   explicit invoker binding. Application bearer/OAuth verification remains mandatory in either case.

Writes remain disabled unless both `enable_write=true` and `acknowledge_write_risk=true` appear in
the reviewed plan; both inputs are explicitly `false` in the example configuration. The second
acknowledgement is required for an enabled revision and is separate from the service-apply
acknowledgement. Before setting them, review the marked dedicated root/archive, the provider
capability evidence digest, the immutable container image digest, the canonical non-secret runtime
configuration digest, the server-side Drive identity and scope, and Drive ACLs. An enabled plan is
not proof of a live Drive operation or ACL correctness. Work JWT and Codex bearer credentials
authenticate only to the gateway; they never authenticate to Google. My Drive OAuth may have a
broader Google grant than the configured root, so this is an explicit operator risk.

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

The default revision reports `UNSUPPORTED` for unavailable writes. A controlled write-enabled
revision is eligible for separate provider, Work, and Codex validation only after the independent
release gates in [write-gate-and-client-validation.md](write-gate-and-client-validation.md). Those
checks are release evidence, never runtime authority.

## Rollback and cleanup

Rollback by assigning traffic to a prior known-good Cloud Run revision, or by deploying a reviewed
immutable image/config pair with `enable_write=false` through the normal reviewed plan. Recheck
`/healthz`, protected-route rejection, and that writes remain disabled after rollback. Do not
delete credentials, evidence, or Drive data as part of rollback.

Do not automatically delete Secret Manager versions, secret containers, or Drive data during
rollback or teardown. Review retained revisions, state, Secret Manager retention policy, Artifact
Registry retention, and Drive administrator access separately before any cleanup.
