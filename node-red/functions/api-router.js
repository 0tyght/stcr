function jsonResponse(payload, statusCode = 200) {
  msg.statusCode = statusCode;
  msg.headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Company-Id",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    "Cache-Control": "no-store",
  };
  msg.payload = payload;
  return msg;
}

function errorResponse(message, statusCode = 400) {
  return jsonResponse({ error: message }, statusCode);
}

function requestBody() {
  if (msg.payload && typeof msg.payload === "object") return msg.payload;
  if (typeof msg.payload === "string" && msg.payload.trim()) {
    try {
      return JSON.parse(msg.payload);
    } catch (error) {
      return null;
    }
  }
  return {};
}

function addAudit(state, action, target, detail) {
  state.auditEvents.unshift({
    id: `audit-${Date.now()}`,
    actor: "node-red",
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
  pool = mysql.createPool({
    host: env.get("STCR_DB_HOST") || "127.0.0.1",
    port: Number(env.get("STCR_DB_PORT") || 3306),
    user: env.get("STCR_DB_USER") || "stcr_app",
    password: env.get("STCR_DB_PASSWORD") || "",
    database: env.get("STCR_DB_NAME") || "stcr",
    waitForConnections: true,
    connectionLimit: 4,
    timezone: "Z",
  });
  context.set("stcrApiDbPool", pool);
  return pool;
}

async function readReportHistory(companyId, ovenId, query) {
  const conditions = ["r.company_id=?", "r.oven_id=?"];
  const values = [companyId, ovenId];
  if (query.includeIgnition !== "true") conditions.push("r.included_in_report=TRUE");
  if (query.startAt) {
    conditions.push("r.recorded_at>=?");
    values.push(query.startAt);
  }
  if (query.endAt) {
    conditions.push("r.recorded_at<=?");
    values.push(query.endAt);
  }
  if (query.cycleNumber) {
    conditions.push("c.cycle_number=?");
    values.push(Number(query.cycleNumber));
  }

  const pool = getDatabasePool();
  await pool.query("SET time_zone = '+00:00'");
  const requestedRangeMs = query.startAt && query.endAt
    ? Math.max(0, Date.parse(query.endAt) - Date.parse(query.startAt))
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
     ORDER BY MIN(r.recorded_at) ASC`,
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

const method = (msg.req.method || "GET").toUpperCase();
const path = msg.req.path || msg.req._parsedUrl.pathname;
const query = msg.req.query || {};
const requestHeaders = msg.req.headers || {};
const companyId = String(query.companyId || requestHeaders["x-company-id"] || "gr").toLowerCase();
const rootState = global.get("stcrState");
if (!rootState || !rootState.companies) return errorResponse("Simulator is not initialized", 503);
const state = rootState.companies[companyId];
if (!state) return errorResponse(`Unknown company: ${companyId}`, 404);
const visibleOvens = state.ovens;
const visibleOvenById = new Map(visibleOvens.map((oven) => [oven.id, oven]));

function persistState() {
  rootState.companies[companyId] = state;
  global.set("stcrState", rootState);
}

if (method === "OPTIONS") {
  msg.statusCode = 204;
  msg.headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Company-Id",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
  };
  msg.payload = "";
  return msg;
}

if (method === "GET" && path === "/stcr/api/health") {
  return jsonResponse({
    ok: true,
    companyId,
    ovens: state.ovens.length,
    sources: Object.keys(rootState.companies),
    timestamp: new Date().toISOString(),
  });
}

if (method === "GET" && path === "/stcr/api/ovens") {
  return jsonResponse(visibleOvens);
}

if (method === "GET" && path === "/stcr/api/alarms") {
  const search = String(query.search || "").trim().toLowerCase();
  const alarms = state.alarms.filter((alarm) => visibleOvenById.has(alarm.ovenId)).map((alarm) => ({
    ...alarm,
    ovenName: visibleOvenById.get(alarm.ovenId).name,
  })).filter((alarm) => {
    const severityMatch = !query.severity || query.severity === "all" || alarm.severity === query.severity;
    const statusMatch = !query.status || query.status === "all" || alarm.status === query.status;
    const ovenMatch = !query.ovenId || query.ovenId === "all" || alarm.ovenId === query.ovenId;
    const searchMatch = !search || `${alarm.ovenName} ${alarm.title} ${alarm.detail}`.toLowerCase().includes(search);
    return severityMatch && statusMatch && ovenMatch && searchMatch;
  });
  return jsonResponse(alarms);
}

if (method === "GET" && path === "/stcr/api/audit-events") {
  return jsonResponse(state.auditEvents);
}

if (method === "POST" && path === "/stcr/api/ovens") {
  const nextNumber = Math.max(...state.ovens.map((oven) => oven.number)) + 1;
  const now = new Date().toISOString();
  const limits = JSON.parse(JSON.stringify(state.ovens[0].limits));
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
  addAudit(state, "เพิ่มเตาใหม่", oven.name, "เพิ่มเตาผ่าน Node-RED API");
  persistState();
  return jsonResponse(oven, 201);
}

const acknowledgeMatch = path.match(/^\/stcr\/api\/alarms\/([^/]+)\/acknowledge$/);
if (method === "POST" && acknowledgeMatch) {
  const alarmId = decodeURIComponent(acknowledgeMatch[1]);
  state.alarms = state.alarms.map((alarm) => alarm.id === alarmId ? { ...alarm, status: "acknowledged" } : alarm);
  addAudit(state, "รับทราบ Alarm", alarmId, "รับทราบผ่านหน้าเว็บ");
  persistState();
  return jsonResponse(state.alarms);
}

const historyMatch = path.match(/^\/stcr\/api\/ovens\/([^/]+)\/history$/);
if (method === "GET" && historyMatch) {
  const ovenId = decodeURIComponent(historyMatch[1]);
  const points = state.history[ovenId];
  if (!points) return errorResponse(`Oven not found: ${ovenId}`, 404);
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
  }));
}

const exportMatch = path.match(/^\/stcr\/api\/ovens\/([^/]+)\/export\.csv$/);
if (method === "GET" && exportMatch) {
  const ovenId = decodeURIComponent(exportMatch[1]);
  const points = state.history[ovenId];
  if (!points) return errorResponse(`Oven not found: ${ovenId}`, 404);
  const sensors = String(query.sensors || "chamberTemp,humidity,furnaceTemp,blowerTemp").split(",");
  const rows = [["timestamp", ...sensors], ...points.map((point) => [point.timestamp, ...sensors.map((sensor) => point[sensor])])];
  msg.statusCode = 200;
  msg.headers = {
    "Content-Type": "text/csv; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };
  msg.payload = rows.map((row) => row.join(",")).join("\n");
  return msg;
}

const limitsMatch = path.match(/^\/stcr\/api\/ovens\/([^/]+)\/limits$/);
if (method === "PUT" && limitsMatch) {
  const ovenId = decodeURIComponent(limitsMatch[1]);
  const index = state.ovens.findIndex((oven) => oven.id === ovenId);
  if (index < 0) return errorResponse(`Oven not found: ${ovenId}`, 404);
  const body = requestBody();
  if (!body) return errorResponse("Invalid JSON body");
  const valid = ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"].every((sensor) =>
    body[sensor] && Number.isFinite(Number(body[sensor].lower)) && Number.isFinite(Number(body[sensor].upper)) && Number(body[sensor].lower) <= Number(body[sensor].upper)
  );
  if (!valid) return errorResponse("Invalid limits payload");
  state.ovens[index] = { ...state.ovens[index], limits: body };
  addAudit(state, "เปลี่ยนค่า Limit", state.ovens[index].name, "บันทึก Upper/Lower ผ่าน Node-RED API");
  persistState();
  return jsonResponse(
    state.ovens.find((oven) => oven.id === ovenId) || state.ovens[index],
  );
}

const ovenMatch = path.match(/^\/stcr\/api\/ovens\/([^/]+)$/);
if (ovenMatch) {
  const ovenId = decodeURIComponent(ovenMatch[1]);
  const index = state.ovens.findIndex((oven) => oven.id === ovenId);
  if (index < 0) return errorResponse(`Oven not found: ${ovenId}`, 404);

  if (method === "GET") return jsonResponse(visibleOvenById.get(ovenId) || state.ovens[index]);
  if (method === "PATCH") {
    const body = requestBody();
    if (!body) return errorResponse("Invalid JSON body");
    const current = state.ovens[index];
    state.ovens[index] = {
      ...current,
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name,
      zone: typeof body.zone === "string" && body.zone.trim() ? body.zone.trim() : current.zone,
      line: typeof body.line === "string" && body.line.trim() ? body.line.trim() : current.line,
    };
    addAudit(state, "แก้ไขข้อมูลเตา", state.ovens[index].name, "แก้ชื่อ โซน หรือไลน์ผ่าน Node-RED API");
    persistState();
    return jsonResponse(
      state.ovens.find((oven) => oven.id === ovenId) || state.ovens[index],
    );
  }
}

return errorResponse(`Route not found: ${method} ${path}`, 404);
