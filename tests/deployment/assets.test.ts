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
    const [cloudRun, secrets, outputs] = await Promise.all([
      readAsset("infra/terraform/cloud-run.tf"),
      readAsset("infra/terraform/secrets.tf"),
      readAsset("infra/terraform/outputs.tf"),
    ]);
    expect(cloudRun).toContain(
      'resource "google_cloud_run_v2_service" "gateway"',
    );
    expect(cloudRun).toContain('path = "/healthz"');
    expect(cloudRun).toContain("startup_probe");
    expect(cloudRun).toContain('dynamic "volume_mounts"');
    expect(cloudRun).toContain("acknowledge_public_invoker");
    expect(cloudRun).toContain("allow_public_invoker ? 1 : 0");
    expect(secrets).toContain("roles/secretmanager.secretAccessor");
    expect(secrets).not.toMatch(/secret_data|service_account_key/u);
    expect(outputs).not.toMatch(/secret|config|token|service_account/iu);
    expect(cloudRun).toMatch(
      /count = var\.allow_public_invoker \? 1 : 0[\s\S]*member\s+= "allUsers"/u,
    );
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
  });
});
