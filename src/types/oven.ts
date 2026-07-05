import type { LimitMap, SensorSnapshot } from "./sensor";

export type OvenStatus = "open" | "closed" | "warning" | "danger" | "offline" | "disabled";

export type Oven = {
  id: string;
  number: number;
  name: string;
  zone: string;
  line: string;
  status: OvenStatus;
  enabled: boolean;
  cycleCount: number;
  startedAt?: string;
  stoppedAt?: string;
  lastUpdatedAt: string;
  readings: SensorSnapshot;
  limits: LimitMap;
};

export type OvenUpdateInput = Pick<Oven, "name" | "zone" | "line" | "enabled">;

export type OvenStatusFilter = OvenStatus | "all";
