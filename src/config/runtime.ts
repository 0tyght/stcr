const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value?.trim() || "http://127.0.0.1:1880/stcr/api").replace(/\/+$/, "");
}

export type RuntimeConfig = {
  apiBaseUrl: string;
  pollIntervalMs: number;
  requestTimeoutMs: number;
};

type RuntimeConfigFile = {
  apiBaseUrl?: unknown;
  pollIntervalMs?: unknown;
  requestTimeoutMs?: unknown;
};

export const runtimeConfig: RuntimeConfig = {
  apiBaseUrl: normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
  pollIntervalMs: readPositiveInteger(
    import.meta.env.VITE_REALTIME_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
  ),
  requestTimeoutMs: readPositiveInteger(
    import.meta.env.VITE_API_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
  ),
};

function isAllowedApiUrl(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export async function loadRuntimeConfig(): Promise<void> {
  if (import.meta.env.DEV) return;
  try {
    const response = await fetch(
      `${import.meta.env.BASE_URL}runtime-config.json?t=${Date.now()}`,
      { cache: "no-store" },
    );
    if (!response.ok) return;

    const file = await response.json() as RuntimeConfigFile;
    const apiBaseUrl = typeof file.apiBaseUrl === "string"
      ? normalizeBaseUrl(file.apiBaseUrl)
      : runtimeConfig.apiBaseUrl;
    if (!isAllowedApiUrl(apiBaseUrl)) return;

    runtimeConfig.apiBaseUrl = apiBaseUrl;
    runtimeConfig.pollIntervalMs = readPositiveInteger(
      typeof file.pollIntervalMs === "number"
        ? String(file.pollIntervalMs)
        : undefined,
      runtimeConfig.pollIntervalMs,
    );
    runtimeConfig.requestTimeoutMs = readPositiveInteger(
      typeof file.requestTimeoutMs === "number"
        ? String(file.requestTimeoutMs)
        : undefined,
      runtimeConfig.requestTimeoutMs,
    );
  } catch {
    // Keep the build-time configuration when runtime-config.json is unavailable.
  }
}
