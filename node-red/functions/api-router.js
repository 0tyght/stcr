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
const configuredOfflineSeconds = Number(env.get("STCR_OFFLINE_THRESHOLD_SECONDS") || 180);
const offlineThresholdMs = Number.isFinite(configuredOfflineSeconds) && configuredOfflineSeconds >= 30
  ? configuredOfflineSeconds * 1000
  : 180 * 1000;
const sessionAccountRecheckMs = 60 * 1000;
const httpIngestEnabled =
  String(env.get("STCR_HTTP_INGEST_ENABLED") || "false").toLowerCase() === "true";
const defaultSensorRanges = {
  chamberTemp: { min: -40, max: 150 },
  humidity: { min: 0, max: 100 },
  furnaceTemp: { min: -40, max: 1000 },
  blowerTemp: { min: -40, max: 600 },
};

function readSensorRanges() {
  try {
    const configured = String(env.get("STCR_FACTORY_MQTT_SENSOR_RANGES_JSON") || "").trim();
    if (!configured) return defaultSensorRanges;
    const parsed = JSON.parse(configured);
    return Object.fromEntries(Object.keys(defaultSensorRanges).map((sensorKey) => {
      const min = Number(parsed?.[sensorKey]?.min);
      const max = Number(parsed?.[sensorKey]?.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) throw new Error(sensorKey);
      return [sensorKey, { min, max }];
    }));
  } catch (error) {
    node.warn(`Invalid sensor range configuration; safe defaults are active (${error.message})`);
    return defaultSensorRanges;
  }
}

const sensorRanges = readSensorRanges();
function validSensorValue(sensorKey, value) {
  if (value == null) return null;
  const number = Number(value);
  const range = sensorRanges[sensorKey];
  return Number.isFinite(number) && number >= range.min && number <= range.max ? number : null;
}

function rangeCondition(column, sensorKey) {
  const range = sensorRanges[sensorKey];
  return `${column} BETWEEN ${Number(range.min)} AND ${Number(range.max)}`;
}

function responseHeaders(contentType = "application/json; charset=utf-8") {
  return {
    "Content-Type": contentType,
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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
  // ลบ expired sessions จาก memory cache (ไม่ต้องทำ DB cleanup ทุก request)
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
  // ลองหาจาก memory cache ก่อน (fast path)
  const cached = cleanupSessions()[token];
  if (cached) return cached;
  return null;
}

async function authenticateFromDb(token) {
  // fallback: ดึง session จาก DB (กรณี Node-RED restart แล้ว cache หาย)
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  try {
    const pool = getDatabasePool();
    const [rows] = await pool.execute(
      `SELECT user_id AS userId, company_id AS companyId, username,
              roles, expires_at AS expiresAt
       FROM sessions
       WHERE token=? AND expires_at > UTC_TIMESTAMP(3)
       LIMIT 1`,
      [token],
    );
    const row = rows[0];
    if (!row) return null;
    const expiresAtMs = new Date(row.expiresAt).getTime();
    let roles;
    try { roles = typeof row.roles === "string" ? JSON.parse(row.roles) : row.roles; } catch { roles = ["viewer"]; }
    const session = { userId: row.userId, username: row.username, companyId: row.companyId, roles, expiresAtMs };
    // เก็บ cache กลับเข้า memory
    const sessions = global.get("stcrAuthSessions") || {};
    sessions[token] = session;
    global.set("stcrAuthSessions", sessions);
    return session;
  } catch {
    return null;
  }
}

async function createSession(user, ttlMinutes) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAtMs = Date.now() + ttlMinutes * 60 * 1000;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const session = {
    userId: user.id,
    username: user.username,
    companyId: user.companyId,
    roles: user.roles,
    expiresAtMs,
    accountCheckedAtMs: Date.now(),
  };

  // เขียนลง DB ก่อน แล้วค่อย cache ใน memory
  const pool = getDatabasePool();
  await pool.execute(
    `INSERT INTO sessions (token, user_id, company_id, username, roles, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at)`,
    [token, user.id, user.companyId, user.username, JSON.stringify(user.roles), expiresAt],
  );
  const sessions = cleanupSessions();
  sessions[token] = session;
  global.set("stcrAuthSessions", sessions);
  return { token, expiresAt, expiresAtMs };
}

async function deleteSession(token) {
  // ลบจากทั้ง memory และ DB
  const sessions = cleanupSessions();
  delete sessions[token];
  global.set("stcrAuthSessions", sessions);
  try {
    const pool = getDatabasePool();
    await pool.execute(`DELETE FROM sessions WHERE token=?`, [token]);
  } catch { /* ไม่หยุดถ้า DB error */ }
}

// cleanup DB sessions เก่า (รันครั้งแรกที่ Node-RED เริ่ม)
getDatabasePool().execute(`DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP(3)`)
  .catch((err) => node.warn(`Session cleanup failed: ${err.message}`));

async function validateSessionAccount(session) {
  if (!session?.userId) return false;
  const now = Date.now();
  if (
    Number.isFinite(session.accountCheckedAtMs) &&
    now - session.accountCheckedAtMs < sessionAccountRecheckMs
  ) {
    return true;
  }
  const pool = getDatabasePool();
  const [rows] = await pool.execute(
    `SELECT id FROM users
     WHERE id=? AND company_id=? AND username=? AND status='active'
       AND (locked_until IS NULL OR locked_until<=UTC_TIMESTAMP(3))
     LIMIT 1`,
    [session.userId, session.companyId, session.username],
  );
  const active = Boolean(rows[0]);
  if (active) session.accountCheckedAtMs = now;
  return active;
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
  pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'", (error) => {
      if (error) node.warn(`Cannot set database session to UTC: ${error.message}`);
    });
  });
  context.set("stcrApiDbPool", pool);
  return pool;
}

function databaseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function emptyReadings(updatedAt) {
  return {
    chamberTemp: { key: "chamberTemp", value: 0, unit: "C", updatedAt },
    humidity: { key: "humidity", value: 0, unit: "%", updatedAt },
    furnaceTemp: { key: "furnaceTemp", value: 0, unit: "C", updatedAt },
    blowerTemp: { key: "blowerTemp", value: 0, unit: "C", updatedAt },
  };
}

async function loadRuntimeStateFromDatabase() {
  const pool = getDatabasePool();
  const [ovenRows] = await pool.execute(
    `SELECT o.company_id AS companyId, o.id, o.oven_number AS ovenNumber,
            o.name, o.zone_name AS zoneName, o.line_name AS lineName,
            o.status, o.enabled, o.chamber_lower AS chamberLower,
            o.chamber_upper AS chamberUpper, o.humidity_lower AS humidityLower,
            o.humidity_upper AS humidityUpper, o.furnace_lower AS furnaceLower,
            o.furnace_upper AS furnaceUpper, o.blower_lower AS blowerLower,
            o.blower_upper AS blowerUpper, o.last_seen_at AS lastSeenAt,
            c.cycle_number AS cycleNumber, c.state AS cycleState,
            c.fired_at AS firedAt, c.report_started_at AS reportStartedAt,
            c.stopped_at AS stoppedAt,
            r.minute_at AS readingAt,
            (SELECT x.chamber_temp_last FROM sensor_minute_aggregates x
             WHERE x.company_id=o.company_id AND x.oven_id=o.id
               AND x.minute_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY
               AND ${rangeCondition("x.chamber_temp_last", "chamberTemp")}
             ORDER BY x.minute_at DESC LIMIT 1) AS chamberTemp,
            (SELECT x.minute_at FROM sensor_minute_aggregates x
             WHERE x.company_id=o.company_id AND x.oven_id=o.id
               AND x.minute_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY
               AND ${rangeCondition("x.chamber_temp_last", "chamberTemp")}
             ORDER BY x.minute_at DESC LIMIT 1) AS chamberAt,
            (SELECT x.humidity_last FROM sensor_minute_aggregates x
             WHERE x.company_id=o.company_id AND x.oven_id=o.id
               AND x.minute_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY
               AND ${rangeCondition("x.humidity_last", "humidity")}
             ORDER BY x.minute_at DESC LIMIT 1) AS humidity,
            (SELECT x.minute_at FROM sensor_minute_aggregates x
             WHERE x.company_id=o.company_id AND x.oven_id=o.id
               AND x.minute_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY
               AND ${rangeCondition("x.humidity_last", "humidity")}
             ORDER BY x.minute_at DESC LIMIT 1) AS humidityAt,
            (SELECT x.furnace_temp_last FROM sensor_minute_aggregates x
             WHERE x.company_id=o.company_id AND x.oven_id=o.id
               AND x.minute_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY
               AND ${rangeCondition("x.furnace_temp_last", "furnaceTemp")}
             ORDER BY x.minute_at DESC LIMIT 1) AS furnaceTemp,
            (SELECT x.minute_at FROM sensor_minute_aggregates x
             WHERE x.company_id=o.company_id AND x.oven_id=o.id
               AND x.minute_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY
               AND ${rangeCondition("x.furnace_temp_last", "furnaceTemp")}
             ORDER BY x.minute_at DESC LIMIT 1) AS furnaceAt,
            (SELECT x.blower_temp_last FROM sensor_minute_aggregates x
             WHERE x.company_id=o.company_id AND x.oven_id=o.id
               AND x.minute_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY
               AND ${rangeCondition("x.blower_temp_last", "blowerTemp")}
             ORDER BY x.minute_at DESC LIMIT 1) AS blowerTemp,
            (SELECT x.minute_at FROM sensor_minute_aggregates x
             WHERE x.company_id=o.company_id AND x.oven_id=o.id
               AND x.minute_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY
               AND ${rangeCondition("x.blower_temp_last", "blowerTemp")}
             ORDER BY x.minute_at DESC LIMIT 1) AS blowerAt
     FROM ovens o
     LEFT JOIN oven_cycles c ON c.id=(
       SELECT c2.id FROM oven_cycles c2
       WHERE c2.company_id=o.company_id AND c2.oven_id=o.id
       ORDER BY c2.cycle_number DESC, c2.id DESC LIMIT 1
     )
     LEFT JOIN sensor_minute_aggregates r
       ON r.company_id=o.company_id AND r.oven_id=o.id AND r.minute_at=(
       SELECT MAX(r2.minute_at) FROM sensor_minute_aggregates r2
       WHERE r2.company_id=o.company_id AND r2.oven_id=o.id
     )
     WHERE o.enabled=TRUE
     ORDER BY o.company_id, o.oven_number`,
  );
  const [alarmRows] = await pool.execute(
    `SELECT id, company_id AS companyId, oven_id AS ovenId, sensor_key AS sensorKey,
            severity, status, title, detail, measured_value AS measuredValue,
            limit_value AS limitValue, created_at AS createdAt, resolved_at AS resolvedAt
     FROM alarms
     ORDER BY created_at DESC
     LIMIT 400`,
  );

  const companies = {};
  for (const row of ovenRows) {
    const companyId = String(row.companyId || "");
    if (!["gr", "ttn"].includes(companyId)) continue;
    companies[companyId] ||= {
      companyId,
      ovens: [],
      history: {},
      archivedCycles: {},
      alarms: [],
      auditEvents: [],
    };

    const lastUpdatedAt = databaseTimestamp(row.readingAt || row.lastSeenAt) || new Date(0).toISOString();
    const readings = emptyReadings(lastUpdatedAt);
    if (row.readingAt) {
      const latestValues = {
        chamberTemp: [validSensorValue("chamberTemp", row.chamberTemp), row.chamberAt],
        humidity: [validSensorValue("humidity", row.humidity), row.humidityAt],
        furnaceTemp: [validSensorValue("furnaceTemp", row.furnaceTemp), row.furnaceAt],
        blowerTemp: [validSensorValue("blowerTemp", row.blowerTemp), row.blowerAt],
      };
      for (const [sensorKey, [value, valueAt]] of Object.entries(latestValues)) {
        if (value != null) {
          readings[sensorKey].value = value;
          readings[sensorKey].updatedAt = databaseTimestamp(valueAt) || lastUpdatedAt;
        }
      }
    }
    const firedAt = databaseTimestamp(row.firedAt);
    const reportStartedAt = databaseTimestamp(row.reportStartedAt);
    const stoppedAt = databaseTimestamp(row.stoppedAt);
    const oven = {
      id: String(row.id),
      number: Number(row.ovenNumber),
      name: String(row.name),
      zone: String(row.zoneName),
      line: String(row.lineName),
      status: ["open", "closed", "offline"].includes(row.status) ? row.status : "offline",
      enabled: Boolean(row.enabled),
      cycleCount: Number(row.cycleNumber || 0),
      ...(firedAt ? { firedAt } : {}),
      ...(reportStartedAt ? { reportStartedAt, startedAt: reportStartedAt } : {}),
      ...(stoppedAt ? { stoppedAt } : {}),
      lastUpdatedAt,
      readings,
      limits: {
        chamberTemp: { sensor: "chamberTemp", lower: Number(row.chamberLower), upper: Number(row.chamberUpper) },
        humidity: { sensor: "humidity", lower: Number(row.humidityLower), upper: Number(row.humidityUpper) },
        furnaceTemp: { sensor: "furnaceTemp", lower: Number(row.furnaceLower), upper: Number(row.furnaceUpper) },
        blowerTemp: { sensor: "blowerTemp", lower: Number(row.blowerLower), upper: Number(row.blowerUpper) },
      },
    };
    companies[companyId].ovens.push(oven);
    companies[companyId].history[oven.id] = [];
    companies[companyId].archivedCycles[oven.id] = [];
  }

  for (const row of alarmRows) {
    const company = companies[row.companyId];
    if (!company || !company.ovens.some((oven) => oven.id === row.ovenId)) continue;
    const createdAt = databaseTimestamp(row.createdAt) || new Date().toISOString();
    const resolvedAt = databaseTimestamp(row.resolvedAt);
    company.alarms.push({
      id: String(row.id),
      ovenId: String(row.ovenId),
      severity: row.severity,
      status: row.status,
      ...(row.sensorKey ? { sensor: row.sensorKey } : {}),
      title: String(row.title),
      detail: String(row.detail),
      ...(row.measuredValue == null ? {} : { value: Number(row.measuredValue) }),
      ...(row.limitValue == null ? {} : { limit: Number(row.limitValue) }),
      createdAt,
      ...(resolvedAt ? { resolvedAt } : {}),
    });
  }

  if (!Object.keys(companies).length) throw new Error("No enabled ovens found in database");
  const rootState = { version: "database-1", companies };
  global.set("stcrState", rootState);
  return rootState;
}

