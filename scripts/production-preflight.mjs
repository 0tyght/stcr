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
const httpIngestEnabled =
  String(process.env.STCR_HTTP_INGEST_ENABLED || "false").toLowerCase() === "true";
const mqttEnabled =
  String(process.env.STCR_FACTORY_MQTT_ENABLED || "false").toLowerCase() === "true";
if (!httpIngestEnabled && !mqttEnabled) {
  failures.push("Enable STCR_HTTP_INGEST_ENABLED or STCR_FACTORY_MQTT_ENABLED");
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
if (httpIngestEnabled) {
  const grKey = requireValue("STCR_GR_INGEST_API_KEY", 40);
  const ttnKey = requireValue("STCR_TTN_INGEST_API_KEY", 40);
  if (grKey && ttnKey && grKey === ttnKey) failures.push("GR and TTN ingestion keys must be different");
  if (grKey && !/^stcr_gr_[A-Za-z0-9_-]{32,}$/.test(grKey)) failures.push("GR ingestion key has an invalid format");
  if (ttnKey && !/^stcr_ttn_[A-Za-z0-9_-]{32,}$/.test(ttnKey)) failures.push("TTN ingestion key has an invalid format");
}

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

if (mqttEnabled) {
  const mqttUrl = requireValue("STCR_FACTORY_MQTT_URL");
  requireValue("STCR_FACTORY_MQTT_USERNAME");
  requireValue("STCR_FACTORY_MQTT_PASSWORD", 12);
  requireValue("STCR_FACTORY_MQTT_CLIENT_ID");
  const topicRoutesText = requireValue("STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON");
  const ovenMapsText = requireValue("STCR_FACTORY_MQTT_OVEN_MAPS_JSON");
  if (!mqttUrl.startsWith("mqtts://")) failures.push("STCR_FACTORY_MQTT_URL must use mqtts:// in production");
  if (String(process.env.STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "true") {
    failures.push("STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED must be true in production");
  }
  try {
    const routes = JSON.parse(topicRoutesText);
    for (const [topic, route] of Object.entries(routes)) {
      if (!topic || /[#+\u0000]/.test(topic) || !new Set(["gr", "ttn"]).has(route?.companyId) ||
          !new Set(["status", "sensor"]).has(route?.messageType)) {
        failures.push(`Invalid MQTT topic route: ${topic || "(empty)"}`);
      }
    }
    for (const requiredTopic of ["test", "sensor", "status_gr", "sensor_gr"]) {
      if (!routes[requiredTopic]) failures.push(`Missing MQTT topic route: ${requiredTopic}`);
    }
  } catch {
    failures.push("STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON must be valid JSON");
  }
  try {
    const maps = JSON.parse(ovenMapsText);
    for (const companyId of ["gr", "ttn"]) {
      if (!maps?.[companyId] || typeof maps[companyId] !== "object" || !Object.keys(maps[companyId]).length) {
        failures.push(`STCR_FACTORY_MQTT_OVEN_MAPS_JSON must map ovens for ${companyId}`);
      }
    }
  } catch {
    failures.push("STCR_FACTORY_MQTT_OVEN_MAPS_JSON must be valid JSON");
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
