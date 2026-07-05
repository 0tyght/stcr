import type { SensorKey } from "./sensor";

export type AlarmSeverity = "warning" | "danger" | "offline";

export type AlarmStatus = "active" | "acknowledged" | "resolved";

export type Alarm = {
  id: string;
  ovenId: string;
  ovenName: string;
  severity: AlarmSeverity;
  status: AlarmStatus;
  sensor?: SensorKey;
  title: string;
  detail: string;
  value?: number;
  limit?: number;
  createdAt: string;
  resolvedAt?: string;
};

export type AlarmFilter = {
  severity: AlarmSeverity | "all";
  status: AlarmStatus | "all";
  ovenId: string | "all";
  search: string;
};
