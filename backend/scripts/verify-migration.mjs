import { access, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const required = [
  "backend/src/server.mjs",
  "backend/src/http/app.mjs",
  "backend/src/http/security.mjs",
  "backend/src/runtime/readiness.mjs",
  "backend/src/mqtt/mqtt-service.mjs",
  "backend/src/legacy-functions/api-router.js",
  "backend/src/legacy-functions/factory-mqtt-adapter.js",
  "backend/src/legacy-functions/factory-mqtt-db-writer.js",
  "backend/tools/create-user.mjs",
  "backend/tools/create-api-key.mjs",
  "src/services/api/expressApi.ts",
  "deploy/ubuntu/ecosystem.config.cjs",
  "deploy/ubuntu/nginx-stcr-local.conf",
  "deploy/ubuntu/stcr-express.service",
  ".github/workflows/production-check.yml",
];
for (const relative of required) await access(resolve(root, relative));

const forbidden = [
  "node-red",
  "src/services/api/nodeRedApi.ts",
  "deploy/ubuntu/node-red-stcr.service",
  "deploy/ubuntu/node-red-stcr-override.conf",
];
for (const relative of forbidden) {
  if (existsSync(resolve(root, relative))) {
    throw new Error(`Legacy Node-RED path still exists: ${relative}`);
  }
}

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (!packageJson.dependencies?.express) throw new Error("express dependency is missing");
if (packageJson.scripts?.start !== "node backend/src/server.mjs") {
  throw new Error("npm start does not point to Express");
}
if (!packageJson.scripts?.["backend:security-test"] || !packageJson.scripts?.["backend:smoke"]) {
  throw new Error("Production verification scripts are missing");
}

const vite = await readFile(resolve(root, "vite.config.ts"), "utf8");
if (!vite.includes("127.0.0.1:3001") || vite.includes("127.0.0.1:1880")) {
  throw new Error("Vite proxy is not fully migrated to port 3001");
}
const runtimeConfig = JSON.parse(await readFile(resolve(root, "public/runtime-config.json"), "utf8"));
if (runtimeConfig.apiBaseUrl !== "/stcr/api" || runtimeConfig.dataSource !== "express") {
  throw new Error("Production runtime config must use the same-origin Express API");
}

const schema = await readFile(resolve(root, "database/schema.sql"), "utf8");
if (
  schema.includes("CREATE TABLE IF NOT EXISTS sensor_readings") ||
  schema.includes("CREATE TABLE IF NOT EXISTS telemetry_events")
) {
  throw new Error("Fresh schema still creates duplicate sensor-history tables");
}
if (!schema.includes("CREATE TABLE IF NOT EXISTS sensor_minute_aggregates")) {
  throw new Error("Canonical minute-history table is missing");
}
if (!schema.includes("source_cycle_number INT NULL")) {
  throw new Error("PLC cycle provenance column is missing");
}

const mqttWriter = await readFile(
  resolve(root, "backend/src/legacy-functions/factory-mqtt-db-writer.js"),
  "utf8",
);
if (
  mqttWriter.includes("INSERT INTO sensor_readings") ||
  mqttWriter.includes("UPDATE sensor_readings")
) {
  throw new Error("MQTT runtime still writes duplicate sensor history");
}
if (
  !mqttWriter.includes("source_cycle_number AS sourceCycleNumber") ||
  !mqttWriter.includes("sourceCycleNumber,\n      sourceCycleNumber") ||
  mqttWriter.includes("maximumCycleNumber")
) {
  throw new Error("MQTT lifecycle must preserve the official PLC cycle number");
}

console.log("Express production structure verification passed");
