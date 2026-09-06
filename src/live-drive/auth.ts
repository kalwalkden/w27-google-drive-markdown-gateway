import { GoogleAuth, OAuth2Client } from "google-auth-library";

import type { OAuthSecret } from "./config.js";

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export class AdcAccessTokenProvider implements AccessTokenProvider {
  readonly #auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  async getAccessToken(): Promise<string> {
    const token = await this.#auth.getAccessToken();
    if (!token) throw new Error("ADC did not provide an access token");
    return token;
  }
}

export class RefreshTokenAccessTokenProvider implements AccessTokenProvider {
  readonly #client: OAuth2Client;

  constructor(secret: OAuthSecret) {
    this.#client = new OAuth2Client(secret.clientId, secret.clientSecret);
    this.#client.setCredentials({ refresh_token: secret.refreshToken });
  }

  async getAccessToken(): Promise<string> {
    const response = await this.#client.getAccessToken();
    if (!response.token)
      throw new Error("refresh token did not provide an access token");
    return response.token;
  }
}
