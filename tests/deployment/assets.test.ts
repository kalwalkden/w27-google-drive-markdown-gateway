import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const readAsset = (path: string) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

describe("deployment assets", () => {
  it("builds a compiled Node 24 image as a non-root user with a narrow context", async () => {
    const [dockerfile, dockerignore] = await Promise.all([
      readAsset("Dockerfile"),
      readAsset(".dockerignore"),
    ]);
    expect(dockerfile).toMatch(/FROM node:24-slim AS dependencies/);
    expect(dockerfile).toMatch(/FROM node:24-slim AS runtime/);
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("pnpm build");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain('CMD ["node", "dist/runtime/entry.js"]');
    expect(dockerignore).toContain("**");
    expect(dockerignore).not.toContain("!node_modules");
    expect(dockerignore).not.toContain("!.env");
  });

  it("defines guarded Cloud Run v2 infrastructure with mounted existing secrets", async () => {
    const [cloudRun, secrets, outputs, variables] = await Promise.all([
      readAsset("infra/terraform/cloud-run.tf"),
      readAsset("infra/terraform/secrets.tf"),
      readAsset("infra/terraform/outputs.tf"),
      readAsset("infra/terraform/variables.tf"),
    ]);
    expect(cloudRun).toContain(
      'resource "google_cloud_run_v2_service" "gateway"',
    );
    expect(cloudRun).toContain('path = "/healthz"');
    expect(cloudRun).toContain("startup_probe");
    expect(cloudRun).toContain("container_port = 8080");
    expect(cloudRun).not.toMatch(/name\s+=\s+"PORT"/u);
    expect(cloudRun).toContain('dynamic "volume_mounts"');
    expect(cloudRun).toContain("acknowledge_public_invoker");
    expect(cloudRun).toContain("acknowledge_production_service_apply");
    expect(cloudRun).toContain(
      "google_secret_manager_secret_iam_member.codex_bearer",
    );
    expect(cloudRun).toContain("google_secret_manager_secret_iam_member.oauth");
    expect(cloudRun).toContain("allow_public_invoker ? 1 : 0");
    expect(cloudRun).toContain(
      "maxRequestMarkdownBytes           = var.max_request_markdown_bytes",
    );
    expect(cloudRun).toContain(
      "maxResultItems                    = var.max_result_items",
    );
    for (const projection of [
      "maxPathDepth      = var.max_path_depth",
      "maxMetadataChecks = var.max_metadata_checks",
      "maxContentSearchFiles = var.max_content_search_files",
    ]) {
      expect(cloudRun.split(projection)).toHaveLength(3);
    }
    expect(cloudRun).toContain("enabled = var.enable_write");
    expect(secrets).toContain("roles/secretmanager.secretAccessor");
    expect(secrets).not.toMatch(/secret_data|service_account_key/u);
    expect(outputs).not.toMatch(/secret|config|token|service_account/iu);
    expect(cloudRun).toMatch(
      /count = var\.allow_public_invoker \? 1 : 0[\s\S]*member\s+= "allUsers"/u,
    );
    for (const variable of [
      "work_mcp_audience",
      "work_mcp_issuer",
      "work_mcp_jwks_url",
      "work_mcp_allowed_algorithms",
      "work_mcp_clock_tolerance_seconds",
      "work_mcp_jwks_timeout_ms",
      "work_mcp_jwks_cache_max_age_ms",
      "max_request_markdown_bytes",
      "max_result_items",
      "max_json_body_bytes",
      "max_json_response_bytes",
      "rate_limit_window_ms",
      "max_concurrent_requests_per_principal",
      "max_rate_limit_principals",
      "max_path_depth",
      "max_metadata_checks",
      "max_content_search_files",
      "enable_write",
      "acknowledge_write_risk",
    ]) {
      expect(variables).toContain(`variable "${variable}"`);
    }
    expect(variables).toContain("^https://[^/?#@]+(/[^?#]*)?$");
    expect(cloudRun).toContain(
      "max_json_body_bytes >= var.max_request_markdown_bytes * 6 + 4096",
    );
    expect(cloudRun).toContain("max_result_items <= var.max_results");
    expect(cloudRun).toContain(
      "!var.enable_write || var.acknowledge_write_risk",
    );
    expect(cloudRun).toContain(
      "max_content_search_files <= var.max_traversal_nodes",
    );
    expect(cloudRun).toContain(
      'var.cpu != "1" || contains(["512Mi", "1Gi", "2Gi", "4Gi"], var.memory)',
    );
    expect(variables).toContain('"512Mi", "1Gi", "2Gi", "4Gi", "8Gi"');
  });

  it("documents deployment, rotation, health checks, and rollback without credential examples", async () => {
    const document = await readAsset("docs/cloud-run-deployment.md");
    for (const heading of [
      "Rotation",
      "healthz",
      "Rollback",
      "Secret Manager",
    ]) {
      expect(document).toContain(heading);
    }
    expect(document).not.toMatch(
      /-----BEGIN|refresh_token\s*[:=]\s*["'][^"']+/iu,
    );
    expect(document).toContain("google_artifact_registry_repository.gateway");
    expect(document).toContain("bootstrap.invalid/gateway@sha256:");
    expect(document).toContain(
      "Do not import the repository after this bootstrap.",
    );
    expect(document).toContain("acknowledge_production_service_apply=true");
    expect(document).toContain("acknowledge_public_invoker");
    expect(document).toContain("acknowledge_write_risk");
  });
});
