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
  chamberTemp: number;
  humidity: number;
  furnaceTemp: number;
  blowerTemp: number;
};

export type HistoryRangePreset = "today" | "24h" | "cycle" | "7d" | "30d" | "custom";

export type HistoryQuery = {
  ovenId: string;
  preset: HistoryRangePreset;
  startAt?: string;
  endAt?: string;
  sensors: SensorKey[];
};
