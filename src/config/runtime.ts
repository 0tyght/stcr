export type DataSource = "mock" | "node-red";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value?.trim() || "http://127.0.0.1:1880/stcr/api").replace(/\/+$/, "");
}

function readDataSource(value: string | undefined): DataSource {
  return value === "node-red" ? "node-red" : "mock";
}

export const runtimeConfig = Object.freeze({
  dataSource: readDataSource(import.meta.env.VITE_DATA_SOURCE),
  apiBaseUrl: normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
  pollIntervalMs: readPositiveInteger(
    import.meta.env.VITE_REALTIME_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
  ),
  requestTimeoutMs: readPositiveInteger(
    import.meta.env.VITE_API_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
  ),
});
