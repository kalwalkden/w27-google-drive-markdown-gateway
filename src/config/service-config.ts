import { isAbsolute } from "node:path";

import { z } from "zod";

import { folderId, type FolderId } from "../domain/markdown.js";

const allowedJwtAlgorithms = [
  "RS256",
  "PS256",
  "ES256",
  "ES384",
  "EdDSA",
] as const;

export type AllowedJwtAlgorithm = (typeof allowedJwtAlgorithms)[number];

export type SecretFileReference = string & {
  readonly __brand: "SecretFileReference";
};

const secretFileReference = (value: string): SecretFileReference =>
  value as SecretFileReference;

const folderIdSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => folderId(value));

const secretFileReferenceSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !value.includes("\0") && isAbsolute(value),
    "secret file reference must be an absolute path without NUL",
  )
  .transform(secretFileReference);

const httpsUrlSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "must be an HTTPS URL" });
      return;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    ) {
      context.addIssue({
        code: "custom",
        message: "must be an HTTPS URL without credentials, query, or fragment",
      });
    }
  });

const boundedPositiveInteger = (minimum: number, maximum: number) =>
  z.number().int().min(minimum).max(maximum);

const driveSchema = z
  .discriminatedUnion("authMode", [
    z
      .object({
        authMode: z.literal("shared-drive-adc"),
        rootFolderId: folderIdSchema,
        archiveFolderId: folderIdSchema,
        sharedDriveId: z.string().trim().min(1),
        maxMarkdownBytes: boundedPositiveInteger(1, 10_000_000),
        maxTraversalNodes: boundedPositiveInteger(1, 10_000),
        maxPages: boundedPositiveInteger(1, 100),
        maxResults: boundedPositiveInteger(1, 1_000),
      })
      .strict(),
    z
      .object({
        authMode: z.literal("my-drive-refresh-token"),
        rootFolderId: folderIdSchema,
        archiveFolderId: folderIdSchema,
        oauthSecretFile: secretFileReferenceSchema,
        maxMarkdownBytes: boundedPositiveInteger(1, 10_000_000),
        maxTraversalNodes: boundedPositiveInteger(1, 10_000),
        maxPages: boundedPositiveInteger(1, 100),
        maxResults: boundedPositiveInteger(1, 1_000),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.rootFolderId === value.archiveFolderId) {
      context.addIssue({
        code: "custom",
        message: "root and archive folder IDs must differ",
        path: ["archiveFolderId"],
      });
    }
  });

const serviceConfigSchema = z
  .object({
    drive: driveSchema,
    authentication: z
      .object({
        workMcp: z
          .object({
            issuer: httpsUrlSchema,
            audience: z.string().trim().min(1),
            jwksUrl: httpsUrlSchema,
            allowedAlgorithms: z
              .array(z.enum(allowedJwtAlgorithms))
              .min(1)
              .superRefine((value, context) => {
                if (new Set(value).size !== value.length) {
                  context.addIssue({
                    code: "custom",
                    message: "allowed algorithms must be unique",
                  });
                }
              }),
            clockToleranceSeconds: boundedPositiveInteger(0, 300),
            jwksTimeoutMs: boundedPositiveInteger(100, 30_000),
            jwksCacheMaxAgeMs: boundedPositiveInteger(1_000, 3_600_000),
          })
          .strict()
          .superRefine((value, context) => {
            if (value.issuer === value.jwksUrl) {
              context.addIssue({
                code: "custom",
                message: "issuer and JWKS URL must differ",
                path: ["jwksUrl"],
              });
            }
          }),
        codex: z
          .object({ bearerSecretFile: secretFileReferenceSchema })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type ServiceConfig = Readonly<{
  readonly drive:
    | Readonly<{
        readonly authMode: "shared-drive-adc";
        readonly rootFolderId: FolderId;
        readonly archiveFolderId: FolderId;
        readonly sharedDriveId: string;
        readonly maxMarkdownBytes: number;
        readonly maxTraversalNodes: number;
        readonly maxPages: number;
        readonly maxResults: number;
      }>
    | Readonly<{
        readonly authMode: "my-drive-refresh-token";
        readonly rootFolderId: FolderId;
        readonly archiveFolderId: FolderId;
        readonly oauthSecretFile: SecretFileReference;
        readonly maxMarkdownBytes: number;
        readonly maxTraversalNodes: number;
        readonly maxPages: number;
        readonly maxResults: number;
      }>;
  readonly authentication: Readonly<{
    readonly workMcp: Readonly<{
      readonly issuer: string;
      readonly audience: string;
      readonly jwksUrl: string;
      readonly allowedAlgorithms: readonly AllowedJwtAlgorithm[];
      readonly clockToleranceSeconds: number;
      readonly jwksTimeoutMs: number;
      readonly jwksCacheMaxAgeMs: number;
    }>;
    readonly codex: Readonly<{
      readonly bearerSecretFile: SecretFileReference;
    }>;
  }>;
}>;

/** Parses deployment-owned, non-secret service configuration without touching external resources. */
export function parseServiceConfig(input: unknown): ServiceConfig {
  return serviceConfigSchema.parse(input) as ServiceConfig;
}
