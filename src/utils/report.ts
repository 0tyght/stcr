import type { LimitMap, ReportSummary, SensorKey, TimeSeriesPoint } from "../types";

export function summarizeHistory(
  points: TimeSeriesPoint[],
  sensors: SensorKey[],
  limits: LimitMap,
): ReportSummary[] {
  return sensors.map((sensor) => {
    const values = points.map((point) => point[sensor]);
    if (!values.length) {
      return {
        sensor,
        min: 0,
        max: 0,
        average: 0,
        exceedCount: 0,
      };
    }

    const total = values.reduce((sum, value) => sum + value, 0);
    const limit = limits[sensor];

    return {
      sensor,
      min: Math.min(...values),
      max: Math.max(...values),
      average: values.length ? total / values.length : 0,
      exceedCount: values.filter((value) => value > limit.upper || value < limit.lower).length,
    };
  });
}
