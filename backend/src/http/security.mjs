import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { envBoolean } from "../config/env.mjs";

function parseAllowedOrigins() {
  return new Set(
    String(process.env.STCR_ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  );
}

function readRequestId(req) {
  const incoming = String(req.headers["x-request-id"] || "").trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
}

function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cache-Control", "no-store");
}

export function createRequestContextMiddleware() {
  const accessLog = envBoolean(
    "STCR_HTTP_ACCESS_LOG",
    String(process.env.STCR_DEPLOYMENT_MODE || "development").toLowerCase() === "production",
  );

  return function requestContext(req, res, next) {
    const startedAt = performance.now();
    const requestId = readRequestId(req);
    req.stcrRequestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    applySecurityHeaders(res);

    if (accessLog) {
      res.once("finish", () => {
        const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
        console.log(JSON.stringify({
          scope: "http",
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs,
        }));
      });
    }

    next();
  };
}

export function createCorsMiddleware() {
  const allowedOrigins = parseAllowedOrigins();

  return function cors(req, res, next) {
    const origin = String(req.headers.origin || "").trim().replace(/\/+$/, "");
    if (!origin) {
      next();
      return;
    }

    if (!allowedOrigins.has(origin)) {
      res.status(403).json({
        error: "Origin is not allowed",
        code: "ORIGIN_NOT_ALLOWED",
      });
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-API-Key, X-Request-ID",
      );
      res.setHeader("Access-Control-Max-Age", "600");
      res.status(204).end();
      return;
    }

    next();
  };
}
