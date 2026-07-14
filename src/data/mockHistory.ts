import type { HistoryQuery, Oven, TimeSeriesPoint } from "../types";
import { REPORT_CYCLE_MS } from "../utils/reportCycle";
import { getSimulatedFiredAt, simulateTenMinuteAverage } from "./simulationModel";

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
  const stepMs = duration > 14 * 24 * 60 * 60 * 1000
    ? 60 * 60 * 1000
    : 10 * 60 * 1000;

  return { start, end, stepMs };
}

export function createHistory(
  query: HistoryQuery,
  oven: Oven,
  companyId = "gr",
): TimeSeriesPoint[] {
  const { start, end, stepMs } = getRange(query);
  const points: TimeSeriesPoint[] = [];
  const now = Date.now();
  const requestedEnd = end.getTime();
  const lastUpdatedAt = Date.parse(oven.lastUpdatedAt);
  const latestAvailableTime = requestedEnd > now
    ? Math.min(now, Number.isFinite(lastUpdatedAt) ? lastUpdatedAt : now)
    : requestedEnd;
  const requestedCycle = query.cycleNumber;
  const isCurrentOpenCycle =
    oven.status === "open" && requestedCycle === oven.cycleCount;
  const isHistoricalCycle =
    requestedCycle != null && Number.isFinite(requestedCycle) && !isCurrentOpenCycle;
  const historicalWarmupHours = isHistoricalCycle
    ? 8 + ((oven.number + requestedCycle) % 5)
    : 0;
  const firedAt = isHistoricalCycle
    ? start.getTime() - historicalWarmupHours * 60 * 60 * 1000
    : getSimulatedFiredAt(
        oven.firedAt ?? oven.startedAt,
        Math.min(latestAvailableTime, end.getTime()),
      );
  const firstAvailableTime = isHistoricalCycle
    ? start.getTime()
    : oven.firedAt
      ? Math.max(start.getTime(), firedAt)
      : start.getTime();

  for (let time = firstAvailableTime; time <= latestAvailableTime; time += stepMs) {
    const values = simulateTenMinuteAverage(companyId, oven.number, time, firedAt);
    points.push({
      timestamp: new Date(time).toISOString(),
      ...values,
    });
  }

  return points;
}
