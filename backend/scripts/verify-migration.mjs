import { access, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const required = [
  "backend/src/server.mjs",
  "backend/src/http/app.mjs",
  "backend/src/mqtt/mqtt-service.mjs",
  "backend/src/legacy-functions/api-router.js",
  "backend/src/legacy-functions/factory-mqtt-adapter.js",
  "backend/src/legacy-functions/factory-mqtt-db-writer.js",
  "backend/tools/create-user.mjs",
  "backend/tools/create-api-key.mjs",
  "src/services/api/expressApi.ts",
  "deploy/ubuntu/stcr-express.service",
];
for (const relative of required) await access(resolve(root, relative));

const forbidden = [
  "node-red",
  "src/services/api/nodeRedApi.ts",
  "deploy/ubuntu/node-red-stcr.service",
  "deploy/ubuntu/node-red-stcr-override.conf",
  "docs/node-red-api.md",
  "docs/node-red-iot-workflow.md",
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
if (Object.keys(packageJson.scripts || {}).some((name) => name.startsWith("node-red:"))) {
  throw new Error("Node-RED npm scripts still exist");
}

const vite = await readFile(resolve(root, "vite.config.ts"), "utf8");
if (!vite.includes("127.0.0.1:3001") || vite.includes("127.0.0.1:1880")) {
  throw new Error("Vite proxy is not fully migrated to port 3001");
}
const runtime = await readFile(resolve(root, "src/config/runtime.ts"), "utf8");
if (!runtime.includes("127.0.0.1:3001/stcr/api")) {
  throw new Error("Frontend default API URL is not Express");
}

console.log("Express migration structure verification passed");
