import { createServer } from "node:http";

import { loadEnvironment, envNumber } from "./config/env.mjs";

loadEnvironment();

const [
  { createApp },
  { startMqttService },
  { closeApiRuntime },
  { closeReadiness },
] = await Promise.all([
  import("./http/app.mjs"),
  import("./mqtt/mqtt-service.mjs"),
  import("./http/api-runtime.mjs"),
  import("./runtime/readiness.mjs"),
]);

const app = createApp();
const port = envNumber("STCR_API_PORT", 3001, 1, 65535);
const host = String(process.env.STCR_API_HOST || "127.0.0.1");
const server = createServer(app);

server.requestTimeout = envNumber("STCR_HTTP_REQUEST_TIMEOUT_MS", 30000, 1000, 300000);
server.headersTimeout = envNumber("STCR_HTTP_HEADERS_TIMEOUT_MS", 35000, 2000, 310000);
server.keepAliveTimeout = envNumber("STCR_HTTP_KEEP_ALIVE_TIMEOUT_MS", 5000, 1000, 60000);
server.maxHeadersCount = envNumber("STCR_HTTP_MAX_HEADERS", 100, 20, 1000);
server.maxRequestsPerSocket = envNumber("STCR_HTTP_MAX_REQUESTS_PER_SOCKET", 1000, 1, 100000);

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

server.on("clientError", (error, socket) => {
  console.warn("[stcr-express] HTTP client error", error?.code || error?.message || error);
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

server.on("error", (error) => {
  console.error("[stcr-express] HTTP server error", error);
  void shutdown("serverError", 1);
});

server.listen(port, host, () => {
  console.log(`[stcr-express] API listening at http://${host}:${port}/stcr/api`);
  console.log(`[stcr-express] Health check: http://${host}:${port}/healthz`);
  console.log(`[stcr-express] Readiness check: http://${host}:${port}/readyz`);
});

let shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[stcr-express] ${signal} received; shutting down`);

  const shutdownTimeoutMs = envNumber("STCR_SHUTDOWN_TIMEOUT_MS", 15000, 1000, 60000);
  const forceTimer = setTimeout(() => {
    console.error("[stcr-express] Graceful shutdown timed out");
    process.exit(1);
  }, shutdownTimeoutMs);
  forceTimer.unref?.();

  const closeHttp = new Promise((resolveClose) => {
    server.close(() => resolveClose());
    server.closeIdleConnections?.();
  });

  const results = await Promise.allSettled([
    closeHttp,
    stopMqtt(),
    closeApiRuntime(),
    closeReadiness(),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[stcr-express] Shutdown task failed", result.reason);
      exitCode = 1;
    }
  }

  clearTimeout(forceTimer);
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
