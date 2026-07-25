import { access } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

import { loadEnvironment } from "../src/config/env.mjs";

loadEnvironment();

const requiredFiles = [
  "backend/src/legacy-functions/api-router.js",
  "backend/src/legacy-functions/factory-mqtt-adapter.js",
  "backend/src/legacy-functions/factory-mqtt-db-writer.js",
  "backend/src/http/security.mjs",
  "backend/src/runtime/readiness.mjs",
];
for (const filename of requiredFiles) await access(resolve(process.cwd(), filename));

const production = String(process.env.STCR_DEPLOYMENT_MODE || "development").toLowerCase() === "production";
const required = production
  ? ["STCR_DB_PASSWORD", "STCR_API_KEY_PEPPER", "STCR_ALLOWED_ORIGINS"]
  : [];
const mqttEnabled = String(process.env.STCR_FACTORY_MQTT_ENABLED || "false").toLowerCase() === "true";
if (mqttEnabled) required.push("STCR_FACTORY_MQTT_URL");

const missing = required.filter((name) => !String(process.env[name] || "").trim());
if (missing.length) throw new Error(`Missing environment values: ${missing.join(", ")}`);

function assertNoPlaceholder(name) {
  const value = String(process.env[name] || "");
  if (/replace-with|change-this|shown-once|example\.com/i.test(value)) {
    throw new Error(`${name} still contains a placeholder value`);
  }
}

if (production) {
  assertNoPlaceholder("STCR_DB_PASSWORD");
  assertNoPlaceholder("STCR_API_KEY_PEPPER");
  assertNoPlaceholder("STCR_ALLOWED_ORIGINS");
  if (String(process.env.STCR_API_KEY_PEPPER || "").length < 32) {
    throw new Error("STCR_API_KEY_PEPPER must contain at least 32 characters");
  }

  const origins = String(process.env.STCR_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origins.length) throw new Error("STCR_ALLOWED_ORIGINS must not be empty");
  for (const origin of origins) {
    const url = new URL(origin);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !local) {
      throw new Error(`Production origin must use HTTPS: ${origin}`);
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`Allowed origin must not contain a path, query, or hash: ${origin}`);
    }
  }
}

if (mqttEnabled) {
  if (production) {
    assertNoPlaceholder("STCR_FACTORY_MQTT_URL");
    if (process.env.STCR_FACTORY_MQTT_USERNAME) assertNoPlaceholder("STCR_FACTORY_MQTT_USERNAME");
    if (process.env.STCR_FACTORY_MQTT_PASSWORD) assertNoPlaceholder("STCR_FACTORY_MQTT_PASSWORD");
  }
  const mqttUrl = new URL(process.env.STCR_FACTORY_MQTT_URL);
  if (!["mqtt:", "mqtts:", "ws:", "wss:"].includes(mqttUrl.protocol)) {
    throw new Error(`Unsupported MQTT protocol: ${mqttUrl.protocol}`);
  }
  if (
    production &&
    ["mqtts:", "wss:"].includes(mqttUrl.protocol) &&
    String(process.env.STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED || "true").toLowerCase() === "false"
  ) {
    throw new Error("MQTT TLS certificate verification cannot be disabled in production");
  }

  const routesText = String(process.env.STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON || "").trim();
  if (routesText) {
    const routes = JSON.parse(routesText);
    if (!routes || typeof routes !== "object" || Array.isArray(routes) || !Object.keys(routes).length) {
      throw new Error("STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON must contain at least one route");
    }
  } else if (production) {
    console.warn("WARNING: Production should use explicit STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON routes");
  }
}

const pool = mysql.createPool({
  host: process.env.STCR_DB_HOST || "127.0.0.1",
  port: Number(process.env.STCR_DB_PORT || 3306),
  user: process.env.STCR_DB_USER || "stcr_app",
  password: process.env.STCR_DB_PASSWORD || "",
  database: process.env.STCR_DB_NAME || "stcr",
  connectionLimit: 1,
  connectTimeout: 5000,
  timezone: "Z",
});

try {
  const [[identity]] = await pool.query("SELECT CURRENT_USER() AS currentUser, VERSION() AS version");
  if (production && String(identity.currentUser || "").toLowerCase().startsWith("root@")) {
    throw new Error("Production Express must not connect to MariaDB as root");
  }
  console.log(`Database connection passed (${identity.currentUser}, MariaDB/MySQL ${identity.version})`);
} finally {
  await pool.end();
}

console.log("Express production preflight passed");
