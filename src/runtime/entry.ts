import { startRuntime } from "./server.js";

void startRuntime().catch(() => {
  console.error("Gateway startup failed.");
  process.exitCode = 1;
});
