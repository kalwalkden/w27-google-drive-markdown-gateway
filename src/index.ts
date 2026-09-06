import type { Express } from "express";
import express from "express";

export type {
  JsonApiDependencies,
  WriteSessionProvider,
} from "./http/json-api.js";
export { createJsonApiApp } from "./http/json-api.js";
export type { StatelessMcpDependencies } from "./mcp/stateless-mcp.js";
export { createStatelessMcpApp } from "./mcp/stateless-mcp.js";

/** Route-free compatibility factory. Production composition uses createJsonApiApp. */
export function createApp(): Express {
  return express();
}
