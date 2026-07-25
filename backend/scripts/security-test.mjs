import { createServer } from "node:http";

process.env.STCR_ALLOWED_ORIGINS = "https://stcr.example.com";
process.env.STCR_HTTP_ACCESS_LOG = "false";
process.env.STCR_FACTORY_MQTT_ENABLED = "false";

const { createApp } = await import("../src/http/app.mjs");

const server = createServer(createApp());
try {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/healthz`, {
    headers: { Origin: "https://stcr.example.com", "X-Request-ID": "security-test" },
  });
  if (!health.ok) throw new Error("Health endpoint failed");
  if (health.headers.get("access-control-allow-origin") !== "https://stcr.example.com") {
    throw new Error("Allowed CORS origin was not returned");
  }
  if (health.headers.get("x-content-type-options") !== "nosniff") {
    throw new Error("Security headers are missing");
  }
  if (health.headers.get("x-request-id") !== "security-test") {
    throw new Error("Request ID was not preserved");
  }

  const preflight = await fetch(`${base}/stcr/api/ovens`, {
    method: "OPTIONS",
    headers: { Origin: "https://stcr.example.com" },
  });
  if (preflight.status !== 204) throw new Error("CORS preflight failed");

  const blocked = await fetch(`${base}/healthz`, {
    headers: { Origin: "https://attacker.example" },
  });
  if (blocked.status !== 403) throw new Error("Disallowed CORS origin was not blocked");

  const oversized = await fetch(`${base}/stcr/api/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(40000) }),
  });
  if (oversized.status !== 413) throw new Error("Oversized request body was not blocked");

  console.log("Express security middleware test passed");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
