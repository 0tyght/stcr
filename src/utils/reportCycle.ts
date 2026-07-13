import type { Oven } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;
const CYCLE_GAP_MS = 12 * 60 * 60 * 1000;

export const REPORT_CYCLE_DAYS = 6;
export const REPORT_CYCLE_MS = REPORT_CYCLE_DAYS * DAY_MS;

export function getDefaultCycleRange(now = new Date()): { start: Date; end: Date } {
  const end = new Date(now);
  const start = new Date(end.getTime() - REPORT_CYCLE_MS);
  return { start, end };
}

export function clampCycleStart(start: Date, end: Date): Date {
  const minStart = new Date(end.getTime() - REPORT_CYCLE_MS);
  return start.getTime() < minStart.getTime() ? minStart : start;
}

export function getHistoricalCycleRange(
  oven: Oven,
  cycleNumber: number,
): { start: Date; end: Date } {
  const latestCompletedCycle = Math.max(
    1,
    oven.status === "open" ? oven.cycleCount - 1 : oven.cycleCount,
  );
  const cycleOffset = Math.max(0, latestCompletedCycle - cycleNumber);
  const baseEndValue =
    oven.status === "open" && oven.reportStartedAt
      ? oven.reportStartedAt
      : oven.stoppedAt ?? oven.lastUpdatedAt ?? new Date().toISOString();
  const baseEnd = new Date(baseEndValue);
  const end = new Date(baseEnd.getTime() - cycleOffset * (REPORT_CYCLE_MS + CYCLE_GAP_MS));
  const start = new Date(end.getTime() - REPORT_CYCLE_MS);

  return { start, end };
}
