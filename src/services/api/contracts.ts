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

export type OvenCreateInput = {
  number: number;
  name: string;
  zone: string;
  line: string;
};

export type OvenDeleteBlocker = {
  key: string;
  label: string;
  count: number;
};

export type OvenDeleteCheck = {
  ovenId: string;
  canDelete: boolean;
  blockers: OvenDeleteBlocker[];
};

export interface AppApi {
  getOvens(): Promise<Oven[]>;
  getRealtimeOvens(): Promise<Oven[]>;
  getOven(ovenId: string): Promise<Oven>;
  getHistory(query: HistoryQuery): Promise<TimeSeriesPoint[]>;
  getAlarms(filter?: AlarmFilter): Promise<Alarm[]>;
  getAuditEvents(): Promise<AuditEvent[]>;
  getReportDocumentMeta(): Promise<ReportDocumentMeta>;
  saveReportDocumentMeta(meta: ReportDocumentMeta): Promise<ReportDocumentMeta>;
  getReportCycleMeta(ovenId: string, cycleNumber: number): Promise<ReportCycleMeta>;
  saveReportCycleMeta(
    ovenId: string,
    cycleNumber: number,
    meta: ReportCycleMeta,
  ): Promise<ReportCycleMeta>;
  saveLimits(ovenId: string, limits: LimitMap): Promise<Oven>;
  saveGlobalLimits(limits: LimitMap): Promise<Oven[]>;
  updateOven(ovenId: string, input: OvenUpdateInput): Promise<Oven>;
  addOven(input: OvenCreateInput): Promise<Oven>;
  getOvenDeleteCheck(ovenId: string): Promise<OvenDeleteCheck>;
  deleteOven(ovenId: string): Promise<{ deleted: true; ovenId: string }>;
  acknowledgeAlarm(alarmId: string): Promise<Alarm[]>;
  exportRawCsv(ovenId: string, sensors: SensorKey[]): Promise<string>;
}
