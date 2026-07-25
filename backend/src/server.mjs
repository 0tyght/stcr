import { createServer } from "node:http";

import { loadEnvironment, envNumber } from "./config/env.mjs";

loadEnvironment();

const [{ createApp }, { startMqttService }, { closeApiRuntime }] = await Promise.all([
  import("./http/app.mjs"),
  import("./mqtt/mqtt-service.mjs"),
  import("./http/api-runtime.mjs"),
]);

const app = createApp();
const port = envNumber("STCR_API_PORT", 3001, 1, 65535);
const host = String(process.env.STCR_API_HOST || "127.0.0.1");
const server = createServer(app);

let stopMqtt = async () => undefined;
try {
  stopMqtt = await startMqttService();
} catch (error) {
  console.error("[stcr-express] MQTT startup failed", error);
  if (String(process.env.STCR_DEPLOYMENT_MODE || "development").toLowerCase() === "production") {
    process.exitCode = 1;
    throw error;
  }
}

server.listen(port, host, () => {
  console.log(`[stcr-express] API listening at http://${host}:${port}/stcr/api`);
  console.log(`[stcr-express] Health check: http://${host}:${port}/healthz`);
});

let shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[stcr-express] ${signal} received; shutting down`);

  await stopMqtt().catch((error) => {
    console.error("[stcr-express] MQTT shutdown failed", error);
  });
  await closeApiRuntime().catch((error) => {
    console.error("[stcr-express] API database shutdown failed", error);
  });
  await new Promise((resolveClose) => server.close(resolveClose));
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  console.error("[stcr-express] Uncaught exception", error);
  void shutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (error) => {
  console.error("[stcr-express] Unhandled rejection", error);
  void shutdown("unhandledRejection", 1);
});
