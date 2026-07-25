import { resolve } from "node:path";

import { createLegacyFunctionRunner, createSerialExecutor } from "../runtime/function-runner.mjs";
import { apiContextStore, globalStore } from "../runtime/store.mjs";

const legacyApiPath = resolve(
  process.cwd(),
  "backend/src/legacy-functions/api-router.js",
);

const runSerial = createSerialExecutor();
let runnerPromise;

function getRunner() {
  runnerPromise ||= createLegacyFunctionRunner({
    filename: legacyApiPath,
    scope: "express-api",
    globalStore,
    contextStore: apiContextStore,
  });
  return runnerPromise;
}

function buildRequestMessage(req) {
  const pathname = `${req.baseUrl || ""}${req.path || ""}` || "/stcr/api";
  return {
    req: {
      method: req.method,
      path: pathname,
      query: req.query || {},
      headers: req.headers || {},
      ip: req.ip,
      socket: req.socket,
      _parsedUrl: { pathname },
    },
    payload: req.body,
  };
}

export async function executeApiRequest(req) {
  const runner = await getRunner();
  return runSerial(() => runner(buildRequestMessage(req)));
}

export function readRuntimeHealth() {
  return {
    stateLoaded: Boolean(globalStore.get("stcrState")),
    mqtt: globalStore.get("stcrMqttHealth") || {
      connected: false,
      topics: {},
    },
  };
}

export async function closeApiRuntime() {
  const pool = apiContextStore.get("stcrApiDbPool");
  if (pool?.end) await pool.end().catch(() => undefined);
  apiContextStore.set("stcrApiDbPool", undefined);
}
