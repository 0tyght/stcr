import { accountList, DEFAULT_ACCOUNT_ID } from "./companies";

export type ThemeMode = "dark" | "company";

export const ACCOUNT_STORAGE_KEY = "stcr-account";
export const AUTH_STORAGE_KEY = "stcr-authenticated";
export const THEME_STORAGE_KEY = "stcr-theme-mode";

export function getStoredAccountId(): string {
  const saved = localStorage.getItem(ACCOUNT_STORAGE_KEY);
  return accountList.some((account) => account.id === saved) ? saved ?? DEFAULT_ACCOUNT_ID : DEFAULT_ACCOUNT_ID;
}

export function getStoredThemeMode(defaultMode: ThemeMode = "dark"): ThemeMode {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "company" || saved === "dark" ? saved : defaultMode;
}
