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

export interface AppApi {
  getOvens(): Promise<Oven[]>;
  getRealtimeOvens(): Promise<Oven[]>;
  getOven(ovenId: string): Promise<Oven>;
  getHistory(query: HistoryQuery): Promise<TimeSeriesPoint[]>;
  getAlarms(filter?: AlarmFilter): Promise<Alarm[]>;
  getAuditEvents(): Promise<AuditEvent[]>;
  saveLimits(ovenId: string, limits: LimitMap): Promise<Oven>;
  updateOven(ovenId: string, input: OvenUpdateInput): Promise<Oven>;
  addOven(): Promise<Oven>;
  acknowledgeAlarm(alarmId: string): Promise<Alarm[]>;
  exportRawCsv(ovenId: string, sensors: SensorKey[]): Promise<string>;
}
