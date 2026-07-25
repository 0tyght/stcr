import { access } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

import { loadEnvironment } from "../src/config/env.mjs";

loadEnvironment();

const requiredFiles = [
  "backend/src/legacy-functions/api-router.js",
  "backend/src/legacy-functions/factory-mqtt-adapter.js",
  "backend/src/legacy-functions/factory-mqtt-db-writer.js",
];
for (const filename of requiredFiles) await access(resolve(process.cwd(), filename));

const production = String(process.env.STCR_DEPLOYMENT_MODE || "development").toLowerCase() === "production";
const required = production
  ? ["STCR_DB_PASSWORD", "STCR_API_KEY_PEPPER", "STCR_ALLOWED_ORIGINS"]
  : [];
if (String(process.env.STCR_FACTORY_MQTT_ENABLED || "false").toLowerCase() === "true") {
  required.push("STCR_FACTORY_MQTT_URL");
}

const missing = required.filter((name) => !String(process.env[name] || "").trim());
if (missing.length) throw new Error(`Missing environment values: ${missing.join(", ")}`);

if (process.env.STCR_DB_PASSWORD) {
  const pool = mysql.createPool({
    host: process.env.STCR_DB_HOST || "127.0.0.1",
    port: Number(process.env.STCR_DB_PORT || 3306),
    user: process.env.STCR_DB_USER || "stcr_app",
    password: process.env.STCR_DB_PASSWORD,
    database: process.env.STCR_DB_NAME || "stcr",
    connectionLimit: 1,
    timezone: "Z",
  });
  await pool.query("SELECT 1");
  await pool.end();
  console.log("Database connection passed");
} else {
  console.log("Database connection skipped because STCR_DB_PASSWORD is not set");
}

console.log("Express production preflight passed");
