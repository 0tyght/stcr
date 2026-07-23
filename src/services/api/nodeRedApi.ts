import type {
  Alarm,
  AlarmFilter,
  AuditEvent,
  HistoryQuery,
  LimitMap,
  Oven,
  OvenUpdateInput,
  ReportDocumentMeta,
  ReportCycleMeta,
  SensorKey,
  TimeSeriesPoint,
} from "../../types";
import type {
  AppApi,
  OvenCreateInput,
  OvenDeleteCheck,
} from "./contracts";
import { ApiError } from "./errors";
import { requestJson, requestText } from "./httpClient";

function requireArray<T>(value: unknown, endpoint: string): T[] {
  if (Array.isArray(value)) return value as T[];

  throw new ApiError(`รูปแบบข้อมูลจาก ${endpoint} ต้องเป็น array`, {
    code: "INVALID_RESPONSE",
  });
}

async function requestArray<T>(
  path: string,
  query?: URLSearchParams,
): Promise<T[]> {
  return requireArray<T>(await requestJson(path, undefined, query), path);
}

function historyQueryParams(query: HistoryQuery): URLSearchParams {
  const params = new URLSearchParams({
    preset: query.preset,
    sensors: query.sensors.join(","),
  });

  if (query.startAt) params.set("startAt", query.startAt);
  if (query.endAt) params.set("endAt", query.endAt);
  if (query.cycleNumber != null) {
    params.set("cycleNumber", String(query.cycleNumber));
  }
  if (query.includeIgnition) params.set("includeIgnition", "true");

  return params;
}

function alarmQueryParams(
  filter?: AlarmFilter,
): URLSearchParams | undefined {
  if (!filter) return undefined;

  return new URLSearchParams({
    severity: filter.severity,
    status: filter.status,
    ovenId: filter.ovenId,
    search: filter.search,
  });
}

export const nodeRedApi: AppApi = {
  getOvens: () => requestArray<Oven>("/ovens"),
  getRealtimeOvens: () => requestArray<Oven>("/ovens"),
  getOven: (ovenId) =>
    requestJson<Oven>(`/ovens/${encodeURIComponent(ovenId)}`),
  getHistory: (query) =>
    requestArray<TimeSeriesPoint>(
      `/ovens/${encodeURIComponent(query.ovenId)}/history`,
      historyQueryParams(query),
    ),
  getAlarms: (filter) =>
    requestArray<Alarm>("/alarms", alarmQueryParams(filter)),
  getAuditEvents: () => requestArray<AuditEvent>("/audit-events"),
  getReportDocumentMeta: () =>
    requestJson<ReportDocumentMeta>("/report-document-meta"),
  saveReportDocumentMeta: (meta) =>
    requestJson<ReportDocumentMeta>("/report-document-meta", {
      method: "PUT",
      body: meta,
    }),
  getReportCycleMeta: (ovenId, cycleNumber) =>
    requestJson<ReportCycleMeta>(
      `/ovens/${encodeURIComponent(ovenId)}/cycles/${cycleNumber}/report-meta`,
    ),
  saveReportCycleMeta: (ovenId, cycleNumber, meta) =>
    requestJson<ReportCycleMeta>(
      `/ovens/${encodeURIComponent(ovenId)}/cycles/${cycleNumber}/report-meta`,
      { method: "PUT", body: meta },
    ),
  saveLimits: (ovenId, limits) =>
    requestJson<Oven>(`/ovens/${encodeURIComponent(ovenId)}/limits`, {
      method: "PUT",
      body: limits,
    }),
  saveGlobalLimits: async (limits) =>
    requireArray<Oven>(
      await requestJson("/limits", {
        method: "PUT",
        body: limits,
      }),
      "/limits",
    ),
  updateOven: (ovenId, input) =>
    requestJson<Oven>(`/ovens/${encodeURIComponent(ovenId)}`, {
      method: "PATCH",
      body: input,
    }),
  addOven: (input: OvenCreateInput) =>
    requestJson<Oven>("/ovens", { method: "POST", body: input }),
  getOvenDeleteCheck: (ovenId) =>
    requestJson<OvenDeleteCheck>(
      `/ovens/${encodeURIComponent(ovenId)}/delete-check`,
    ),
  deleteOven: (ovenId) =>
    requestJson<{ deleted: true; ovenId: string }>(
      `/ovens/${encodeURIComponent(ovenId)}/delete`,
      { method: "POST", body: {} },
    ),
  acknowledgeAlarm: async (alarmId) =>
    requireArray<Alarm>(
      await requestJson(
        `/alarms/${encodeURIComponent(alarmId)}/acknowledge`,
        { method: "POST", body: {} },
      ),
      "/alarms/:alarmId/acknowledge",
    ),
  exportRawCsv: (ovenId, sensors) =>
    requestText(
      `/ovens/${encodeURIComponent(ovenId)}/export.csv`,
      undefined,
      new URLSearchParams({ sensors: sensors.join(",") }),
    ),
};
