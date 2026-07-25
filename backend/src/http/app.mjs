import { existsSync } from "node:fs";
import { resolve } from "node:path";

import express from "express";

import { envBoolean, envNumber } from "../config/env.mjs";
import { readReadiness } from "../runtime/readiness.mjs";
import { executeApiRequest } from "./api-runtime.mjs";
import { createCorsMiddleware, createRequestContextMiddleware } from "./security.mjs";

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

function sendParserError(error, _req, res, next) {
  if (error instanceof SyntaxError || error?.type === "entity.too.large") {
    res.status(error?.type === "entity.too.large" ? 413 : 400).json({
      error: error?.type === "entity.too.large"
        ? "Request body is too large"
        : "Request body is not valid JSON",
      code: error?.type === "entity.too.large" ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON",
    });
    return;
  }
  next(error);
}

export function createApp() {
  const app = express();
  const bodyLimitBytes = envNumber("STCR_HTTP_BODY_LIMIT_BYTES", 32768, 1024, 1048576);

  app.disable("x-powered-by");
  app.set("trust proxy", envBoolean("STCR_TRUST_PROXY", false) ? 1 : false);

  app.use(createRequestContextMiddleware());
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: `${bodyLimitBytes}b`, strict: true }));
  app.use(express.text({
    type: ["text/*", "application/csv"],
    limit: `${bodyLimitBytes}b`,
  }));
  app.use(sendParserError);

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "stcr-express",
      time: new Date().toISOString(),
    });
  });

  app.get("/readyz", async (_req, res) => {
    const readiness = await readReadiness();
    res.status(readiness.ok ? 200 : 503).json({
      ...readiness,
      service: "stcr-express",
      time: new Date().toISOString(),
    });
  });

  app.use("/stcr/api", async (req, res) => {
    try {
      const result = await executeApiRequest(req);
      sendLegacyResult(res, result);
    } catch (error) {
      console.error("[express-api] Unhandled request error", {
        requestId: req.stcrRequestId,
        error,
      });
      if (!res.headersSent) {
        res.status(500).json({
          error: "เกิดข้อผิดพลาดภายใน Express API",
          code: "INTERNAL_SERVER_ERROR",
          requestId: req.stcrRequestId,
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

  app.use((error, req, res, _next) => {
    console.error("[stcr-express] Unhandled middleware error", {
      requestId: req.stcrRequestId,
      error,
    });
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({
      error: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
      requestId: req.stcrRequestId,
    });
  });

  return app;
}
