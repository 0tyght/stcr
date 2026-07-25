import { existsSync } from "node:fs";
import { resolve } from "node:path";

import express from "express";

import { envBoolean } from "../config/env.mjs";
import { executeApiRequest, readRuntimeHealth } from "./api-runtime.mjs";

function setResponseHeaders(res, headers) {
  for (const [name, value] of Object.entries(headers || {})) {
    if (value !== undefined && value !== null) res.setHeader(name, String(value));
  }
}

function sendLegacyResult(res, result) {
  if (!result) {
    res.status(204).end();
    return;
  }

  const statusCode = Number(result.statusCode) || 200;
  setResponseHeaders(res, result.headers);
  res.status(statusCode);

  const payload = result.payload;
  if (payload === undefined || payload === null) {
    res.end();
  } else if (Buffer.isBuffer(payload) || typeof payload === "string") {
    res.send(payload);
  } else {
    res.json(payload);
  }
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", envBoolean("STCR_TRUST_PROXY", false));

  app.use(express.json({ limit: "32kb", strict: true }));
  app.use(express.text({
    type: ["text/*", "application/csv"],
    limit: "32kb",
  }));

  app.use((error, _req, res, next) => {
    if (error instanceof SyntaxError || error?.type === "entity.too.large") {
      res.status(error?.type === "entity.too.large" ? 413 : 400).json({
        error: error?.type === "entity.too.large" ? "Request body is too large" : "Request body is not valid JSON",
        code: error?.type === "entity.too.large" ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON",
      });
      return;
    }
    next(error);
  });

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "stcr-express",
      time: new Date().toISOString(),
      ...readRuntimeHealth(),
    });
  });

  app.use("/stcr/api", async (req, res) => {
    try {
      const result = await executeApiRequest(req);
      sendLegacyResult(res, result);
    } catch (error) {
      console.error("[express-api] Unhandled request error", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "เกิดข้อผิดพลาดภายใน Express API",
          code: "INTERNAL_SERVER_ERROR",
        });
      } else {
        res.end();
      }
    }
  });

  const distPath = resolve(process.cwd(), "dist");
  if (envBoolean("STCR_SERVE_FRONTEND", false) && existsSync(distPath)) {
    app.use(express.static(distPath, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/stcr\/api).*/, (_req, res) => {
      res.sendFile(resolve(distPath, "index.html"));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "Route not found", code: "NOT_FOUND" });
  });

  return app;
}
