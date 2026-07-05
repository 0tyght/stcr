import type { SensorKey, TimeSeriesPoint } from "../types";

export function downloadCsv(filename: string, points: TimeSeriesPoint[], sensors: SensorKey[]): void {
  const header = ["timestamp", ...sensors];
  const rows = points.map((point) => [point.timestamp, ...sensors.map((sensor) => point[sensor])]);
  const csv = [header, ...rows].map((row) => row.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function printReport(): void {
  window.print();
}
