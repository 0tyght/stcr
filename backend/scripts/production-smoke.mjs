import { createServer } from "node:http";

import { loadEnvironment } from "../src/config/env.mjs";

loadEnvironment();
process.env.STCR_FACTORY_MQTT_ENABLED = "false";
process.env.STCR_HTTP_ACCESS_LOG = "false";

const [{ createApp }, { closeReadiness }] = await Promise.all([
  import("../src/http/app.mjs"),
  import("../src/runtime/readiness.mjs"),
]);

const server = createServer(createApp());
try {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(`${base}/healthz`);
  const health = await healthResponse.json();
  if (!healthResponse.ok || health?.service !== "stcr-express") {
    throw new Error("Liveness smoke test failed");
  }

  const readyResponse = await fetch(`${base}/readyz`);
  const ready = await readyResponse.json();
  if (!readyResponse.ok || ready?.components?.database !== "up") {
    throw new Error(`Readiness smoke test failed: ${JSON.stringify(ready)}`);
  }

  console.log("Express production smoke test passed");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await closeReadiness();
}
