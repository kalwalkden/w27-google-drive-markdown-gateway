export type PrincipalKind = "work-mcp" | "codex";

export interface AuthenticatedPrincipal {
  readonly kind: PrincipalKind;
  readonly subject: string;
  readonly issuer: string;
}

/** Public authentication failure intentionally retains no provider or credential detail. */
export class AuthenticationError extends Error {
  readonly code = "UNAUTHENTICATED";

  constructor() {
    super("Authentication failed.");
    this.name = "AuthenticationError";
  }
}

export interface PrincipalVerifier {
  verify(authorization: unknown): Promise<AuthenticatedPrincipal>;
}
