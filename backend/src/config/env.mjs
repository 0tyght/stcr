import { existsSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

export function loadEnvironment() {
  if (loaded) return;
  loaded = true;

  const envFile = resolve(process.cwd(), process.env.STCR_ENV_FILE || ".env");
  if (!existsSync(envFile)) return;

  if (typeof process.loadEnvFile !== "function") {
    throw new Error("Node.js 24+ is required because process.loadEnvFile() is unavailable");
  }

  process.loadEnvFile(envFile);
}

export function envBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return String(raw).trim().toLowerCase() === "true";
}

export function envNumber(name, fallback, minimum, maximum) {
  const number = Number(process.env[name]);
  if (!Number.isFinite(number)) return fallback;
  if (minimum != null && number < minimum) return fallback;
  if (maximum != null && number > maximum) return fallback;
  return number;
}
