import { companies, DEFAULT_ACCOUNT_ID, DEFAULT_COMPANY_ID, type CompanyId } from "./companies";

export type ThemeMode = "dark" | "company";

export const ACCOUNT_STORAGE_KEY = "stcr-account";
export const COMPANY_STORAGE_KEY = "stcr-company-id";
export const THEME_STORAGE_KEY = "stcr-theme-mode";

export function getStoredAccountId(): string {
  return localStorage.getItem(ACCOUNT_STORAGE_KEY)?.trim() || DEFAULT_ACCOUNT_ID;
}

export function getStoredCompanyId(): CompanyId {
  const saved = localStorage.getItem(COMPANY_STORAGE_KEY);
  return saved && saved in companies ? saved as CompanyId : DEFAULT_COMPANY_ID;
}

export function getStoredThemeMode(defaultMode: ThemeMode = "dark"): ThemeMode {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "company" || saved === "dark" ? saved : defaultMode;
}
