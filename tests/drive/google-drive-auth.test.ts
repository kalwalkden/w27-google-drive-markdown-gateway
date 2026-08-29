import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { describe, expect, it } from "vitest";

import {
  createGoogleDriveApi,
  createGoogleDriveAuth,
} from "../../src/drive/google-drive-auth.js";

describe("createGoogleDriveAuth", () => {
  it("builds an ADC credential without acquiring a token", () => {
    const auth = createGoogleDriveAuth({ mode: "shared-drive-adc" });
    expect(auth).toBeInstanceOf(GoogleAuth);
  });

  it("uses injected refresh credentials without loading a secret source", () => {
    const auth = createGoogleDriveAuth({
      mode: "my-drive-refresh-token",
      credentials: {
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "refresh",
      },
    });
    expect(auth).toBeInstanceOf(OAuth2Client);
  });

  it("keeps media response options out of the Drive query parameters", async () => {
    const calls: unknown[][] = [];
    const api = createGoogleDriveApi({ mode: "shared-drive-adc" }, () => ({
      files: {
        get: async (...args: unknown[]) => {
          calls.push(args);
          return { data: new Uint8Array() };
        },
        list: async () => ({ data: {} }),
      },
    }));
    await api.files.get({
      fileId: "file",
      alt: "media",
      responseType: "arraybuffer",
    });
    expect(calls).toEqual([
      [{ fileId: "file", alt: "media" }, { responseType: "arraybuffer" }],
    ]);
  });
});
