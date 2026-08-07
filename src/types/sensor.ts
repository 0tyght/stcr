export type SensorKey = "chamberTemp" | "humidity" | "furnaceTemp" | "blowerTemp";

export type SensorUnit = "C" | "%";

export type SensorDefinition = {
  key: SensorKey;
  label: string;
  shortLabel: string;
  unit: SensorUnit;
  color: string;
};

export type SensorReading = {
  key: SensorKey;
  value: number;
  unit: SensorUnit;
  updatedAt: string;
  quality?: "good" | "invalid" | "suspect" | "missing";
  invalidValue?: number;
  errorReason?: string;
};

export type SensorSnapshot = Record<SensorKey, SensorReading>;

export type LimitRule = {
  sensor: SensorKey;
  lower: number;
  upper: number;
};

export type LimitMap = Record<SensorKey, LimitRule>;

export type TimeSeriesPoint = {
  timestamp: string;
  chamberTemp: number | null;
  humidity: number | null;
  furnaceTemp: number | null;
  blowerTemp: number | null;
};

export type HistoryRangePreset = "today" | "24h" | "cycle" | "7d" | "30d" | "custom";

export type HistoryQuery = {
  ovenId: string;
  preset: HistoryRangePreset;
  startAt?: string;
  endAt?: string;
  cycleNumber?: number;
  includeIgnition?: boolean;
  sensors: SensorKey[];
};
