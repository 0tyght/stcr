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

export type ReportCycleMeta = {
  firedAt?: string;
  reportStartedAt?: string | null;
  stoppedAt?: string | null;
  rubberType: string | null;
  smokingPeriodStatus: "under" | "over" | "notReached" | null;
  temperatureControlStatus: "underControl" | "outOfControl" | null;
  reason: string | null;
  inputNetWeightKg: number | null;
  outputNetWeightKg: number | null;
  firewoodWeightKg: number | null;
};