async function applyOfflineThreshold(rootState, referenceDate = new Date()) {
  if (!rootState?.companies) return rootState;

  const nowMs = referenceDate.getTime();
  const changed = [];
  const recovered = [];

  for (const [companyId, company] of Object.entries(rootState.companies)) {
    for (const oven of company.ovens || []) {
      const lastUpdatedMs = Date.parse(
        String(oven.lastUpdatedAt || ""),
      );

      const stale =
        !Number.isFinite(lastUpdatedMs) ||
        nowMs - lastUpdatedMs > offlineThresholdMs;
      const hasActiveOfflineAlarm = (company.alarms || []).some(
        (alarm) =>
          alarm.ovenId === oven.id &&
          alarm.severity === "offline" &&
          alarm.status !== "resolved",
      );

      if (stale && (oven.status !== "offline" || !hasActiveOfflineAlarm)) {
        oven.status = "offline";
        changed.push({
          companyId,
          ovenId: oven.id,
          lastUpdatedMs: Number.isFinite(lastUpdatedMs) ? lastUpdatedMs : 0,
        });
      } else if (
        !stale &&
        oven.status !== "offline" &&
        hasActiveOfflineAlarm
      ) {
        recovered.push({ companyId, ovenId: oven.id });
      }
    }
  }

  if (!changed.length && !recovered.length) return rootState;

  global.set("stcrState", rootState);

  try {
    const pool = getDatabasePool();

    await Promise.all([
      ...changed.map(async ({ companyId, ovenId, lastUpdatedMs }) => {
        await pool.execute(
          `UPDATE ovens
           SET status='offline'
           WHERE company_id=?
             AND id=?
             AND status<>'offline'`,
          [companyId, ovenId],
        );
        const alarmKey = crypto
          .createHash("sha256")
          .update(`${companyId}|${ovenId}|${lastUpdatedMs}`)
          .digest("hex")
          .slice(0, 32);
        const alarmId = `offline-${companyId}-${alarmKey}`;
        await pool.execute(
          `INSERT INTO alarms (
             id, company_id, oven_id, cycle_id, sensor_key, severity, status,
             title, detail, measured_value, limit_value, created_at
           ) VALUES (?, ?, ?, NULL, NULL, 'offline', 'active', ?, ?, NULL, NULL, ?)
           ON DUPLICATE KEY UPDATE
             status='active', acknowledged_at=NULL, resolved_at=NULL,
             detail=VALUES(detail), created_at=VALUES(created_at)`,
          [
            alarmId,
            companyId,
            ovenId,
            "ขาดการเชื่อมต่อ",
            `ไม่ได้รับข้อมูลจากเตานานเกิน ${Math.round(offlineThresholdMs / 1000)} วินาที`,
            referenceDate,
          ],
        );
        const company = rootState.companies[companyId];
        company.alarms = company.alarms.filter((alarm) => alarm.id !== alarmId);
        company.alarms.unshift({
          id: alarmId,
          ovenId,
          severity: "offline",
          status: "active",
          title: "ขาดการเชื่อมต่อ",
          detail: `ไม่ได้รับข้อมูลจากเตานานเกิน ${Math.round(offlineThresholdMs / 1000)} วินาที`,
          createdAt: referenceDate.toISOString(),
        });
      }),
      ...recovered.map(async ({ companyId, ovenId }) => {
        await pool.execute(
          `UPDATE alarms
           SET status='resolved', resolved_at=COALESCE(resolved_at, ?)
           WHERE company_id=? AND oven_id=? AND severity='offline'
             AND status IN ('active','acknowledged')`,
          [referenceDate, companyId, ovenId],
        );
        const company = rootState.companies[companyId];
        company.alarms = company.alarms.map((alarm) =>
          alarm.ovenId === ovenId && alarm.severity === "offline" && alarm.status !== "resolved"
            ? { ...alarm, status: "resolved", resolvedAt: referenceDate.toISOString() }
            : alarm,
        );
      }),
    ]);
    global.set("stcrState", rootState);
  } catch (error) {
    node.warn(
      `Offline status persistence failed: ${error.message}`,
    );
  }

  return rootState;
}

