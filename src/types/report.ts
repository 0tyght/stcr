import type { SensorKey } from "./sensor";

export type ReportSummary = {
  sensor: SensorKey;
  min: number;
  max: number;
  average: number;
  exceedCount: number;
};

export type ReportRequest = {
  ovenId: string;
  startAt: string;
  endAt: string;
  sensors: SensorKey[];
};

export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
  detail: string;
};

export type ReportDocumentMeta = {
  documentNo: string;
  effectiveDate: string;
};
