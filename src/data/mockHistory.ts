import type { HistoryQuery, Oven, SensorKey, TimeSeriesPoint } from "../types";
import { REPORT_CYCLE_MS } from "../utils/reportCycle";

function seededNoise(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function getRange(query: HistoryQuery): { start: Date; end: Date; stepMs: number } {
  const now = new Date();
  const end = query.endAt ? new Date(query.endAt) : now;
  const start = (() => {
    if (query.preset === "custom" && query.startAt) return new Date(query.startAt);
    if (query.preset === "today") {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      return today;
    }
    if (query.preset === "cycle") return new Date(end.getTime() - REPORT_CYCLE_MS);
    if (query.preset === "7d") return new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (query.preset === "30d") return new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return new Date(end.getTime() - 24 * 60 * 60 * 1000);
  })();

  const duration = end.getTime() - start.getTime();
  const stepMs =
    duration > 14 * 24 * 60 * 60 * 1000
      ? 60 * 60 * 1000
      : duration > 3 * 24 * 60 * 60 * 1000
        ? 15 * 60 * 1000
        : 5 * 60 * 1000;

  return { start, end, stepMs };
}

function valueFor(sensor: SensorKey, oven: Oven, index: number, seed: number): number {
  const base = oven.readings[sensor].value || 0;
  const noise = seededNoise(seed + index * 13 + oven.number) - 0.5;
  const wave = Math.sin(index / 9 + oven.number) + Math.cos(index / 21);

  switch (sensor) {
    case "chamberTemp":
      return clamp(base + wave * 2.2 + noise * 1.3, 24, 78);
    case "humidity":
      return clamp(base + wave * 4 + noise * 2.5, 30, 86);
    case "furnaceTemp":
      return clamp(base + Math.abs(wave) * 70 + noise * 24, 20, 560);
    case "blowerTemp":
      return clamp(base + wave * 7 + noise * 5, 0, 120);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Number(Math.min(max, Math.max(min, value)).toFixed(1));
}

export function createHistory(query: HistoryQuery, oven: Oven): TimeSeriesPoint[] {
  const { start, end, stepMs } = getRange(query);
  const points: TimeSeriesPoint[] = [];
  let index = 0;

  for (let time = start.getTime(); time <= end.getTime(); time += stepMs) {
    points.push({
      timestamp: new Date(time).toISOString(),
      chamberTemp: valueFor("chamberTemp", oven, index, 11),
      humidity: valueFor("humidity", oven, index, 23),
      furnaceTemp: valueFor("furnaceTemp", oven, index, 37),
      blowerTemp: valueFor("blowerTemp", oven, index, 41),
    });
    index += 1;
  }

  return points;
}
