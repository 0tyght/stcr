function jsonResponse(payload, statusCode = 200) {
  msg.statusCode = statusCode;
  msg.headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

const state = flow.get("stcrState");
if (!state) return errorResponse("Simulator is not initialized", 503);

const method = (msg.req.method || "GET").toUpperCase();
const path = msg.req.path || msg.req._parsedUrl.pathname;
const query = msg.req.query || {};

if (method === "OPTIONS") {
  msg.statusCode = 204;
  msg.headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
  };
  msg.payload = "";
  return msg;
}

if (method === "GET" && path === "/stcr/api/health") {
  return jsonResponse({ ok: true, ovens: state.ovens.length, timestamp: new Date().toISOString() });
}

if (method === "GET" && path === "/stcr/api/ovens") {
  return jsonResponse(state.ovens);
}

if (method === "GET" && path === "/stcr/api/alarms") {
  const search = String(query.search || "").trim().toLowerCase();
  const alarms = state.alarms.filter((alarm) => {
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
  flow.set("stcrState", state);
  return jsonResponse(oven, 201);
}

const acknowledgeMatch = path.match(/^\/stcr\/api\/alarms\/([^/]+)\/acknowledge$/);
if (method === "POST" && acknowledgeMatch) {
  const alarmId = decodeURIComponent(acknowledgeMatch[1]);
  state.alarms = state.alarms.map((alarm) => alarm.id === alarmId ? { ...alarm, status: "acknowledged" } : alarm);
  addAudit(state, "รับทราบ Alarm", alarmId, "รับทราบผ่านหน้าเว็บ");
  flow.set("stcrState", state);
  return jsonResponse(state.alarms);
}

const historyMatch = path.match(/^\/stcr\/api\/ovens\/([^/]+)\/history$/);
if (method === "GET" && historyMatch) {
  const ovenId = decodeURIComponent(historyMatch[1]);
  const points = state.history[ovenId];
  if (!points) return errorResponse(`Oven not found: ${ovenId}`, 404);
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
  flow.set("stcrState", state);
  return jsonResponse(state.ovens[index]);
}

const ovenMatch = path.match(/^\/stcr\/api\/ovens\/([^/]+)$/);
if (ovenMatch) {
  const ovenId = decodeURIComponent(ovenMatch[1]);
  const index = state.ovens.findIndex((oven) => oven.id === ovenId);
  if (index < 0) return errorResponse(`Oven not found: ${ovenId}`, 404);

  if (method === "GET") return jsonResponse(state.ovens[index]);
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
    flow.set("stcrState", state);
    return jsonResponse(state.ovens[index]);
  }
}

return errorResponse(`Route not found: ${method} ${path}`, 404);
