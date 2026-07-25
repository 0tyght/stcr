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

export async function readReadiness() {
  const database = await checkDatabase();
  const mqttRequired = envBoolean("STCR_FACTORY_MQTT_ENABLED", false);
  const mqttHealth = globalStore.get("stcrMqttHealth") || {};
  const mqtt = !mqttRequired || mqttHealth.connected === true;

  return {
    ok: database && mqtt,
    components: {
      database: database ? "up" : "down",
      mqtt: mqttRequired ? (mqtt ? "up" : "down") : "disabled",
    },
  };
}

export async function closeReadiness() {
  if (readinessPool?.end) await readinessPool.end().catch(() => undefined);
  readinessPool = undefined;
}