async function ensureRuntimeState() {
  const existing = global.get("stcrState");

  if (
    existing?.companies &&
    Object.keys(existing.companies).length
  ) {
    return applyOfflineThreshold(existing);
  }

  let loading = context.get("stcrRuntimeStateLoading");

  if (!loading) {
    loading = loadRuntimeStateFromDatabase().finally(() =>
      context.set("stcrRuntimeStateLoading", undefined),
    );

    context.set("stcrRuntimeStateLoading", loading);
  }

  return applyOfflineThreshold(await loading);
}

async function readReportHistory(companyId, ovenId, historyQuery) {
  const conditions = [
    "a.company_id=?",
    "a.oven_id=?",
  ];

  const values = [
    companyId,
    ovenId,
  ];

  if (historyQuery.includeIgnition !== "true") {
    conditions.push("a.included_in_report=TRUE");
  }

  if (historyQuery.startAt) {
    conditions.push("a.minute_at>=?");
    values.push(historyQuery.startAt);
  }

  if (historyQuery.endAt) {
    conditions.push("a.minute_at<=?");
    values.push(historyQuery.endAt);
  }

  if (historyQuery.cycleNumber) {
    conditions.push("a.cycle_number=?");
    values.push(Number(historyQuery.cycleNumber));
  }

  const pool = getDatabasePool();

  await pool.query("SET time_zone = '+00:00'");

  const requestedRangeMs =
    historyQuery.startAt && historyQuery.endAt
      ? Math.max(
          0,
          Date.parse(historyQuery.endAt) -
            Date.parse(historyQuery.startAt),
        )
      : 0;

  const bucketSeconds =
    requestedRangeMs > 24 * 60 * 60 * 1000
      ? 600
      : 60;

  const [rows] = await pool.execute(
    `SELECT
       DATE_FORMAT(
         MIN(a.minute_at),
         '%Y-%m-%dT%H:%i:%s.000Z'
       ) AS timestamp,

       SUM(
         CASE WHEN ${rangeCondition("a.chamber_temp_avg", "chamberTemp")} THEN a.chamber_temp_avg ELSE NULL END *
         a.chamber_temp_count
       ) /
       NULLIF(
         SUM(CASE WHEN ${rangeCondition("a.chamber_temp_avg", "chamberTemp")} THEN a.chamber_temp_count ELSE 0 END),
         0
       ) AS chamberTemp,

       SUM(
         CASE WHEN ${rangeCondition("a.humidity_avg", "humidity")} THEN a.humidity_avg ELSE NULL END *
         a.humidity_count
       ) /
       NULLIF(
         SUM(CASE WHEN ${rangeCondition("a.humidity_avg", "humidity")} THEN a.humidity_count ELSE 0 END),
         0
       ) AS humidity,

       SUM(
         CASE WHEN ${rangeCondition("a.furnace_temp_avg", "furnaceTemp")} THEN a.furnace_temp_avg ELSE NULL END *
         a.furnace_temp_count
       ) /
       NULLIF(
         SUM(CASE WHEN ${rangeCondition("a.furnace_temp_avg", "furnaceTemp")} THEN a.furnace_temp_count ELSE 0 END),
         0
       ) AS furnaceTemp,

       SUM(
         CASE WHEN ${rangeCondition("a.blower_temp_avg", "blowerTemp")} THEN a.blower_temp_avg ELSE NULL END *
         a.blower_temp_count
       ) /
       NULLIF(
         SUM(CASE WHEN ${rangeCondition("a.blower_temp_avg", "blowerTemp")} THEN a.blower_temp_count ELSE 0 END),
         0
       ) AS blowerTemp

     FROM sensor_minute_aggregates a

     WHERE ${conditions.join(" AND ")}

     GROUP BY
       FLOOR(
         UNIX_TIMESTAMP(a.minute_at) /
         ${bucketSeconds}
       )

     ORDER BY MIN(a.minute_at) ASC

     LIMIT 10000`,
    values,
  );

  const nullableNumber = (value) =>
    value == null ? null : Number(value);

  return rows.map((row) => ({
    timestamp: row.timestamp,
    chamberTemp: nullableNumber(row.chamberTemp),
    humidity: nullableNumber(row.humidity),
    furnaceTemp: nullableNumber(row.furnaceTemp),
    blowerTemp: nullableNumber(row.blowerTemp),
  }));
}

