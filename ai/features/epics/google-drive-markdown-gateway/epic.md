# Google Drive Markdown Gateway

## Status

Approved

## Goal

Deliver a narrow, secure Google Drive Markdown gateway on Cloud Run for ChatGPT Work and Codex cloud.

## Direction

Use strict TypeScript on Node 24 with pnpm, Express, the official TypeScript MCP SDK, `googleapis`, Zod, Pino, Vitest, Biome, Docker, and Terraform. One `MarkdownService` owns all document behavior; HTTP, MCP, and diagnostics CLI adapters delegate to it.

## Non-goals

General Drive access, Google Workspace document editing, sharing changes, permanent deletion, credentials in the repository, and a general integration platform.

## Features

- [x] 00-platform-validation — Establish the reproducible safety and live-platform proof gates.
- [ ] 01-drive-core — Implement folder-confined Markdown operations behind one application boundary.
- [x] 02-authenticated-service-api — Add authenticated JSON HTTPS service, auditability, and deployment.
- [ ] 03-chatgpt-work-plugin — Expose the same service through stateless remote MCP.
- [ ] 04-codex-cloud-client — Provide a diagnostics and fallback CLI with Codex cloud setup guidance.
- [ ] 05-operational-hardening — Add resilience coverage, observability, recovery, and rotation practices.
- [ ] 06-migrate-planning-files — Migrate and verify the agreed Drive-backed planning workflow.

