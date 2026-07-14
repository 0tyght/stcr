import { runtimeConfig } from "../config/runtime";
import { getCompany, getCompanyIdFromAccount } from "../config/companies";
import { ApiError } from "./api/errors";

const AUTH_SESSION_KEY = "stcr-auth-session";

export type AuthSession = {
  token: string;
  username: string;
  companyId: string;
  expiresAt: string;
};

function isSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AuthSession>;
  return Boolean(
    session.token &&
      session.username &&
      session.companyId &&
      session.expiresAt &&
      Date.parse(session.expiresAt) > Date.now(),
  );
}

export function readAuthSession(): AuthSession | null {
  try {
    const saved = window.sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    if (isSession(parsed)) return parsed;
  } catch {
    // Invalid or unavailable session storage is treated as logged out.
  }
  clearAuthSession();
  return null;
}

export function saveAuthSession(session: AuthSession): void {
  window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

export function clearAuthSession(): void {
  window.sessionStorage.removeItem(AUTH_SESSION_KEY);
}

export async function login(username: string, password: string): Promise<AuthSession> {
  if (!password) {
    throw new ApiError("กรุณากรอกรหัสผ่าน", { code: "PASSWORD_REQUIRED" });
  }

  if (runtimeConfig.dataSource === "mock") {
    const session: AuthSession = {
      token: "mock-session",
      username,
      companyId: getCompanyIdFromAccount(username),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    };
    saveAuthSession(session);
    return session;
  }

  const company = getCompany(getCompanyIdFromAccount(username));
  const apiBaseUrl = (company.data.apiBaseUrl || runtimeConfig.apiBaseUrl).replace(/\/+$/, "");
  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = (await response.json().catch(() => null)) as
    | (Partial<AuthSession> & { error?: string })
    | null;

  if (!response.ok || !isSession(payload)) {
    throw new ApiError(payload?.error || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", {
      status: response.status,
      code: "LOGIN_FAILED",
    });
  }

  saveAuthSession(payload);
  return payload;
}

export async function logout(): Promise<void> {
  const session = readAuthSession();
  clearAuthSession();
  if (runtimeConfig.dataSource !== "node-red" || !session) return;

  try {
    const company = getCompany(session.companyId);
    const apiBaseUrl = (company.data.apiBaseUrl || runtimeConfig.apiBaseUrl).replace(/\/+$/, "");
    await fetch(`${apiBaseUrl}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
    });
  } catch {
    // The local session is cleared even when Node-RED is unavailable.
  }
}
