import { runtimeConfig } from "../../config/runtime";
import { ApiError } from "./errors";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  timeoutMs?: number;
};

function createUrl(path: string, query?: URLSearchParams): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${runtimeConfig.apiBaseUrl}${normalizedPath}`;
  return query?.size ? `${url}?${query.toString()}` : url;
}

async function request(path: string, options: RequestOptions = {}, query?: URLSearchParams) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? runtimeConfig.requestTimeoutMs,
  );

  try {
    const response = await fetch(createUrl(path, query), {
      ...options,
      body: options.body == null ? undefined : JSON.stringify(options.body),
      headers: {
        Accept: "application/json",
        ...(options.body == null ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ApiError(`Node-RED ตอบกลับด้วยสถานะ ${response.status}`, {
        status: response.status,
        code: "HTTP_ERROR",
      });
    }

    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("หมดเวลารอการตอบกลับจาก Node-RED", {
        code: "REQUEST_TIMEOUT",
        cause: error,
      });
    }
    throw new ApiError("เชื่อมต่อ Node-RED ไม่สำเร็จ", {
      code: "NETWORK_ERROR",
      cause: error,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function requestJson<T>(
  path: string,
  options?: RequestOptions,
  query?: URLSearchParams,
): Promise<T> {
  const response = await request(path, options, query);
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ApiError("Node-RED ส่ง JSON ไม่ถูกต้อง", {
      code: "INVALID_JSON",
      cause: error,
    });
  }
}

export async function requestText(
  path: string,
  options?: RequestOptions,
  query?: URLSearchParams,
): Promise<string> {
  const response = await request(path, options, query);
  return response.text();
}
