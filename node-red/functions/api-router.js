const method = String(msg.req.method || "GET").toUpperCase();
const path = msg.req.path || msg.req._parsedUrl?.pathname || "";
const query = msg.req.query || {};
const requestHeaders = msg.req.headers || {};
const requestOrigin = String(requestHeaders.origin || "").trim();
const allowedOrigins = String(
  env.get("STCR_ALLOWED_ORIGINS") ||
    "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173",
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowedOrigin = requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : "";
const sensorKeys = ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"];
const maxBodyBytes = 32 * 1024;
const maxHistoryRangeMs = 14 * 24 * 60 * 60 * 1000;

function responseHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "Content-Type": contentType,
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    Vary: "Origin",
  };
}

function jsonResponse(payload, statusCode = 200, extraHeaders = {}) {
  msg.statusCode = statusCode;
  msg.headers = { ...responseHeaders(), ...extraHeaders };
  msg.payload = payload;
  return msg;
}

function errorResponse(message, statusCode = 400, code = "BAD_REQUEST", extraHeaders = {}) {
  return jsonResponse({ error: message, code }, statusCode, extraHeaders);
}

function requestBody() {
  if (msg.payload && typeof msg.payload === "object") return msg.payload;
  if (typeof msg.payload === "string" && msg.payload.trim()) {
    try {
      return JSON.parse(msg.payload);
    } catch {
      return null;
    }
  }
  return {};
}

function requestIp() {
  const direct = msg.req.ip || msg.req.socket?.remoteAddress || "unknown";
  if (env.get("STCR_TRUST_PROXY") !== "true") return String(direct);
  return String(requestHeaders["x-forwarded-for"] || direct).split(",")[0].trim();
}

function checkRateLimit(scope, limit, windowMs) {
  const now = Date.now();
  const key = `${scope}:${requestIp()}`;
  const buckets = global.get("stcrRateLimits") || {};
  const recent = (buckets[key] || []).filter((timestamp) => now - timestamp < windowMs);
  recent.push(now);
  buckets[key] = recent;

  for (const [bucketKey, timestamps] of Object.entries(buckets)) {
    if (!timestamps.length || now - timestamps[timestamps.length - 1] > windowMs) delete buckets[bucketKey];
  }
  global.set("stcrRateLimits", buckets);

  return recent.length <= limit;
}

