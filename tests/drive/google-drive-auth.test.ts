import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { describe, expect, it } from "vitest";

import {
  createGoogleDriveAuthenticatedRawHttp,
  createGoogleDriveApi,
  createGoogleDriveAuth,
} from "../../src/drive/google-drive-auth.js";

describe("createGoogleDriveAuth", () => {
  it("builds an ADC credential without acquiring a token", () => {
    const auth = createGoogleDriveAuth({ mode: "shared-drive-adc" });
    expect(auth).toBeInstanceOf(GoogleAuth);
  });

  it("selects exactly one scope for read and write auth", () => {
    const read = createGoogleDriveAuth(
      { mode: "shared-drive-adc" },
      "read",
    ) as unknown as {
      scopes: readonly string[];
    };
    const write = createGoogleDriveAuth(
      { mode: "shared-drive-adc" },
      "write",
    ) as unknown as {
      scopes: readonly string[];
    };
    expect(read.scopes).toEqual([
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
    expect(write.scopes).toEqual(["https://www.googleapis.com/auth/drive"]);
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

  it("adds one server token at dispatch, preserves adapter data, and never retries", async () => {
    let tokenCalls = 0;
    const calls: Array<{
      url: URL;
      init: { headers: Headers; redirect: string; body: Uint8Array };
    }> = [];
    const http = createGoogleDriveAuthenticatedRawHttp(
      { mode: "shared-drive-adc" },
      {
        tokenProvider: {
          async getAccessToken() {
            tokenCalls += 1;
            return "test-token";
          },
        },
        send: async (url, init) => {
          calls.push({ url, init });
          return {
            status: 200,
            headers: new Headers({ etag: '"rev"' }),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        },
      },
    );
    await http.send({
      method: "PATCH",
      url: new URL("https://www.googleapis.com/drive/v3/files/file"),
      headers: { "if-match": '"rev"' },
      body: new Uint8Array([1]),
    });
    expect(tokenCalls).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.headers.get("authorization")).toBe(
      "Bearer test-token",
    );
    expect(calls[0]?.init.headers.get("if-match")).toBe('"rev"');
    expect(calls[0]?.init.redirect).toBe("error");
    expect(calls[0]?.init.body).toEqual(new Uint8Array([1]));
  });
});
