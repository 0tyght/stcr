import type {
  Alarm,
  AlarmFilter,
  AuditEvent,
  HistoryQuery,
  LimitMap,
  Oven,
  OvenUpdateInput,
  SensorKey,
  TimeSeriesPoint,
} from "../../types";
import type { AppApi } from "./contracts";
import { ApiError } from "./errors";
import { requestJson, requestText } from "./httpClient";

function requireArray<T>(value: unknown, endpoint: string): T[] {
  if (Array.isArray(value)) return value as T[];
  throw new ApiError(`รูปแบบข้อมูลจาก ${endpoint} ต้องเป็น array`, {
    code: "INVALID_RESPONSE",
  });
}

async function requestArray<T>(path: string, query?: URLSearchParams): Promise<T[]> {
  return requireArray<T>(await requestJson<unknown>(path, undefined, query), path);
}

function historyQueryParams(query: HistoryQuery): URLSearchParams {
  const params = new URLSearchParams({
    preset: query.preset,
    sensors: query.sensors.join(","),
  });

  if (query.startAt) params.set("startAt", query.startAt);
  if (query.endAt) params.set("endAt", query.endAt);
  if (query.cycleNumber != null) params.set("cycleNumber", String(query.cycleNumber));

  return params;
}

function alarmQueryParams(filter?: AlarmFilter): URLSearchParams | undefined {
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
  getOven: (ovenId) => requestJson<Oven>(`/ovens/${encodeURIComponent(ovenId)}`),
  getHistory: (query: HistoryQuery) =>
    requestArray<TimeSeriesPoint>(
      `/ovens/${encodeURIComponent(query.ovenId)}/history`,
      historyQueryParams(query),
    ),
  getAlarms: (filter?: AlarmFilter) =>
    requestArray<Alarm>("/alarms", alarmQueryParams(filter)),
  getAuditEvents: () => requestArray<AuditEvent>("/audit-events"),
  saveLimits: (ovenId: string, limits: LimitMap) =>
    requestJson<Oven>(`/ovens/${encodeURIComponent(ovenId)}/limits`, {
      method: "PUT",
      body: limits,
    }),
  updateOven: (ovenId: string, input: OvenUpdateInput) =>
    requestJson<Oven>(`/ovens/${encodeURIComponent(ovenId)}`, {
      method: "PATCH",
      body: input,
    }),
  addOven: () => requestJson<Oven>("/ovens", { method: "POST", body: {} }),
  acknowledgeAlarm: async (alarmId: string) =>
    requireArray<Alarm>(
      await requestJson<unknown>(`/alarms/${encodeURIComponent(alarmId)}/acknowledge`, {
        method: "POST",
        body: {},
      }),
      "/alarms/:alarmId/acknowledge",
    ),
  exportRawCsv: (ovenId: string, sensors: SensorKey[]) =>
    requestText(
      `/ovens/${encodeURIComponent(ovenId)}/export.csv`,
      undefined,
      new URLSearchParams({ sensors: sensors.join(",") }),
    ),
};
