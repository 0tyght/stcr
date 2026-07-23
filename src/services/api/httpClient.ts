import { runtimeConfig } from "../../config/runtime";
import { getCurrentCompany } from "../../config/companies";
import { ApiError } from "./errors";
import { clearAuthSession, readAuthSession } from "../auth";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  timeoutMs?: number;
};

function createUrl(path: string, query?: URLSearchParams): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const company = getCurrentCompany();
  const baseUrl = (company.data.apiBaseUrl || runtimeConfig.apiBaseUrl).replace(/\/+$/, "");
  const url = `${baseUrl}${normalizedPath}`;
  const params = new URLSearchParams(query);
  params.set("companyId", company.id);
  return `${url}?${params.toString()}`;
}

async function request(path: string, options: RequestOptions = {}, query?: URLSearchParams) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? runtimeConfig.requestTimeoutMs,
  );

  try {
    const session = readAuthSession();
    const response = await fetch(createUrl(path, query), {
      ...options,
      body: options.body == null ? undefined : JSON.stringify(options.body),
      headers: {
        Accept: "application/json",
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        ...(options.body == null ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401) {
        clearAuthSession();
        window.dispatchEvent(new Event("stcr-auth-expired"));
      }

      const payload = (await response
        .clone()
        .json()
        .catch(() => null)) as
        | { error?: string; code?: string }
        | null;

      throw new ApiError(
        payload?.error || `Node-RED ตอบกลับด้วยสถานะ ${response.status}`,
        {
          status: response.status,
          code: payload?.code || "HTTP_ERROR",
        },
      );
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