async function readOvenDeleteCheck(
  companyId,
  ovenId,
  executor = getDatabasePool(),
) {
  const [ovenRows] = await executor.query(
    `SELECT id, oven_number, name, status
       FROM ovens
      WHERE company_id = ?
        AND id = ?
      LIMIT 1`,
    [companyId, ovenId],
  );

  if (!ovenRows.length) {
    return null;
  }

  const checks = [
    {
      key: "cycles",
      label: "รอบอบ",
      sql: "SELECT COUNT(*) AS count FROM oven_cycles WHERE company_id = ? AND oven_id = ?",
    },
    {
      key: "minuteAggregates",
      label: "ข้อมูลรายนาที",
      sql: "SELECT COUNT(*) AS count FROM sensor_minute_aggregates WHERE company_id = ? AND oven_id = ?",
    },
    {
      key: "sensorReadings",
      label: "ข้อมูลเซนเซอร์",
      sql: "SELECT COUNT(*) AS count FROM sensor_readings WHERE company_id = ? AND oven_id = ?",
    },
    {
      key: "telemetry",
      label: "ข้อมูล Telemetry",
      sql: "SELECT COUNT(*) AS count FROM telemetry_events WHERE company_id = ? AND oven_id = ?",
    },
    {
      key: "mqttMessages",
      label: "ข้อความ MQTT",
      sql: "SELECT COUNT(*) AS count FROM factory_mqtt_messages WHERE company_id = ? AND oven_id = ?",
    },
    {
      key: "alarms",
      label: "Alarm",
      sql: "SELECT COUNT(*) AS count FROM alarms WHERE company_id = ? AND oven_id = ?",
    },
    {
      key: "apiKeys",
      label: "API Key",
      sql: "SELECT COUNT(*) AS count FROM api_keys WHERE company_id = ? AND allowed_oven_id = ?",
    },
  ];

  const blockers = [];

  if (ovenRows[0].status === "open") {
    blockers.push({
      key: "open",
      label: "เตากำลังเปิด",
      count: 1,
    });
  }

  for (const check of checks) {
    const [rows] = await executor.query(check.sql, [companyId, ovenId]);
    const count = Number(rows[0]?.count || 0);

    if (count > 0) {
      blockers.push({
        key: check.key,
        label: check.label,
        count,
      });
    }
  }

  return {
    ovenId,
    ovenNumber: Number(ovenRows[0].oven_number),
    ovenName: String(ovenRows[0].name),
    canDelete: blockers.length === 0,
    blockers,
  };
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

function normalizeFactoryMqttRaw(body) {
  const companyId = safeText(body?.companyId, 32);
  const ovenId = safeText(body?.ovenId, 64);
  const topic = safeText(body?.topic, 128);
  const ovenNumber = Number(body?.ovenNumber);
  const cycleNumber = Number(body?.cycleNumber);
  const qos = Number(body?.qos);
  const sourceTimestampMs = Date.parse(body?.sourceTimestamp);
  const payload = body?.payload;
  const normalizationStatus = ["received", "normalized", "pending", "rejected"].includes(body?.normalizationStatus)
    ? body.normalizationStatus
    : "received";
  const normalizationDetail = body?.normalizationDetail == null || body.normalizationDetail === ""
    ? null
    : safeText(body.normalizationDetail, 255);
  if (
    !companyId || !new Set(["gr", "ttn"]).has(companyId) || !ovenId ||
    !new Set(["test", "sensor"]).has(topic) ||
    !Number.isSafeInteger(ovenNumber) || ovenNumber < 1 || ovenNumber > 10000 ||
    !Number.isSafeInteger(cycleNumber) || cycleNumber < 0 || cycleNumber > 1000000 ||
    !Number.isInteger(qos) || qos < 0 || qos > 2 || !Number.isFinite(sourceTimestampMs) ||
    !payload || typeof payload !== "object" || Array.isArray(payload) ||
    (body?.normalizationDetail && !normalizationDetail)
  ) return null;
  const payloadJson = JSON.stringify(payload);
  if (Buffer.byteLength(payloadJson, "utf8") > 8192) return null;
  return {
    companyId,
    ovenId,
    ovenNumber,
    cycleNumber,
    topic,
    qos,
    retained: Boolean(body?.retained),
    duplicateDelivery: Boolean(body?.duplicateDelivery),
    sourceTimestamp: new Date(sourceTimestampMs).toISOString(),
    payload,
    payloadJson,
    normalizationStatus,
    normalizationDetail,
  };
}

async function persistFactoryMqttRaw(envelope) {
  const messageHash = crypto.createHash("sha256").update([
    envelope.companyId,
    envelope.ovenId,
    envelope.topic,
    envelope.cycleNumber,
    envelope.sourceTimestamp,
    envelope.payloadJson,
  ].join("\n")).digest("hex");
  const pool = getDatabasePool();
  const [result] = await pool.execute(
    `INSERT INTO factory_mqtt_messages (
       company_id, oven_id, oven_number, cycle_number, topic, qos,
       retained, duplicate_delivery, source_timestamp, payload_json,
       message_hash, normalization_status, normalization_detail
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       duplicate_delivery=TRUE, received_at=CURRENT_TIMESTAMP(3),
       normalization_status=VALUES(normalization_status),
       normalization_detail=VALUES(normalization_detail)`,
    [
      envelope.companyId, envelope.ovenId, envelope.ovenNumber, envelope.cycleNumber,
      envelope.topic, envelope.qos, envelope.retained, envelope.duplicateDelivery,
      envelope.sourceTimestamp, envelope.payloadJson, messageHash,
      envelope.normalizationStatus, envelope.normalizationDetail,
    ],
  );
  const ovenState = Number(envelope.payload?.oven_state);
  if (envelope.topic === "test" && [0, 1].includes(ovenState)) {
    await pool.execute(
      `UPDATE ovens SET status=?, last_seen_at=CURRENT_TIMESTAMP(3)
       WHERE company_id=? AND id=? AND enabled=TRUE`,
      [ovenState === 1 ? "open" : "closed", envelope.companyId, envelope.ovenId],
    );
  } else {
    await pool.execute(
      `UPDATE ovens SET last_seen_at=CURRENT_TIMESTAMP(3)
       WHERE company_id=? AND id=? AND enabled=TRUE`,
      [envelope.companyId, envelope.ovenId],
    );
  }
  return { messageHash, duplicate: result.affectedRows > 1 };
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

    const rootState = await ensureRuntimeState().catch(() => global.get("stcrState"));
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
  const { token, expiresAt, expiresAtMs } = await createSession(user, ttlMinutes);
  return jsonResponse({
    token,
    username,
    companyId: user.companyId,
    roles: user.roles,
    expiresAt,
  });
}

if (method === "GET" && path === "/stcr/api/health") {
  try {
    const rootState = await ensureRuntimeState();
    const mqttHealth = global.get("stcrMqttHealth") || null;
    return jsonResponse({
      ok: Boolean(rootState?.companies),
      timestamp: new Date().toISOString(),
      mqtt: mqttHealth
        ? {
            connected: Boolean(mqttHealth.connected),
            lastMessageAt: mqttHealth.lastMessageAt || null,
            totalMessages: Number(mqttHealth.totalMessages || 0),
            topics: mqttHealth.topics || {},
          }
        : null,
    });
  } catch (error) {
    node.warn(`Runtime database initialization failed: ${error.message}`);
    return jsonResponse({ ok: false, timestamp: new Date().toISOString() }, 503);
  }
}

if (method === "POST" && path === "/stcr/api/factory-mqtt/raw") {
  if (!httpIngestEnabled) {
    return errorResponse("HTTP ingestion is disabled", 404, "INGEST_DISABLED");
  }
  const envelope = normalizeFactoryMqttRaw(requestBody());
  if (!envelope) return errorResponse("รูปแบบข้อมูล MQTT ต้นฉบับไม่ถูกต้อง", 400, "INVALID_FACTORY_MQTT");
  const apiKey = String(requestHeaders["x-api-key"] || "").trim();
  let apiKeyRecord = null;
  try {
    apiKeyRecord = await authenticateApiKey(envelope.companyId, envelope.ovenId, apiKey);
  } catch (error) {
    node.warn(`Factory MQTT API key lookup failed: ${error.message}`);
    return errorResponse("ระบบรับข้อมูล MQTT ยังไม่พร้อมใช้งาน", 503, "INGEST_DATABASE_UNAVAILABLE");
  }
  if (!apiKeyRecord) return errorResponse("API Key หรือผังบริษัท/เตาไม่ถูกต้อง", 401, "INVALID_API_KEY");

  try {
    const result = await persistFactoryMqttRaw(envelope);
    const rootState = global.get("stcrState");
    const oven = rootState?.companies?.[envelope.companyId]?.ovens?.find(
      (item) => item.id === envelope.ovenId,
    );
    if (oven) {
      oven.lastUpdatedAt = new Date().toISOString();
      const ovenState = Number(envelope.payload?.oven_state);
      if (envelope.topic === "test" && [0, 1].includes(ovenState)) {
        oven.status = ovenState === 1 ? "open" : "closed";
      }
      global.set("stcrState", rootState);
    }
    return jsonResponse({
      accepted: true,
      companyId: envelope.companyId,
      ovenId: envelope.ovenId,
      topic: envelope.topic,
      ...result,
    }, 202);
  } catch (error) {
    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return errorResponse("ไม่พบเตาที่จับคู่ไว้ในฐานข้อมูล", 404, "OVEN_NOT_FOUND");
    }
    node.warn(`Factory MQTT raw persistence failed: ${error.message}`);
    return errorResponse("บันทึกข้อมูล MQTT ต้นฉบับไม่สำเร็จ", 500, "MQTT_RAW_PERSIST_FAILED");
  }
}

