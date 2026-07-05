const DAY_MS = 24 * 60 * 60 * 1000;

export const REPORT_CYCLE_DAYS = 6;

export function getDefaultCycleRange(now = new Date()): { start: Date; end: Date } {
  const end = new Date(now);
  const start = new Date(end.getTime() - REPORT_CYCLE_DAYS * DAY_MS);
  return { start, end };
}
