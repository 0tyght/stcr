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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

function parseAuthUsers() {
  const raw = String(env.get("STCR_AUTH_USERS_JSON") || "");
  if (context.get("stcrAuthConfigRaw") === raw) return context.get("stcrAuthUsers") || {};

  let users = {};
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) users = parsed;
  } catch {
    node.warn("STCR_AUTH_USERS_JSON is not valid JSON; all logins are disabled");
  }
  context.set("stcrAuthConfigRaw", raw);
  context.set("stcrAuthUsers", users);
  return users;
}

function verifyPassword(password, encodedHash) {
  const parts = String(encodedHash || "").split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;

  try {
    const salt = Buffer.from(parts[3], "hex");
    const expected = Buffer.from(parts[4], "hex");
    if (salt.length < 16 || expected.length !== 32) return false;
    const actual = crypto.pbkdf2Sync(password, salt, iterations, expected.length, "sha256");
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
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

function addAudit(state, session, action, target, detail) {
  state.auditEvents.unshift({
    id: `audit-${Date.now()}`,
    actor: session.username,
    action,
    target,
    detail,
    createdAt: new Date().toISOString(),
  });
  state.auditEvents = state.auditEvents.slice(0, 100);
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
  if (historyQuery.includeIgnition !== "true") conditions.push("r.included_in_report=TRUE");
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

if (!checkRateLimit(path === "/stcr/api/auth/login" ? "login" : "api", path === "/stcr/api/auth/login" ? 10 : 180, path === "/stcr/api/auth/login" ? 15 * 60 * 1000 : 60 * 1000)) {
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
  const users = parseAuthUsers();
  const user = username ? users[username] : null;
  const validCompany = user && (user.companyId === "gr" || user.companyId === "ttn");
  const dummyHash = "pbkdf2$sha256$310000$00112233445566778899aabbccddeeff$0000000000000000000000000000000000000000000000000000000000000000";
  const passwordMatches = verifyPassword(password, user?.passwordHash || dummyHash);
  const valid = Boolean(validCompany && passwordMatches);
  if (!valid) return errorResponse("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", 401, "INVALID_CREDENTIALS");

  const ttlMinutes = Math.min(1440, Math.max(15, Number(env.get("STCR_SESSION_TTL_MINUTES") || 480)));
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAtMs = Date.now() + ttlMinutes * 60 * 1000;
  const sessions = cleanupSessions();
  sessions[token] = { username, companyId: user.companyId, expiresAtMs };
  global.set("stcrAuthSessions", sessions);
  return jsonResponse({
    token,
    username,
    companyId: user.companyId,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
}

if (method === "GET" && path === "/stcr/api/health") {
  const rootState = global.get("stcrState");
  return jsonResponse({ ok: Boolean(rootState?.companies), timestamp: new Date().toISOString() });
}

const session = authenticate();
if (!session) return errorResponse("กรุณาเข้าสู่ระบบใหม่", 401, "UNAUTHORIZED");

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

if (method === "GET" && path === "/stcr/api/audit-events") return jsonResponse(state.auditEvents);

if (method === "POST" && path === "/stcr/api/ovens") {
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
  addAudit(state, session, "เพิ่มเตาใหม่", oven.name, "เพิ่มเตาผ่าน Node-RED API");
  persistState();
  return jsonResponse(oven, 201);
}

const acknowledgeMatch = path.match(/^\/stcr\/api\/alarms\/([^/]+)\/acknowledge$/);
if (method === "POST" && acknowledgeMatch) {
  const alarmId = decodeURIComponent(acknowledgeMatch[1]);
  if (!state.alarms.some((alarm) => alarm.id === alarmId)) return errorResponse("Alarm not found", 404, "NOT_FOUND");
  state.alarms = state.alarms.map((alarm) => alarm.id === alarmId ? { ...alarm, status: "acknowledged" } : alarm);
  addAudit(state, session, "รับทราบ Alarm", alarmId, "รับทราบผ่านหน้าเว็บ");
  persistState();
  return jsonResponse(state.alarms);
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
  addAudit(state, session, "เปลี่ยนค่า Limit", state.ovens[index].name, "บันทึก Upper/Lower ผ่าน Node-RED API");
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
    const body = requestBody();
    if (!body) return errorResponse("Invalid JSON body");
    const name = body.name === undefined ? state.ovens[index].name : safeText(body.name, 80);
    const zone = body.zone === undefined ? state.ovens[index].zone : safeText(body.zone, 40);
    const line = body.line === undefined ? state.ovens[index].line : safeText(body.line, 40);
    if (!name || !zone || !line) return errorResponse("ข้อมูลเตาไม่ถูกต้อง", 400, "INVALID_OVEN");
    state.ovens[index] = { ...state.ovens[index], name, zone, line };
    addAudit(state, session, "แก้ไขข้อมูลเตา", name, "แก้ชื่อ โซน หรือไลน์ผ่าน Node-RED API");
    persistState();
    return jsonResponse(state.ovens[index]);
  }
}

return errorResponse(`Route not found: ${method} ${path}`, 404, "NOT_FOUND");
