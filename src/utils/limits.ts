import type { Alarm, AlarmSeverity, LimitMap, SensorKey, SensorSnapshot } from "../types";
import { sensorByKey } from "./sensors";

export type ReadingState = "normal" | "warning" | "danger";

export const temperatureLimitSensors: SensorKey[] = ["chamberTemp", "furnaceTemp"];

export function usesTemperatureLimit(sensor: SensorKey): boolean {
  return sensor === "chamberTemp" || sensor === "furnaceTemp" || sensor === "blowerTemp";
}

export function getLimitSourceSensor(sensor: SensorKey): SensorKey | null {
  if (sensor === "chamberTemp") return "chamberTemp";
  if (sensor === "furnaceTemp" || sensor === "blowerTemp") return "furnaceTemp";
  return null;
}

export function getReadingState(value: number, sensor: SensorKey, limits: LimitMap): ReadingState {
  const sourceSensor = getLimitSourceSensor(sensor);
  if (!sourceSensor) return "normal";
  const limit = limits[sourceSensor];
  const upperDanger = limit.upper + Math.max((limit.upper - limit.lower) * 0.12, 5);
  const lowerDanger = limit.lower - Math.max((limit.upper - limit.lower) * 0.12, 5);

  if (value >= upperDanger || value <= lowerDanger) {
    return "danger";
  }

  if (value > limit.upper || value < limit.lower) {
    return "warning";
  }

  return "normal";
}

export function getWorstSeverity(states: ReadingState[]): ReadingState {
  if (states.includes("danger")) return "danger";
  if (states.includes("warning")) return "warning";
  return "normal";
}

export function isStale(updatedAt: string, maxAgeMs = 10 * 60 * 1000): boolean {
  return Date.now() - new Date(updatedAt).getTime() > maxAgeMs;
}

export function buildLimitAlarms(
  ovenId: string,
  ovenName: string,
  readings: SensorSnapshot,
  limits: LimitMap,
): Alarm[] {
  return Object.values(readings).flatMap((reading) => {
    if (!usesTemperatureLimit(reading.key)) return [];

    const state = getReadingState(reading.value, reading.key, limits);
    if (state === "normal") return [];

    const sourceSensor = getLimitSourceSensor(reading.key);
    if (!sourceSensor) return [];
    const limit = limits[sourceSensor];
    const isUpper = reading.value > limit.upper;
    const threshold = isUpper ? limit.upper : limit.lower;
    const severity: AlarmSeverity = state;
    const definition = sensorByKey[reading.key];

    return [
      {
        id: `${ovenId}-${reading.key}-${reading.updatedAt}`,
        ovenId,
        ovenName,
        severity,
        status: "active",
        sensor: reading.key,
        title: `${definition.shortLabel} ${isUpper ? "สูงกว่า" : "ต่ำกว่า"}มาตรฐาน`,
        detail: `${definition.label} มีค่า ${reading.value.toFixed(1)} ${definition.unit === "C" ? "°C" : "%"} เทียบกับ limit ${threshold}`,
        value: reading.value,
        limit: threshold,
        createdAt: reading.updatedAt,
      },
    ];
  });
}
