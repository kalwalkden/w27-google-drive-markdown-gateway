import type { Express } from "express";
import express from "express";

export type {
  JsonApiDependencies,
  WriteSessionProvider,
} from "./http/json-api.js";
export { createJsonApiApp } from "./http/json-api.js";

/** Route-free compatibility factory. Production composition uses createJsonApiApp. */
export function createApp(): Express {
  return express();
}