if (method === "POST" && path === "/stcr/api/telemetry") {
  if (!httpIngestEnabled) {
    return errorResponse("HTTP ingestion is disabled", 404, "INGEST_DISABLED");
  }
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

// ตรวจ session — ลอง memory cache ก่อน ถ้าไม่มีลองดึงจาก DB
let resolvedSession = authenticate();
if (!resolvedSession) {
  const authHeader = String(requestHeaders.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (token) resolvedSession = await authenticateFromDb(token);
}
if (!resolvedSession) return errorResponse("กรุณาเข้าสู่ระบบใหม่", 401, "UNAUTHORIZED");
// alias ให้ใช้ชื่อ session ได้เหมือนเดิม
const session = resolvedSession;
try {
  if (!(await validateSessionAccount(resolvedSession))) {
    return errorResponse("บัญชีถูกระงับหรือสิทธิ์หมดอายุ", 401, "ACCOUNT_INACTIVE");
  }
} catch (error) {
  node.warn(`Session account validation failed: ${error.message}`);
  return errorResponse("ระบบยืนยันสิทธิ์ไม่พร้อมใช้งาน", 503, "AUTH_DATABASE_UNAVAILABLE");
}

const ovenDeleteCheckMatch = path.match(
    /^\/ovens\/([^/]+)\/delete-check$/,
  );

  if (method === "GET" && ovenDeleteCheckMatch) {
    if (!hasAnyRole(session, ["admin"])) {
      return errorResponse(
        "ไม่มีสิทธิ์ตรวจสอบการลบเตา",
        403,
        "FORBIDDEN",
      );
    }

    const ovenId = decodeURIComponent(ovenDeleteCheckMatch[1]);
    const result = await readOvenDeleteCheck(
      session.companyId,
      ovenId,
    );

    if (!result) {
      return errorResponse("ไม่พบเตาที่ต้องการ", 404, "OVEN_NOT_FOUND");
    }

    return jsonResponse(result);
  }

  const ovenDeleteMatch = path.match(
    /^\/ovens\/([^/]+)\/delete$/,
  );

  if (method === "POST" && ovenDeleteMatch) {
    if (!hasAnyRole(session, ["admin"])) {
      return errorResponse("ไม่มีสิทธิ์ลบเตา", 403, "FORBIDDEN");
    }

    const ovenId = decodeURIComponent(ovenDeleteMatch[1]);
    const pool = getDatabasePool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [lockedRows] = await connection.query(
        `SELECT id
           FROM ovens
          WHERE company_id = ?
            AND id = ?
          FOR UPDATE`,
        [session.companyId, ovenId],
      );

      if (!lockedRows.length) {
        await connection.rollback();
        return errorResponse(
          "ไม่พบเตาที่ต้องการ",
          404,
          "OVEN_NOT_FOUND",
        );
      }

      const check = await readOvenDeleteCheck(
        session.companyId,
        ovenId,
        connection,
      );

      if (!check?.canDelete) {
        await connection.rollback();

        const detail = (check?.blockers || [])
          .map((item) => `${item.label} ${item.count} รายการ`)
          .join(", ");

        return errorResponse(
          `ไม่สามารถลบเตาได้ เนื่องจากพบ ${detail}`,
          409,
          "OVEN_HAS_RELATED_DATA",
        );
      }

      await connection.query(
        "DELETE FROM ovens WHERE company_id = ? AND id = ?",
        [session.companyId, ovenId],
      );
      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Keep the original error.
      }

      throw error;
    } finally {
      connection.release();
    }

    const rootState = await loadRuntimeStateFromDatabase();
    const companyState = rootState.companies[session.companyId];

    await addAudit(
      companyState,
      session,
      "ลบเตา",
      ovenId,
      "ลบเตาที่ไม่มีข้อมูลอ้างอิง",
    );

    return jsonResponse({
      deleted: true,
      ovenId,
    });
  }

  if (method === "POST" && path === "/ovens") {
    if (!hasAnyRole(session, ["admin"])) {
      return errorResponse("ไม่มีสิทธิ์เพิ่มเตา", 403, "FORBIDDEN");
    }

    const body = requestBody();
    const ovenNumber = Number(body.number);
    const name = safeText(body.name, 160);
    const zone = safeText(body.zone, 120);
    const line = safeText(body.line, 120);

    if (!Number.isInteger(ovenNumber) || ovenNumber <= 0) {
      return errorResponse(
        "หมายเลขเตาต้องเป็นจำนวนเต็มมากกว่า 0",
        400,
        "INVALID_OVEN_NUMBER",
      );
    }

    if (!name || !zone || !line) {
      return errorResponse(
        "กรุณากรอกชื่อเตา โซน และไลน์ผลิตให้ครบ",
        400,
        "OVEN_FIELDS_REQUIRED",
      );
    }

    const pool = getDatabasePool();
    const [duplicateRows] = await pool.query(
      `SELECT oven_number, name
         FROM ovens
        WHERE company_id = ?
          AND (oven_number = ? OR LOWER(name) = LOWER(?))
        LIMIT 1`,
      [session.companyId, ovenNumber, name],
    );

    if (duplicateRows.length) {
      const duplicate = duplicateRows[0];
      const sameNumber = Number(duplicate.oven_number) === ovenNumber;

      return errorResponse(
        sameNumber
          ? `มีเตาหมายเลข ${ovenNumber} อยู่แล้ว`
          : `มีชื่อเตา ${name} อยู่แล้ว`,
        409,
        sameNumber ? "OVEN_NUMBER_EXISTS" : "OVEN_NAME_EXISTS",
      );
    }

    const ovenId = `oven-${ovenNumber}`;

    await pool.query(
      `INSERT INTO ovens (
         id,
         company_id,
         oven_number,
         name,
         zone_name,
         line_name,
         status,
         enabled,
         chamber_lower,
         chamber_upper,
         furnace_lower,
         furnace_upper,
         blower_lower,
         blower_upper,
         humidity_lower,
         humidity_upper
       ) VALUES (?, ?, ?, ?, ?, ?, 'offline', TRUE, 35, 60, 450, 550, 0, 1000, 0, 100)`,
      [
        ovenId,
        session.companyId,
        ovenNumber,
        name,
        zone,
        line,
      ],
    );

    const rootState = await loadRuntimeStateFromDatabase();
    const companyState = rootState.companies[session.companyId];
    const created = companyState.ovens.find(
      (oven) => oven.id === ovenId,
    );

    if (!created) {
      return errorResponse(
        "เพิ่มเตาแล้วแต่ไม่สามารถโหลดข้อมูลเตาใหม่ได้",
        500,
        "OVEN_RELOAD_FAILED",
      );
    }

    await addAudit(
      companyState,
      session,
      "เพิ่มเตา",
      ovenId,
      `เพิ่ม ${name} หมายเลข ${ovenNumber}`,
    );

    return jsonResponse(created, 201);
  }

  if (method === "POST" && path === "/stcr/api/auth/logout") {
  const token = String(requestHeaders.authorization).slice(7).trim();
  await deleteSession(token);
  return jsonResponse({ ok: true });
}

