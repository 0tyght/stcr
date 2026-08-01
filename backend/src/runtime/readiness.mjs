import mysql from "mysql2/promise";

import { envBoolean, envNumber } from "../config/env.mjs";
import { globalStore } from "./store.mjs";

let readinessPool;

function getReadinessPool() {
  readinessPool ||= mysql.createPool({
    host: process.env.STCR_DB_HOST || "127.0.0.1",
    port: Number(process.env.STCR_DB_PORT || 3306),
    user: process.env.STCR_DB_USER || "stcr_app",
    password: process.env.STCR_DB_PASSWORD || "",
    database: process.env.STCR_DB_NAME || "stcr",
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: envNumber("STCR_DB_CONNECT_TIMEOUT_MS", 5000, 500, 30000),
    timezone: "Z",
  });
  return readinessPool;
}

async function checkDatabase() {
  const timeout = envNumber("STCR_DB_HEALTH_TIMEOUT_MS", 3000, 250, 15000);
  try {
    await getReadinessPool().query({ sql: "SELECT 1", timeout });
    return true;
  } catch (error) {
    console.error("[stcr-readiness] Database check failed", error?.code || error?.message || error);
    return false;
  }
}

function configuredSensorTopics() {
  try {
    const routes = JSON.parse(
      String(process.env.STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON || "{}"),
    );
    return Object.entries(routes)
      .filter(([, route]) => route?.messageType === "sensor")
      .map(([topic]) => topic);
  } catch {
    return [];
  }
}

function readMqttDataHealth(mqttHealth) {
  const staleAfterMs = envNumber(
    "STCR_FACTORY_MQTT_DATA_STALE_SECONDS",
    300,
    30,
    3600,
  ) * 1000;
  const now = Date.now();
  const startedAt = Date.parse(mqttHealth.startedAt || "");
  const withinStartupGrace = Number.isFinite(startedAt) && now - startedAt <= staleAfterMs;
  const sensorTopics = configuredSensorTopics();
  const topics = Object.fromEntries(sensorTopics.map((topic) => {
    const lastReceivedAt = mqttHealth.topics?.[topic]?.lastReceivedAt || null;
    const lastReceivedMs = Date.parse(lastReceivedAt || "");
    const fresh = Number.isFinite(lastReceivedMs) && now - lastReceivedMs <= staleAfterMs;
    return [topic, { state: fresh ? "up" : withinStartupGrace ? "starting" : "stale", lastReceivedAt }];
  }));
  const values = Object.values(topics);
  const healthy = values.length === 0 || values.every((topic) => topic.state !== "stale");

  return { healthy, topics };
}

export async function readReadiness() {
  const database = await checkDatabase();
  const mqttRequired = envBoolean("STCR_FACTORY_MQTT_ENABLED", false);
  const mqttHealth = globalStore.get("stcrMqttHealth") || {};
  const mqttConnected = !mqttRequired || mqttHealth.connected === true;
  const mqttData = mqttRequired
    ? readMqttDataHealth(mqttHealth)
    : { healthy: true, topics: {} };
  const mqtt = mqttConnected && mqttData.healthy;

  return {
    ok: database && mqtt,
    components: {
      database: database ? "up" : "down",
      mqtt: mqttRequired
        ? !mqttConnected
          ? "down"
          : mqttData.healthy
            ? "up"
            : "stale"
        : "disabled",
    },
    mqttTopics: mqttData.topics,
  };
}

export async function closeReadiness() {
  if (readinessPool?.end) await readinessPool.end().catch(() => undefined);
  readinessPool = undefined;
}
