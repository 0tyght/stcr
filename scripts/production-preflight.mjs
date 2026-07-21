import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const requireValue = (name, minimumLength = 1) => {
  const value = String(process.env[name] || "").trim();
  if (value.length < minimumLength || /replace-with|change-this|example/i.test(value)) {
    failures.push(`${name} is missing, too short, or still a placeholder`);
  }
  return value;
};

if (String(process.env.STCR_DEPLOYMENT_MODE || "").toLowerCase() !== "production") {
  failures.push("STCR_DEPLOYMENT_MODE must be production");
}
if (String(process.env.STCR_HTTP_INGEST_ENABLED || "").toLowerCase() !== "true") {
  failures.push("STCR_HTTP_INGEST_ENABLED must be true");
}
if (String(process.env.STCR_TRUST_PROXY || "").toLowerCase() !== "true") {
  failures.push("STCR_TRUST_PROXY must be true behind the production proxy");
}

requireValue("STCR_DB_HOST");
requireValue("STCR_DB_PORT");
requireValue("STCR_DB_USER");
requireValue("STCR_DB_PASSWORD", 16);
requireValue("STCR_DB_NAME");
requireValue("STCR_NODE_RED_CREDENTIAL_SECRET", 32);
requireValue("STCR_API_KEY_PEPPER", 32);
const grKey = requireValue("STCR_GR_INGEST_API_KEY", 40);
const ttnKey = requireValue("STCR_TTN_INGEST_API_KEY", 40);
if (grKey && ttnKey && grKey === ttnKey) failures.push("GR and TTN ingestion keys must be different");
if (grKey && !/^stcr_gr_[A-Za-z0-9_-]{32,}$/.test(grKey)) failures.push("GR ingestion key has an invalid format");
if (ttnKey && !/^stcr_ttn_[A-Za-z0-9_-]{32,}$/.test(ttnKey)) failures.push("TTN ingestion key has an invalid format");

const origins = requireValue("STCR_ALLOWED_ORIGINS")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!origins.length || origins.some((origin) => {
  try {
    const url = new URL(origin);
    return url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash;
  } catch {
    return true;
  }
})) failures.push("STCR_ALLOWED_ORIGINS must contain exact HTTPS origins only");

const ingestUrl = requireValue("STCR_INGEST_URL");
try {
  const url = new URL(ingestUrl);
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (!local && url.protocol !== "https:") failures.push("STCR_INGEST_URL must use HTTPS unless it is loopback");
} catch {
  failures.push("STCR_INGEST_URL is not a valid URL");
}

if (String(process.env.STCR_FACTORY_MQTT_ENABLED || "").toLowerCase() === "true") {
  const mqttUrl = requireValue("STCR_FACTORY_MQTT_URL");
  requireValue("STCR_FACTORY_MQTT_USERNAME");
  requireValue("STCR_FACTORY_MQTT_PASSWORD", 12);
  const mqttCompanyId = requireValue("STCR_FACTORY_MQTT_COMPANY_ID");
  requireValue("STCR_FACTORY_MQTT_CLIENT_ID");
  const ovenMapText = requireValue("STCR_FACTORY_MQTT_OVEN_MAP_JSON");
  if (!mqttUrl.startsWith("mqtts://")) failures.push("STCR_FACTORY_MQTT_URL must use mqtts:// in production");
  if (!new Set(["gr", "ttn"]).has(mqttCompanyId)) failures.push("STCR_FACTORY_MQTT_COMPANY_ID must be gr or ttn");
  if (String(process.env.STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "true") {
    failures.push("STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED must be true in production");
  }
  try {
    const ovenMap = JSON.parse(ovenMapText);
    if (!ovenMap || typeof ovenMap !== "object" || Array.isArray(ovenMap) || !Object.keys(ovenMap).length) {
      failures.push("STCR_FACTORY_MQTT_OVEN_MAP_JSON must map at least one factory oven");
    }
  } catch {
    failures.push("STCR_FACTORY_MQTT_OVEN_MAP_JSON must be valid JSON");
  }
}

const runtimeConfig = JSON.parse(await readFile(join(root, "public", "runtime-config.json"), "utf8"));
if (typeof runtimeConfig.apiBaseUrl !== "string" || /trycloudflare\.com/i.test(runtimeConfig.apiBaseUrl)) {
  failures.push("public/runtime-config.json must not use a temporary tunnel");
}

if (failures.length) {
  console.error("STCR production preflight failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("STCR production environment preflight passed.");
