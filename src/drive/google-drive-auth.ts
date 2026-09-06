import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

import type {
  GoogleDriveRawHttp,
  GoogleDriveRawHttpRequest,
  GoogleDriveRawHttpResponse,
} from "./google-drive-write-adapter.js";

const driveReadScope = "https://www.googleapis.com/auth/drive.readonly";
const driveWriteScope = "https://www.googleapis.com/auth/drive";

export type GoogleDriveAccess = "read" | "write";

export interface RefreshTokenCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export type GoogleDriveAuthConfig =
  | { readonly mode: "shared-drive-adc" }
  | {
      readonly mode: "my-drive-refresh-token";
      readonly credentials: RefreshTokenCredentials;
    };

export interface GoogleDriveApi {
  readonly files: {
    get(
      request: Readonly<Record<string, unknown>>,
    ): Promise<GoogleDriveApiResponse>;
    list(
      request: Readonly<Record<string, unknown>>,
    ): Promise<GoogleDriveApiResponse>;
  };
}

export interface GoogleDriveApiResponse {
  readonly data: unknown;
  readonly headers?: unknown;
}

export interface GoogleDriveAccessTokenProvider {
  getAccessToken(): Promise<string | undefined>;
}

export type GoogleDriveFetch = (
  input: URL,
  init: Readonly<{
    method: "POST" | "PATCH";
    headers: Headers;
    body: Uint8Array;
    redirect: "error";
  }>,
) => Promise<{
  readonly status: number;
  readonly headers: Headers;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

interface GoogleDriveSdkClient {
  readonly files: {
    get(params: unknown, options?: unknown): Promise<GoogleDriveApiResponse>;
    list(params: unknown): Promise<GoogleDriveApiResponse>;
  };
}

/** Builds an unaquired credential; Google obtains a token only when a request is sent. */
export function createGoogleDriveAuth(
  config: GoogleDriveAuthConfig,
  access: GoogleDriveAccess = "read",
): GoogleAuth | OAuth2Client {
  if (config.mode === "shared-drive-adc") {
    return new GoogleAuth({
      scopes: [access === "read" ? driveReadScope : driveWriteScope],
    });
  }

  const client = new OAuth2Client(
    config.credentials.clientId,
    config.credentials.clientSecret,
  );
  client.setCredentials({ refresh_token: config.credentials.refreshToken });
  return client;
}

function createAccessTokenProvider(
  auth: GoogleAuth | OAuth2Client,
): GoogleDriveAccessTokenProvider {
  return {
    async getAccessToken() {
      if (auth instanceof GoogleAuth)
        return (await auth.getAccessToken()) ?? undefined;
      return (await auth.getAccessToken()).token ?? undefined;
    },
  };
}

/**
 * Composes the server-side write credential at the raw Drive boundary. It does
 * not acquire a token until an adapter dispatches one mutation request.
 */
export function createGoogleDriveAuthenticatedRawHttp(
  config: GoogleDriveAuthConfig,
  dependencies: Readonly<{
    tokenProvider?: GoogleDriveAccessTokenProvider;
    send?: GoogleDriveFetch;
  }> = {},
): GoogleDriveRawHttp {
  const tokenProvider =
    dependencies.tokenProvider ??
    createAccessTokenProvider(createGoogleDriveAuth(config, "write"));
  const send =
    dependencies.send ??
    ((input, init) =>
      fetch(input, {
        ...init,
        body: init.body as unknown as BodyInit,
      }));
  return {
    async send(
      request: GoogleDriveRawHttpRequest,
    ): Promise<GoogleDriveRawHttpResponse> {
      const token = await tokenProvider.getAccessToken();
      if (!token) throw new Error("Google access token unavailable.");
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${token}`);
      const response = await send(request.url, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "error",
      });
      return {
        status: response.status,
        headers: response.headers,
        body: new Uint8Array(await response.arrayBuffer()),
      };
    },
  };
}

/** Keeps Google-generated SDK types at the provider seam. */
export function createGoogleDriveApi(
  config: GoogleDriveAuthConfig,
  createClient: (auth: GoogleAuth | OAuth2Client) => GoogleDriveSdkClient = (
    auth,
  ) => google.drive({ version: "v3", auth: auth as never }),
): GoogleDriveApi {
  const client = createClient(createGoogleDriveAuth(config));
  return {
    files: {
      get: async (request) => {
        const { responseType, ...params } = request;
        return client.files.get(
          params as never,
          responseType === "arraybuffer" ? ({ responseType } as never) : {},
        );
      },
      list: async (request) => client.files.list(request as never),
    },
  };
}
