import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

const driveReadScope = "https://www.googleapis.com/auth/drive.readonly";

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
    get(request: Readonly<Record<string, unknown>>): Promise<{ data: unknown }>;
    list(
      request: Readonly<Record<string, unknown>>,
    ): Promise<{ data: unknown }>;
  };
}

interface GoogleDriveSdkClient {
  readonly files: {
    get(params: unknown, options?: unknown): Promise<{ data: unknown }>;
    list(params: unknown): Promise<{ data: unknown }>;
  };
}

/** Builds an unaquired credential; Google obtains a token only when a request is sent. */
export function createGoogleDriveAuth(
  config: GoogleDriveAuthConfig,
): GoogleAuth | OAuth2Client {
  if (config.mode === "shared-drive-adc") {
    return new GoogleAuth({ scopes: [driveReadScope] });
  }

  const client = new OAuth2Client(
    config.credentials.clientId,
    config.credentials.clientSecret,
  );
  client.setCredentials({ refresh_token: config.credentials.refreshToken });
  return client;
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
