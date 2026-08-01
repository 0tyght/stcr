import { companies, DEFAULT_COMPANY_ID, type CompanyId } from "./companies";

export type ThemeMode = "dark" | "company";

export const ACCOUNT_STORAGE_KEY = "stcr-account";
export const COMPANY_STORAGE_KEY = "stcr-company-id";
export const THEME_STORAGE_KEY = "stcr-theme-mode";

function companyAccountStorageKey(companyId: CompanyId): string {
  return `${ACCOUNT_STORAGE_KEY}:${companyId}`;
}

export function getStoredAccountId(companyId: CompanyId = getStoredCompanyId()): string {
  const company = companies[companyId];
  const belongsToCompany = (accountId: string) =>
    company.accounts.some((account) => account.id === accountId);
  const companyAccount = localStorage.getItem(companyAccountStorageKey(companyId))?.trim() || "";
  if (belongsToCompany(companyAccount)) return companyAccount;

  const legacyAccount = localStorage.getItem(ACCOUNT_STORAGE_KEY)?.trim() || "";
  if (belongsToCompany(legacyAccount)) return legacyAccount;

  return company.accounts[0]?.id ?? "";
}

export function saveStoredAccountId(companyId: CompanyId, accountId: string): void {
  const normalized = accountId.trim();
  localStorage.setItem(companyAccountStorageKey(companyId), normalized);
  localStorage.setItem(ACCOUNT_STORAGE_KEY, normalized);
}

export function getStoredCompanyId(): CompanyId {
  const saved = localStorage.getItem(COMPANY_STORAGE_KEY);
  return saved && saved in companies ? saved as CompanyId : DEFAULT_COMPANY_ID;
}

export function getStoredThemeMode(defaultMode: ThemeMode = "dark"): ThemeMode {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "company" || saved === "dark" ? saved : defaultMode;
}
