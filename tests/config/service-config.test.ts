import { describe, expect, it } from "vitest";

import { parseServiceConfig } from "../../src/config/service-config.js";

function validConfig() {
  return {
    drive: {
      authMode: "shared-drive-adc",
      rootFolderId: "root-folder",
      archiveFolderId: "archive-folder",
      sharedDriveId: "shared-drive",
      maxMarkdownBytes: 1_000_000,
      maxTraversalNodes: 1_000,
      maxPages: 10,
      maxResults: 100,
    },
    authentication: {
      workMcp: {
        issuer: "https://issuer.invalid/tenant",
        audience: "gateway-audience",
        jwksUrl: "https://keys.invalid/tenant/jwks",
        allowedAlgorithms: ["RS256", "EdDSA"],
        clockToleranceSeconds: 15,
        jwksTimeoutMs: 5_000,
        jwksCacheMaxAgeMs: 60_000,
      },
      codex: { bearerSecretFile: "/var/run/secrets/codex-bearer" },
    },
  };
}

describe("service configuration", () => {
  it("parses both supported Drive authentication shapes without reading references", () => {
    const shared = parseServiceConfig(validConfig());
    expect(shared.drive).toMatchObject({
      authMode: "shared-drive-adc",
      rootFolderId: "root-folder",
      archiveFolderId: "archive-folder",
    });

    const myDrive = {
      ...validConfig(),
      drive: {
        authMode: "my-drive-refresh-token",
        rootFolderId: "root-folder",
        archiveFolderId: "archive-folder",
        oauthSecretFile: "/var/run/secrets/my-drive-oauth",
        maxMarkdownBytes: 1_000_000,
        maxTraversalNodes: 1_000,
        maxPages: 10,
        maxResults: 100,
      },
    };
    expect(parseServiceConfig(myDrive).drive).toMatchObject({
      authMode: "my-drive-refresh-token",
      oauthSecretFile: "/var/run/secrets/my-drive-oauth",
    });
  });

  it("rejects unknown keys and invalid Drive mode combinations", () => {
    expect(() =>
      parseServiceConfig({ ...validConfig(), unexpected: true }),
    ).toThrow();
    expect(() =>
      parseServiceConfig({
        ...validConfig(),
        drive: { ...validConfig().drive, oauthSecretFile: "/a" },
      }),
    ).toThrow();
    expect(() =>
      parseServiceConfig({
        ...validConfig(),
        drive: {
          ...validConfig().drive,
          archiveFolderId: "root-folder",
        },
      }),
    ).toThrow();
    expect(() =>
      parseServiceConfig({
        ...validConfig(),
        drive: { ...validConfig().drive, maxPages: 0 },
      }),
    ).toThrow();
  });

  it("rejects unsafe issuer, JWKS, algorithm, and secret reference values", () => {
    for (const issuer of [
      "http://issuer.invalid",
      "https://user@issuer.invalid",
      "https://issuer.invalid/path?query=value",
      "https://issuer.invalid/path#fragment",
    ]) {
      expect(() =>
        parseServiceConfig({
          ...validConfig(),
          authentication: {
            ...validConfig().authentication,
            workMcp: { ...validConfig().authentication.workMcp, issuer },
          },
        }),
      ).toThrow();
    }
    expect(() =>
      parseServiceConfig({
        ...validConfig(),
        authentication: {
          ...validConfig().authentication,
          workMcp: {
            ...validConfig().authentication.workMcp,
            allowedAlgorithms: ["RS256", "RS256"],
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseServiceConfig({
        ...validConfig(),
        authentication: {
          ...validConfig().authentication,
          workMcp: {
            ...validConfig().authentication.workMcp,
            allowedAlgorithms: ["HS256"],
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseServiceConfig({
        ...validConfig(),
        authentication: {
          ...validConfig().authentication,
          codex: { bearerSecretFile: "relative-secret" },
        },
      }),
    ).toThrow();
  });
});