const requestedCompanyId = String(query.companyId || "").toLowerCase();
if (requestedCompanyId && requestedCompanyId !== resolvedSession.companyId) {
  return errorResponse("ไม่มีสิทธิ์เข้าถึงข้อมูลบริษัทนี้", 403, "TENANT_FORBIDDEN");
}
const companyId = resolvedSession.companyId;
let rootState;
try {
  rootState = await ensureRuntimeState();
} catch (error) {
  node.warn(`Runtime database initialization failed: ${error.message}`);
  return errorResponse("ระบบยังโหลดข้อมูลเตาจากฐานข้อมูลไม่สำเร็จ", 503, "NOT_READY");
}
const state = rootState.companies[companyId];
if (!state) return errorResponse("Company data is not initialized", 503, "NOT_READY");
const nowMs = Date.now();
const visibleOvens = state.ovens.map((oven) => ({
  ...oven,
  status: nowMs - Date.parse(oven.lastUpdatedAt) > offlineThresholdMs ? "offline" : oven.status,
}));
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
  const pool = getDatabasePool();
  await pool.execute(
    `INSERT INTO ovens (
       id, company_id, oven_number, name, zone_name, line_name, status, enabled,
       chamber_lower, chamber_upper, furnace_lower, furnace_upper,
       blower_lower, blower_upper, humidity_lower, humidity_upper, last_seen_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      oven.id, companyId, oven.number, oven.name, oven.zone, oven.line, oven.status,
      limits.chamberTemp.lower, limits.chamberTemp.upper,
      limits.furnaceTemp.lower, limits.furnaceTemp.upper,
      limits.blowerTemp.lower, limits.blowerTemp.upper,
      limits.humidity.lower, limits.humidity.upper, now,
    ],
  );
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
  const pool = getDatabasePool();
  const databaseAlarmIds = [...new Set([alarmId, `${companyId}-${alarmId}`])];
  const [acknowledgeResult] = await pool.execute(
    `UPDATE alarms
     SET status='acknowledged', acknowledged_at=COALESCE(acknowledged_at, UTC_TIMESTAMP(3))
     WHERE company_id=? AND id IN (?, ?) AND status='active'`,
    [companyId, databaseAlarmIds[0], databaseAlarmIds[1]],
  );
  if (!acknowledgeResult.affectedRows && String(env.get("STCR_DEPLOYMENT_MODE") || "").toLowerCase() === "production") {
    return errorResponse("ไม่พบ Alarm ที่ยังรอรับทราบในฐานข้อมูล", 409, "ALARM_STATE_CONFLICT");
  }
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
    `SELECT DATE_FORMAT(fired_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS firedAt,
            CASE WHEN report_started_at IS NULL THEN NULL
                 ELSE DATE_FORMAT(report_started_at, '%Y-%m-%dT%H:%i:%s.%fZ') END AS reportStartedAt,
            CASE WHEN stopped_at IS NULL THEN NULL
                 ELSE DATE_FORMAT(stopped_at, '%Y-%m-%dT%H:%i:%s.%fZ') END AS stoppedAt,
            rubber_type AS rubberType, smoking_period_status AS smokingPeriodStatus,
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
    if (String(env.get("STCR_DEPLOYMENT_MODE") || "").toLowerCase() === "production") {
      return errorResponse("ไม่สามารถอ่านข้อมูลย้อนหลังจากฐานข้อมูลได้", 503, "HISTORY_DATABASE_UNAVAILABLE");
    }
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
  const inMemoryPoints = state.history[ovenId];
  const oven = visibleOvenById.get(ovenId);
  if (!inMemoryPoints || !oven) return errorResponse("Oven not found", 404, "NOT_FOUND");
  const requestedSensors = String(query.sensors || sensorKeys.join(",")).split(",");
  if (!requestedSensors.length || requestedSensors.some((sensor) => !sensorKeys.includes(sensor))) {
    return errorResponse("Unknown sensor", 400, "INVALID_SENSOR");
  }
  const exportQuery = {
    ...query,
    cycleNumber: query.cycleNumber || (!query.startAt && oven.cycleCount > 0 ? String(oven.cycleCount) : undefined),
  };
  if (!validHistoryQuery(exportQuery)) {
    return errorResponse("ช่วงเวลาหรือรอบสำหรับส่งออกไม่ถูกต้อง", 400, "INVALID_EXPORT_RANGE");
  }
  let points;
  try {
    points = await readReportHistory(companyId, ovenId, exportQuery);
  } catch (error) {
    node.warn(`Database CSV export fallback: ${error.message}`);
    if (String(env.get("STCR_DEPLOYMENT_MODE") || "").toLowerCase() === "production") {
      return errorResponse("ไม่สามารถส่งออกข้อมูลจากฐานข้อมูลได้", 503, "EXPORT_DATABASE_UNAVAILABLE");
    }
    points = inMemoryPoints;
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
  const pool = getDatabasePool();
  await pool.execute(
    `UPDATE ovens
     SET chamber_lower=?, chamber_upper=?, humidity_lower=?, humidity_upper=?,
         furnace_lower=?, furnace_upper=?, blower_lower=?, blower_upper=?
     WHERE company_id=? AND id=?`,
    [
      normalizedLimits.chamberTemp.lower, normalizedLimits.chamberTemp.upper,
      normalizedLimits.humidity.lower, normalizedLimits.humidity.upper,
      normalizedLimits.furnaceTemp.lower, normalizedLimits.furnaceTemp.upper,
      normalizedLimits.blowerTemp.lower, normalizedLimits.blowerTemp.upper,
      companyId, ovenId,
    ],
  );
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
    const pool = getDatabasePool();
    await pool.execute(
      `UPDATE ovens SET name=?, zone_name=?, line_name=? WHERE company_id=? AND id=?`,
      [name, zone, line, companyId, ovenId],
    );
    state.ovens[index] = { ...state.ovens[index], name, zone, line };
    await addAudit(state, session, "แก้ไขข้อมูลเตา", name, "แก้ชื่อ โซน หรือไลน์ผ่าน Node-RED API");
    persistState();
    return jsonResponse(state.ovens[index]);
  }
}

return errorResponse(`Route not found: ${method} ${path}`, 404, "NOT_FOUND");