function verifyPassword(password, encodedHash) {
  const parts = String(encodedHash || "").split("$");
  if (parts.length !== 5 || parts[0] !== "argon2id" || parts[1] !== "v=19") return false;
  const parameters = Object.fromEntries(
    String(parts[2]).split(",").map((item) => item.split("=")),
  );
  const memory = Number(parameters.m);
  const passes = Number(parameters.t);
  const parallelism = Number(parameters.p);
  if (memory < 19456 || memory > 262144 || passes < 2 || passes > 10 || parallelism < 1 || parallelism > 4) {
    return false;
  }

  try {
    const salt = Buffer.from(parts[3], "hex");
    const expected = Buffer.from(parts[4], "hex");
    if (salt.length < 16 || expected.length !== 32) return false;
    const actual = crypto.argon2Sync("argon2id", {
      message: password,
      nonce: salt,
      parallelism,
      tagLength: expected.length,
      memory,
      passes,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function readUserForLogin(username) {
  const pool = getDatabasePool();
  const [rows] = await pool.execute(
    `SELECT u.id, u.company_id AS companyId, u.username, u.display_name AS displayName,
            u.password_hash AS passwordHash, u.password_algorithm AS passwordAlgorithm,
            u.status, u.failed_login_count AS failedLoginCount, u.locked_until AS lockedUntil,
            GROUP_CONCAT(r.code ORDER BY r.code SEPARATOR ',') AS roleCodes
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id=u.id
     LEFT JOIN roles r ON r.id=ur.role_id
     WHERE u.username=?
     GROUP BY u.id
     LIMIT 1`,
    [username],
  );
  const user = rows[0];
  if (!user) return null;
  return {
    ...user,
    roles: String(user.roleCodes || "viewer").split(",").filter(Boolean),
  };
}

async function recordLoginFailure(user) {
  if (!user) return;
  const pool = getDatabasePool();
  const failures = Number(user.failedLoginCount || 0) + 1;
  const shouldLock = failures >= 5;
  await pool.execute(
    `UPDATE users
     SET failed_login_count=?, status=IF(? AND status='active', 'locked', status),
         locked_until=IF(? AND status='active', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE), locked_until)
     WHERE id=?`,
    [failures, shouldLock, shouldLock, user.id],
  );
}

async function recordLoginSuccess(userId) {
  const pool = getDatabasePool();
  await pool.execute(
    `UPDATE users
     SET failed_login_count=0, locked_until=NULL, status='active', last_login_at=UTC_TIMESTAMP(3)
     WHERE id=?`,
    [userId],
  );
}

function cleanupSessions() {
  const now = Date.now();
  const sessions = global.get("stcrAuthSessions") || {};
  for (const [token, session] of Object.entries(sessions)) {
    if (!session || session.expiresAtMs <= now) delete sessions[token];
  }
  global.set("stcrAuthSessions", sessions);
  return sessions;
}

function authenticate() {
  const authorization = String(requestHeaders.authorization || "");
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  return cleanupSessions()[token] || null;
}

async function validateSessionAccount(session) {
  if (!session?.userId) return false;
  const pool = getDatabasePool();
  const [rows] = await pool.execute(
    `SELECT id FROM users
     WHERE id=? AND company_id=? AND username=? AND status='active'
       AND (locked_until IS NULL OR locked_until<=UTC_TIMESTAMP(3))
     LIMIT 1`,
    [session.userId, session.companyId, session.username],
  );
  return Boolean(rows[0]);
}

async function addAudit(state, session, action, target, detail) {
  const createdAt = new Date().toISOString();
  const auditEvent = {
    id: `audit-${session.companyId}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    actor: session.username,
    action,
    target,
    detail,
    createdAt,
  };
  state.auditEvents.unshift(auditEvent);
  state.auditEvents = state.auditEvents.slice(0, 100);

  try {
    const pool = getDatabasePool();
    await pool.execute(
      `INSERT INTO audit_events (
         company_id, actor, action_name, target_type, target_id, detail, created_at
       ) VALUES (?, ?, ?, 'application', ?, ?, ?)`,
      [session.companyId, session.username, action, target, JSON.stringify({ message: detail }), createdAt],
    );
  } catch (error) {
    node.warn(`Audit database persistence failed: ${error.message}`);
  }

  return auditEvent;
}

function getDatabasePool() {
  let pool = context.get("stcrApiDbPool");
  if (pool) return pool;
  const password = String(env.get("STCR_DB_PASSWORD") || "");
  if (!password) throw new Error("STCR_DB_PASSWORD is required");
  pool = mysql.createPool({
    host: env.get("STCR_DB_HOST") || "127.0.0.1",
    port: Number(env.get("STCR_DB_PORT") || 3306),
    user: env.get("STCR_DB_USER") || "stcr_app",
    password,
    database: env.get("STCR_DB_NAME") || "stcr",
    waitForConnections: true,
    connectionLimit: 4,
    timezone: "Z",
  });
  context.set("stcrApiDbPool", pool);
  return pool;
}

async function readReportHistory(companyId, ovenId, historyQuery) {
  const conditions = ["r.company_id=?", "r.oven_id=?"];
  const values = [companyId, ovenId];
  if (historyQuery.includeIgnition !== "true") {
    conditions.push(
      "r.included_in_report=TRUE",
      "c.report_started_at IS NOT NULL",
      "r.recorded_at>=c.report_started_at",
      "(c.stopped_at IS NULL OR r.recorded_at<=c.stopped_at)",
    );
  }
  if (historyQuery.startAt) {
    conditions.push("r.recorded_at>=?");
    values.push(historyQuery.startAt);
  }
  if (historyQuery.endAt) {
    conditions.push("r.recorded_at<=?");
    values.push(historyQuery.endAt);
  }
  if (historyQuery.cycleNumber) {
    conditions.push("c.cycle_number=?");
    values.push(Number(historyQuery.cycleNumber));
  }

  const pool = getDatabasePool();
  await pool.query("SET time_zone = '+00:00'");
  const requestedRangeMs = historyQuery.startAt && historyQuery.endAt
    ? Math.max(0, Date.parse(historyQuery.endAt) - Date.parse(historyQuery.startAt))
    : 0;
  const bucketSeconds = requestedRangeMs > 24 * 60 * 60 * 1000 ? 600 : 60;
  const [rows] = await pool.execute(
    `SELECT
       DATE_FORMAT(MIN(r.recorded_at), '%Y-%m-%dT%H:%i:%s.%fZ') AS timestamp,
       AVG(r.chamber_temp) AS chamberTemp,
       AVG(r.humidity) AS humidity,
       AVG(r.furnace_temp) AS furnaceTemp,
       AVG(r.blower_temp) AS blowerTemp
     FROM sensor_readings r
     LEFT JOIN oven_cycles c ON c.id=r.cycle_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY FLOOR(UNIX_TIMESTAMP(r.recorded_at) / ${bucketSeconds})
     ORDER BY MIN(r.recorded_at) ASC
     LIMIT 10000`,
    values,
  );
  return rows.map((row) => ({
    timestamp: row.timestamp,
    chamberTemp: Number(row.chamberTemp),
    humidity: Number(row.humidity),
    furnaceTemp: Number(row.furnaceTemp),
    blowerTemp: Number(row.blowerTemp),
  }));
}

async function readAuditEvents(companyId) {
  const pool = getDatabasePool();
  const [rows] = await pool.execute(
    `SELECT CAST(id AS CHAR) AS id, actor, action_name, target_id, detail,
            DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt
     FROM audit_events
     WHERE company_id=?
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
    [companyId],
  );

  return rows.map((row) => {
    let parsedDetail = row.detail;
    if (typeof parsedDetail === "string") {
      try {
        parsedDetail = JSON.parse(parsedDetail);
      } catch {
        parsedDetail = { message: parsedDetail };
      }
    }
    return {
      id: `audit-db-${row.id}`,
      actor: row.actor,
      action: row.action_name,
      target: row.target_id,
      detail: parsedDetail?.message || "",
      createdAt: row.createdAt,
    };
  });
}

async function readReportDocumentMeta(companyId) {
  const pool = getDatabasePool();
  const [rows] = await pool.execute(
    `SELECT document_no AS documentNo, effective_date AS effectiveDate
     FROM report_document_settings
     WHERE company_id=?
     LIMIT 1`,
    [companyId],
  );
  return rows[0] || { documentNo: "", effectiveDate: "" };
}

function validHistoryQuery(historyQuery) {
  const hasStart = Boolean(historyQuery.startAt);
  const hasEnd = Boolean(historyQuery.endAt);
  const cycle = Number(historyQuery.cycleNumber);
  if (hasStart !== hasEnd) return false;
  if (historyQuery.cycleNumber && (!Number.isInteger(cycle) || cycle < 1 || cycle > 1000000)) return false;
  if (!hasStart) return Number.isInteger(cycle) && cycle > 0;
  const start = Date.parse(historyQuery.startAt);
  const end = Date.parse(historyQuery.endAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= maxHistoryRangeMs;
}

function safeText(value, maxLength) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function hasAnyRole(session, allowedRoles) {
  return Array.isArray(session?.roles) && session.roles.some((role) => allowedRoles.includes(role));
}

async function authenticateApiKey(companyId, ovenId, apiKey) {
  const pepper = String(env.get("STCR_API_KEY_PEPPER") || "");
  if (pepper.length < 32 || !/^stcr_(gr|ttn)_[A-Za-z0-9_-]{32,}$/.test(apiKey)) return null;
  if (!apiKey.startsWith(`stcr_${companyId}_`)) return null;
  const prefix = apiKey.slice(0, 16);
  const candidateHash = crypto.createHmac("sha256", pepper).update(apiKey).digest();
  const pool = getDatabasePool();
  const [rows] = await pool.execute(
    `SELECT id, company_id AS companyId, allowed_oven_id AS allowedOvenId, key_hash AS keyHash
     FROM api_keys
     WHERE company_id=? AND key_prefix=? AND status='active'
       AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3))
     LIMIT 1`,
    [companyId, prefix],
  );
  const key = rows[0];
  if (!key || (key.allowedOvenId && key.allowedOvenId !== ovenId)) return null;
  const expectedHash = Buffer.from(String(key.keyHash), "hex");
  if (expectedHash.length !== candidateHash.length || !crypto.timingSafeEqual(candidateHash, expectedHash)) {
    return null;
  }
  return key;
}

function normalizeTelemetryBatch(body) {
  const companyId = safeText(body?.companyId, 32);
  const ovenId = safeText(body?.ovenId, 64);
  const batchId = safeText(body?.batchId, 96);
  const deviceId = safeText(body?.deviceId, 128);
  const readings = Array.isArray(body?.readings) ? body.readings : [];
  if (!companyId || !ovenId || !batchId || !deviceId || readings.length !== sensorKeys.length) return null;
  if (!new Set(["gr", "ttn"]).has(companyId)) return null;

  const physicalRanges = {
    chamberTemp: [-20, 150, "C"],
    humidity: [0, 100, "%"],
    furnaceTemp: [-20, 1200, "C"],
    blowerTemp: [-20, 500, "C"],
  };
  const normalized = [];
  const seen = new Set();
  for (const reading of readings) {
    const sensorKey = safeText(reading?.sensorKey, 40);
    const sensorId = safeText(reading?.sensorId, 160);
    const rule = physicalRanges[sensorKey];
    const value = Number(reading?.value);
    const rawValue = Number(reading?.rawValue ?? reading?.value);
    const sequence = Number(reading?.sequence);
    const timestampMs = Date.parse(reading?.sourceTimestamp);
    const quality = ["good", "suspect", "missing", "manual"].includes(reading?.quality)
      ? reading.quality
      : "good";
    if (
      !rule || seen.has(sensorKey) || !sensorId || reading?.unit !== rule[2] ||
      !Number.isFinite(value) || !Number.isFinite(rawValue) || value < rule[0] || value > rule[1] ||
      !Number.isSafeInteger(sequence) || sequence < 0 || !Number.isFinite(timestampMs) ||
      Math.abs(Date.now() - timestampMs) > 10 * 60 * 1000
    ) return null;
    seen.add(sensorKey);
    normalized.push({
      sensorKey,
      sensorId,
      value,
      rawValue,
      sequence,
      unit: reading.unit,
      quality,
      qualityReasons: Array.isArray(reading.qualityReasons) ? reading.qualityReasons.slice(0, 10) : [],
      sourceTimestamp: new Date(timestampMs).toISOString(),
    });
  }
  if (!sensorKeys.every((key) => seen.has(key))) return null;
  return { companyId, ovenId, batchId, deviceId, readings };
}

async function persistHttpTelemetryBatch(batch, apiKeyRecord) {
  const pool = getDatabasePool();
  const connection = await pool.getConnection();
  const receivedAt = new Date();
  const recordedAt = new Date(Math.max(...batch.readings.map((reading) => Date.parse(reading.sourceTimestamp))));
  try {
    await connection.beginTransaction();
    const [ovenRows] = await connection.execute(
      `SELECT id FROM ovens WHERE company_id=? AND id=? AND enabled=TRUE LIMIT 1 FOR UPDATE`,
      [batch.companyId, batch.ovenId],
    );
    if (!ovenRows[0]) {
      const error = new Error("OVEN_NOT_FOUND");
      error.code = "OVEN_NOT_FOUND";
      throw error;
    }
    const [cycleRows] = await connection.execute(
      `SELECT id, state FROM oven_cycles
       WHERE company_id=? AND oven_id=?
       ORDER BY cycle_number DESC LIMIT 1`,
      [batch.companyId, batch.ovenId],
    );
    const cycle = cycleRows[0] || null;
    const cyclePhase = cycle?.state === "recording"
      ? "recording"
      : cycle?.state === "ignition" ? "ignition" : cycle?.state === "completed" ? "cooldown" : "idle";
    const includedInReport = cyclePhase === "recording";

    for (const reading of batch.readings) {
      await connection.execute(
        `INSERT INTO telemetry_events (
           company_id, oven_id, batch_id, topic, device_id, sensor_id, sensor_key,
           sequence_number, numeric_value, unit_symbol, quality, quality_reasons,
           source_timestamp, gateway_timestamp, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE received_at=VALUES(received_at)`,
        [
          batch.companyId, batch.ovenId, batch.batchId,
          `stcr/${batch.companyId}/${batch.ovenId}/telemetry/${reading.sensorKey}`,
          batch.deviceId, reading.sensorId, reading.sensorKey, reading.sequence,
          reading.rawValue, reading.unit, reading.quality, JSON.stringify(reading.qualityReasons),
          reading.sourceTimestamp, reading.sourceTimestamp, receivedAt,
        ],
      );
    }

    const bySensor = Object.fromEntries(batch.readings.map((reading) => [reading.sensorKey, reading]));
    const snapshotQuality = batch.readings.some((reading) => reading.quality !== "good") ? "suspect" : "good";
    await connection.execute(
      `INSERT INTO sensor_readings (
         company_id, oven_id, cycle_id, recorded_at, chamber_temp, humidity,
         furnace_temp, blower_temp, cycle_phase, included_in_report, quality,
         source_timestamp, received_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         chamber_temp=VALUES(chamber_temp), humidity=VALUES(humidity),
         furnace_temp=VALUES(furnace_temp), blower_temp=VALUES(blower_temp),
         quality=VALUES(quality), source_timestamp=VALUES(source_timestamp), received_at=VALUES(received_at)`,
      [
        batch.companyId, batch.ovenId, cycle?.id || null, recordedAt,
        bySensor.chamberTemp.value, bySensor.humidity.value,
        bySensor.furnaceTemp.value, bySensor.blowerTemp.value,
        cyclePhase, includedInReport, snapshotQuality, recordedAt, receivedAt,
      ],
    );
    await connection.execute(
      `UPDATE ovens SET last_seen_at=? WHERE company_id=? AND id=?`,
      [receivedAt, batch.companyId, batch.ovenId],
    );
    await connection.execute(
      `UPDATE api_keys SET last_used_at=? WHERE id=? AND company_id=?`,
      [receivedAt, apiKeyRecord.id, batch.companyId],
    );
    await connection.commit();

    const rootState = global.get("stcrState");
    const companyState = rootState?.companies?.[batch.companyId];
    const oven = companyState?.ovens?.find((item) => item.id === batch.ovenId);
    if (oven) {
      const timestamp = recordedAt.toISOString();
      batch.readings.forEach((reading) => {
        oven.readings[reading.sensorKey] = {
          ...oven.readings[reading.sensorKey],
          value: reading.value,
          updatedAt: timestamp,
        };
      });
      oven.lastUpdatedAt = timestamp;
      const point = {
        timestamp,
        chamberTemp: bySensor.chamberTemp.value,
        humidity: bySensor.humidity.value,
        furnaceTemp: bySensor.furnaceTemp.value,
        blowerTemp: bySensor.blowerTemp.value,
      };
      companyState.history[batch.ovenId] = [...(companyState.history[batch.ovenId] || []), point].slice(-10000);
      global.set("stcrState", rootState);
    }
    return { recordedAt: recordedAt.toISOString(), quality: snapshotQuality, includedInReport };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

if (requestOrigin && !allowedOrigin) {
  return errorResponse("Origin is not allowed", 403, "ORIGIN_FORBIDDEN");
}

if (method === "OPTIONS") {
  msg.statusCode = 204;
  msg.headers = responseHeaders();
  msg.payload = "";
  return msg;
}

const rateLimitKind = path === "/stcr/api/auth/login"
  ? "login"
  : path === "/stcr/api/telemetry" ? "telemetry" : "api";
const rateLimit = rateLimitKind === "login" ? 10 : rateLimitKind === "telemetry" ? 120 : 180;
const rateWindowMs = rateLimitKind === "login" ? 15 * 60 * 1000 : 60 * 1000;
if (!checkRateLimit(rateLimitKind, rateLimit, rateWindowMs)) {
  return errorResponse("ส่งคำขอถี่เกินไป กรุณารอสักครู่", 429, "RATE_LIMITED", { "Retry-After": "60" });
}

const contentLength = Number(requestHeaders["content-length"] || 0);
if (contentLength > maxBodyBytes || (typeof msg.payload === "string" && msg.payload.length > maxBodyBytes)) {
  return errorResponse("Request body is too large", 413, "PAYLOAD_TOO_LARGE");
}

if (method === "POST" && path === "/stcr/api/auth/login") {
  const body = requestBody();
  const username = safeText(body?.username, 80);
  const password = typeof body?.password === "string" && body.password.length <= 256 ? body.password : "";
  let user = null;
  try {
    user = username ? await readUserForLogin(username) : null;
  } catch (error) {
    node.warn(`User database lookup failed: ${error.message}`);
    return errorResponse("ระบบยืนยันตัวตนไม่พร้อมใช้งาน", 503, "AUTH_DATABASE_UNAVAILABLE");
  }

  const lockedUntil = user?.lockedUntil ? new Date(user.lockedUntil).getTime() : 0;
  const accountEnabled = user && (
    user.status === "active" || (user.status === "locked" && lockedUntil > 0 && lockedUntil <= Date.now())
  );
  const validCompany = user && (user.companyId === "gr" || user.companyId === "ttn");
  const dummyHash = "argon2id$v=19$m=65536,t=3,p=1$00112233445566778899aabbccddeeff$e3f9e725738cc2a36f827442ce63603b1d51b7eeebff642c1854010c07bdb681";
  const passwordMatches = verifyPassword(
    password,
    accountEnabled && user.passwordAlgorithm === "argon2id" ? user.passwordHash : dummyHash,
  );
  const valid = Boolean(validCompany && accountEnabled && passwordMatches);
  if (!valid) {
    await recordLoginFailure(user).catch((error) => node.warn(`Login failure audit failed: ${error.message}`));
    return errorResponse("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", 401, "INVALID_CREDENTIALS");
  }

  await recordLoginSuccess(user.id);

  const ttlMinutes = Math.min(1440, Math.max(15, Number(env.get("STCR_SESSION_TTL_MINUTES") || 480)));
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAtMs = Date.now() + ttlMinutes * 60 * 1000;
  const sessions = cleanupSessions();
  sessions[token] = { userId: user.id, username, companyId: user.companyId, roles: user.roles, expiresAtMs };
  global.set("stcrAuthSessions", sessions);
  return jsonResponse({
    token,
    username,
    companyId: user.companyId,
    roles: user.roles,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
}

if (method === "GET" && path === "/stcr/api/health") {
  const rootState = global.get("stcrState");
  return jsonResponse({ ok: Boolean(rootState?.companies), timestamp: new Date().toISOString() });
}

if (method === "POST" && path === "/stcr/api/telemetry") {
  const batch = normalizeTelemetryBatch(requestBody());
  if (!batch) return errorResponse("รูปแบบข้อมูล telemetry ไม่ถูกต้อง", 400, "INVALID_TELEMETRY");
  const apiKey = String(requestHeaders["x-api-key"] || "").trim();
  let apiKeyRecord = null;
  try {
    apiKeyRecord = await authenticateApiKey(batch.companyId, batch.ovenId, apiKey);
  } catch (error) {
    node.warn(`API key database lookup failed: ${error.message}`);
    return errorResponse("ระบบรับข้อมูลไม่พร้อมใช้งาน", 503, "INGEST_DATABASE_UNAVAILABLE");
  }
  if (!apiKeyRecord) return errorResponse("API Key หรือขอบเขตบริษัท/เตาไม่ถูกต้อง", 401, "INVALID_API_KEY");

  try {
    const result = await persistHttpTelemetryBatch(batch, apiKeyRecord);
    return jsonResponse({
      accepted: true,
      companyId: batch.companyId,
      ovenId: batch.ovenId,
      batchId: batch.batchId,
      ...result,
    }, 202);
  } catch (error) {
    if (error.code === "OVEN_NOT_FOUND") {
      return errorResponse("ไม่พบเตาของบริษัทที่ระบุ", 404, "OVEN_NOT_FOUND");
    }
    node.warn(`Telemetry persistence failed: ${error.message}`);
    return errorResponse("บันทึกข้อมูล telemetry ไม่สำเร็จ", 500, "TELEMETRY_PERSIST_FAILED");
  }
}

const session = authenticate();
if (!session) return errorResponse("กรุณาเข้าสู่ระบบใหม่", 401, "UNAUTHORIZED");
try {
  if (!(await validateSessionAccount(session))) {
    return errorResponse("บัญชีถูกระงับหรือสิทธิ์หมดอายุ", 401, "ACCOUNT_INACTIVE");
  }
} catch (error) {
  node.warn(`Session account validation failed: ${error.message}`);
  return errorResponse("ระบบยืนยันสิทธิ์ไม่พร้อมใช้งาน", 503, "AUTH_DATABASE_UNAVAILABLE");
}

if (method === "POST" && path === "/stcr/api/auth/logout") {
  const token = String(requestHeaders.authorization).slice(7).trim();
  const sessions = cleanupSessions();
  delete sessions[token];
  global.set("stcrAuthSessions", sessions);
  return jsonResponse({ ok: true });
}

const requestedCompanyId = String(query.companyId || "").toLowerCase();
if (requestedCompanyId && requestedCompanyId !== session.companyId) {
  return errorResponse("ไม่มีสิทธิ์เข้าถึงข้อมูลบริษัทนี้", 403, "TENANT_FORBIDDEN");
}
const companyId = session.companyId;
const rootState = global.get("stcrState");
if (!rootState?.companies) return errorResponse("Simulator is not initialized", 503, "NOT_READY");
const state = rootState.companies[companyId];
if (!state) return errorResponse("Company data is not initialized", 503, "NOT_READY");
const visibleOvens = state.ovens;
const visibleOvenById = new Map(visibleOvens.map((oven) => [oven.id, oven]));

function persistState() {
  rootState.companies[companyId] = state;
  global.set("stcrState", rootState);
}

if (method === "GET" && path === "/stcr/api/ovens") return jsonResponse(visibleOvens);

if (method === "GET" && path === "/stcr/api/alarms") {
  const search = String(query.search || "").slice(0, 100).trim().toLowerCase();
  const alarms = state.alarms
    .filter((alarm) => visibleOvenById.has(alarm.ovenId))
    .map((alarm) => ({ ...alarm, ovenName: visibleOvenById.get(alarm.ovenId).name }))
    .filter((alarm) => {
      const severityMatch = !query.severity || query.severity === "all" || alarm.severity === query.severity;
      const statusMatch = !query.status || query.status === "all" || alarm.status === query.status;
      const ovenMatch = !query.ovenId || query.ovenId === "all" || alarm.ovenId === query.ovenId;
      const searchMatch = !search || `${alarm.ovenName} ${alarm.title} ${alarm.detail}`.toLowerCase().includes(search);
      return severityMatch && statusMatch && ovenMatch && searchMatch;
    });
  return jsonResponse(alarms);
}

if (method === "GET" && path === "/stcr/api/audit-events") {
  try {
    return jsonResponse(await readAuditEvents(companyId));
  } catch (error) {
    node.warn(`Audit database read fallback: ${error.message}`);
    return jsonResponse(state.auditEvents);
  }
}

if (method === "GET" && path === "/stcr/api/report-document-meta") {
  try {
    return jsonResponse(await readReportDocumentMeta(companyId));
  } catch (error) {
    node.warn(`Report document metadata read failed: ${error.message}`);
    return jsonResponse({ documentNo: "", effectiveDate: "" });
  }
}

if (method === "PUT" && path === "/stcr/api/report-document-meta") {
  if (!hasAnyRole(session, ["admin"])) {
    return errorResponse("ไม่มีสิทธิ์แก้ไขข้อมูลเอกสาร", 403, "ROLE_FORBIDDEN");
  }
  const body = requestBody();
  const documentNo = safeText(body?.documentNo, 80);
  const effectiveDate = safeText(body?.effectiveDate, 40);
  if (!documentNo || !effectiveDate) {
    return errorResponse("ข้อมูลเอกสารไม่ถูกต้อง", 400, "INVALID_REPORT_DOCUMENT_META");
  }

  const pool = getDatabasePool();
  await pool.execute(
    `INSERT INTO report_document_settings (
       company_id, document_no, effective_date, updated_by
     ) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       document_no=VALUES(document_no), effective_date=VALUES(effective_date),
       updated_by=VALUES(updated_by), updated_at=CURRENT_TIMESTAMP(3)`,
    [companyId, documentNo, effectiveDate, session.username],
  );
  await addAudit(
    state,
    session,
    "แก้ไขข้อมูลเอกสารรายงาน",
    documentNo,
    `เริ่มใช้วันที่ ${effectiveDate}`,
  );
  persistState();
  return jsonResponse({ documentNo, effectiveDate });
}

if (method === "POST" && path === "/stcr/api/ovens") {
  if (!hasAnyRole(session, ["admin"])) {
    return errorResponse("ไม่มีสิทธิ์เพิ่มเตา", 403, "ROLE_FORBIDDEN");
  }
  const nextNumber = Math.max(0, ...state.ovens.map((oven) => Number(oven.number) || 0)) + 1;
  const now = new Date().toISOString();
  const limits = JSON.parse(JSON.stringify(state.ovens[0]?.limits || {}));
  const values = { chamberTemp: 0, humidity: 0, furnaceTemp: 0, blowerTemp: 0 };
  const readings = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
    key,
    value,
    unit: key === "humidity" ? "%" : "C",
    updatedAt: now,
  }]));
  const oven = {
    id: `oven-${nextNumber}`,
    number: nextNumber,
    name: `เตา ${nextNumber}`,
    zone: "B",
    line: "Line 2",
    status: "closed",
    enabled: true,
    cycleCount: 0,
    stoppedAt: now,
    lastUpdatedAt: now,
    readings,
    limits,
  };
  state.ovens.push(oven);
  state.history[oven.id] = [];
  await addAudit(state, session, "เพิ่มเตาใหม่", oven.name, "เพิ่มเตาผ่าน Node-RED API");
  persistState();
  return jsonResponse(oven, 201);
}

const acknowledgeMatch = path.match(/^\/stcr\/api\/alarms\/([^/]+)\/acknowledge$/);
if (method === "POST" && acknowledgeMatch) {
  if (!hasAnyRole(session, ["admin", "operator"])) {
    return errorResponse("ไม่มีสิทธิ์รับทราบ Alarm", 403, "ROLE_FORBIDDEN");
  }
  const alarmId = decodeURIComponent(acknowledgeMatch[1]);
  if (!state.alarms.some((alarm) => alarm.id === alarmId)) return errorResponse("Alarm not found", 404, "NOT_FOUND");
  state.alarms = state.alarms.map((alarm) => alarm.id === alarmId ? { ...alarm, status: "acknowledged" } : alarm);
  await addAudit(state, session, "รับทราบ Alarm", alarmId, "รับทราบผ่านหน้าเว็บ");
  persistState();
  return jsonResponse(state.alarms);
}

const reportMetaMatch = path.match(/^\/stcr\/api\/ovens\/([^/]+)\/cycles\/(\d+)\/report-meta$/);
if (method === "GET" && reportMetaMatch) {
  const ovenId = decodeURIComponent(reportMetaMatch[1]);
  const cycleNumber = Number(reportMetaMatch[2]);
  if (!visibleOvenById.has(ovenId) || !Number.isSafeInteger(cycleNumber) || cycleNumber < 1) {
    return errorResponse("ไม่พบเตาหรือรอบที่ระบุ", 404, "NOT_FOUND");
  }
  const pool = getDatabasePool();
  const [rows] = await pool.execute(
    `SELECT rubber_type AS rubberType, smoking_period_status AS smokingPeriodStatus,
            temperature_control_status AS temperatureControlStatus, report_reason AS reason,
            input_weight_kg AS inputNetWeightKg, output_weight_kg AS outputNetWeightKg,
            firewood_weight_kg AS firewoodWeightKg
     FROM oven_cycles
     WHERE company_id=? AND oven_id=? AND cycle_number=?
     LIMIT 1`,
    [companyId, ovenId, cycleNumber],
  );
  if (!rows[0]) return errorResponse("ไม่พบรอบที่ระบุ", 404, "CYCLE_NOT_FOUND");
  const row = rows[0];
  return jsonResponse({
    ...row,
    inputNetWeightKg: row.inputNetWeightKg == null ? null : Number(row.inputNetWeightKg),
    outputNetWeightKg: row.outputNetWeightKg == null ? null : Number(row.outputNetWeightKg),
    firewoodWeightKg: row.firewoodWeightKg == null ? null : Number(row.firewoodWeightKg),
  });
}
if (method === "PUT" && reportMetaMatch) {
  if (!hasAnyRole(session, ["admin", "operator"])) {
    return errorResponse("ไม่มีสิทธิ์บันทึกข้อมูลรอบรายงาน", 403, "ROLE_FORBIDDEN");
  }
  const ovenId = decodeURIComponent(reportMetaMatch[1]);
  const cycleNumber = Number(reportMetaMatch[2]);
  if (!visibleOvenById.has(ovenId) || !Number.isSafeInteger(cycleNumber) || cycleNumber < 1) {
    return errorResponse("ไม่พบเตาหรือรอบที่ระบุ", 404, "NOT_FOUND");
  }
  const body = requestBody();
  const rubberTypes = ["latex", "yellow", "black", "angka", "uss97", "uss96", "uss94"];
  const smokingStatuses = ["under", "over", "notReached"];
  const temperatureStatuses = ["underControl", "outOfControl"];
  const optionalEnum = (value, allowed) => value == null || value === "" ? null : allowed.includes(value) ? value : undefined;
  const optionalWeight = (value) => {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 1000000 ? number : undefined;
  };
  const rubberType = optionalEnum(body?.rubberType, rubberTypes);
  const smokingPeriodStatus = optionalEnum(body?.smokingPeriodStatus, smokingStatuses);
  const temperatureControlStatus = optionalEnum(body?.temperatureControlStatus, temperatureStatuses);
  const reason = body?.reason == null || body.reason === "" ? null : safeText(body.reason, 500);
  const invalidReason = body?.reason != null && body.reason !== "" && reason === null;
  const inputWeight = optionalWeight(body?.inputNetWeightKg);
  const outputWeight = optionalWeight(body?.outputNetWeightKg);
  const firewoodWeight = optionalWeight(body?.firewoodWeightKg);
  if (
    rubberType === undefined || smokingPeriodStatus === undefined ||
    temperatureControlStatus === undefined || invalidReason ||
    inputWeight === undefined || outputWeight === undefined || firewoodWeight === undefined
  ) {
    return errorResponse("ข้อมูลรอบรายงานไม่ถูกต้อง", 400, "INVALID_REPORT_META");
  }

  const pool = getDatabasePool();
  const [result] = await pool.execute(
    `UPDATE oven_cycles
     SET rubber_type=?, smoking_period_status=?, temperature_control_status=?, report_reason=?,
         input_weight_kg=?, output_weight_kg=?, firewood_weight_kg=?
     WHERE company_id=? AND oven_id=? AND cycle_number=?`,
    [
      rubberType, smokingPeriodStatus, temperatureControlStatus, reason,
      inputWeight, outputWeight, firewoodWeight, companyId, ovenId, cycleNumber,
    ],
  );
  if (!result.affectedRows) return errorResponse("ไม่พบรอบที่ระบุ", 404, "CYCLE_NOT_FOUND");
  await addAudit(
    state,
    session,
    "บันทึกข้อมูลรอบรายงาน",
    `${ovenId}/cycle-${cycleNumber}`,
    "บันทึกชนิดยาง ผลประเมิน น้ำหนักยาง และน้ำหนักไม้ฟืน",
  );
  persistState();
  return jsonResponse({ ok: true });
}

const historyMatch = path.match(/^\/stcr\/api\/ovens\/([^/]+)\/history$/);
if (method === "GET" && historyMatch) {
  const ovenId = decodeURIComponent(historyMatch[1]);
  const points = state.history[ovenId];
  if (!points || !visibleOvenById.has(ovenId)) return errorResponse("Oven not found", 404, "NOT_FOUND");
  if (!validHistoryQuery(query)) return errorResponse("ช่วงเวลาหรือรอบรายงานไม่ถูกต้อง (สูงสุด 14 วัน)", 400, "INVALID_HISTORY_RANGE");
  try {
    return jsonResponse(await readReportHistory(companyId, ovenId, query));
  } catch (error) {
    node.warn(`Database history fallback: ${error.message}`);
  }
  const startAt = query.startAt ? Date.parse(query.startAt) : Number.NEGATIVE_INFINITY;
  const endAt = query.endAt ? Date.parse(query.endAt) : Number.POSITIVE_INFINITY;
  return jsonResponse(points.filter((point) => {
    const timestamp = Date.parse(point.timestamp);
    return timestamp >= startAt && timestamp <= endAt;
  }).slice(-10000));
}

const exportMatch = path.match(/^\/stcr\/api\/ovens\/([^/]+)\/export\.csv$/);
if (method === "GET" && exportMatch) {
  const ovenId = decodeURIComponent(exportMatch[1]);
  const points = state.history[ovenId];
  if (!points || !visibleOvenById.has(ovenId)) return errorResponse("Oven not found", 404, "NOT_FOUND");
  const requestedSensors = String(query.sensors || sensorKeys.join(",")).split(",");
  if (!requestedSensors.length || requestedSensors.some((sensor) => !sensorKeys.includes(sensor))) {
    return errorResponse("Unknown sensor", 400, "INVALID_SENSOR");
  }
  const rows = [
    ["timestamp", ...requestedSensors],
    ...points.slice(-10000).map((point) => [point.timestamp, ...requestedSensors.map((sensor) => point[sensor])]),
  ];
  msg.statusCode = 200;
  msg.headers = {
    ...responseHeaders("text/csv; charset=utf-8"),
    "Content-Disposition": `attachment; filename="${companyId}-${ovenId}.csv"`,
  };
  msg.payload = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  return msg;
}

const limitsMatch = path.match(/^\/stcr\/api\/ovens\/([^/]+)\/limits$/);
if (method === "PUT" && limitsMatch) {
  if (!hasAnyRole(session, ["admin"])) {
    return errorResponse("ไม่มีสิทธิ์เปลี่ยนค่า Limit", 403, "ROLE_FORBIDDEN");
  }
  const ovenId = decodeURIComponent(limitsMatch[1]);
  const index = state.ovens.findIndex((oven) => oven.id === ovenId);
  if (index < 0) return errorResponse("Oven not found", 404, "NOT_FOUND");
  const body = requestBody();
  if (!body) return errorResponse("Invalid JSON body");
  const physicalRanges = {
    chamberTemp: [-20, 150],
    humidity: [0, 100],
    furnaceTemp: [-20, 1200],
    blowerTemp: [-20, 500],
  };
  const valid = sensorKeys.every((sensor) => {
    const lower = Number(body[sensor]?.lower);
    const upper = Number(body[sensor]?.upper);
    const [minimum, maximum] = physicalRanges[sensor];
    return Number.isFinite(lower) && Number.isFinite(upper) && lower >= minimum && upper <= maximum && lower <= upper;
  });
  if (!valid) return errorResponse("Invalid limits payload", 400, "INVALID_LIMITS");
  const normalizedLimits = Object.fromEntries(sensorKeys.map((sensor) => [sensor, {
    sensor,
    lower: Number(body[sensor].lower),
    upper: Number(body[sensor].upper),
  }]));
  state.ovens[index] = { ...state.ovens[index], limits: normalizedLimits };
  await addAudit(state, session, "เปลี่ยนค่า Limit", state.ovens[index].name, "บันทึก Upper/Lower ผ่าน Node-RED API");
  persistState();
  return jsonResponse(state.ovens[index]);
}

const ovenMatch = path.match(/^\/stcr\/api\/ovens\/([^/]+)$/);
if (ovenMatch) {
  const ovenId = decodeURIComponent(ovenMatch[1]);
  const index = state.ovens.findIndex((oven) => oven.id === ovenId);
  if (index < 0) return errorResponse("Oven not found", 404, "NOT_FOUND");
  if (method === "GET") return jsonResponse(visibleOvenById.get(ovenId));
  if (method === "PATCH") {
    if (!hasAnyRole(session, ["admin"])) {
      return errorResponse("ไม่มีสิทธิ์แก้ไขข้อมูลเตา", 403, "ROLE_FORBIDDEN");
    }
    const body = requestBody();
    if (!body) return errorResponse("Invalid JSON body");
    const name = body.name === undefined ? state.ovens[index].name : safeText(body.name, 80);
    const zone = body.zone === undefined ? state.ovens[index].zone : safeText(body.zone, 40);
    const line = body.line === undefined ? state.ovens[index].line : safeText(body.line, 40);
    if (!name || !zone || !line) return errorResponse("ข้อมูลเตาไม่ถูกต้อง", 400, "INVALID_OVEN");
    state.ovens[index] = { ...state.ovens[index], name, zone, line };
    await addAudit(state, session, "แก้ไขข้อมูลเตา", name, "แก้ชื่อ โซน หรือไลน์ผ่าน Node-RED API");
    persistState();
    return jsonResponse(state.ovens[index]);
  }
}

return errorResponse(`Route not found: ${method} ${path}`, 404, "NOT_FOUND");
