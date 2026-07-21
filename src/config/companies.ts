import grLogo from "../assets/gr-logo.png";
import ttnLogo from "../assets/ttn-logo.png";

export type CompanyTheme = {
  primary: string;
  primarySoft: string;
  primaryStrong: string;
  accent: string;
  accentHover: string;
  onAccent: string;
  sidebar: string;
  sidebarHead: string;
  sidebarText: string;
  sidebarMuted: string;
  background: string;
  surface: string;
  surfaceSoft: string;
  surfaceStrong: string;
  ink: string;
  inkStrong: string;
  muted: string;
  mutedSoft: string;
  line: string;
  lineStrong: string;
  cardHeader: string;
  cardBorder: string;
  detailButton: string;
  detailButtonHover: string;
};

export type CompanyConfig = {
  id: string;
  name: string;
  shortName: string;
  accounts: ReadonlyArray<{ id: string; label: string }>;
  data: {
    sourceId: string;
    apiBaseUrl?: string;
  };
  brand: {
    kind: "text" | "image";
    text: string;
    logo?: string;
    logoAlt: string;
    sidebarLogoSize: number;
    loginLogoSize: number;
  };
  report: {
    logo: string;
    logoBox: { x: number; y: number; width: number; height: number };
  };
  theme: CompanyTheme;
};

export const companies = {
  gr: {
    id: "gr",
    name: "Grand Rubber",
    shortName: "GR",
    accounts: [{ id: "gr_dev_admin", label: "gr_dev_admin" }],
    data: {
      sourceId: "gr-node-red",
      apiBaseUrl: import.meta.env.VITE_GR_API_BASE_URL?.trim(),
    },
    brand: {
      kind: "text",
      text: "GR",
      logoAlt: "Grand Rubber Logo",
      sidebarLogoSize: 50,
      loginLogoSize: 54,
    },
    report: {
      logo: grLogo,
      logoBox: { x: 42, y: 6, width: 90, height: 62 },
    },
    theme: {
      primary: "#eed236",
      primarySoft: "#eed236",
      primaryStrong: "#d9c81f",
      accent: "#5b6068",
      accentHover: "#4b5058",
      onAccent: "#ffffff",
      sidebar: "#3c3e42",
      sidebarHead: "#3c3e42",
      sidebarText: "#ffffff",
      sidebarMuted: "rgba(255, 255, 255, 0.78)",
      background: "#dfdfd9",
      surface: "#ffffff",
      surfaceSoft: "#f8fafc",
      surfaceStrong: "#edf0f4",
      ink: "#394150",
      inkStrong: "#1f2937",
      muted: "#6b7280",
      mutedSoft: "#9ca3af",
      line: "#d8dde5",
      lineStrong: "#c7ced7",
      cardHeader: "#fff6bf",
      cardBorder: "#efe3a2",
      detailButton: "#363b40",
      detailButtonHover: "#2f3439",
    },
  },
  ttn: {
    id: "ttn",
    name: "TTN Rubber",
    shortName: "TTN",
    accounts: [{ id: "ttn_dev_admin", label: "ttn_dev_admin" }],
    data: {
      sourceId: "ttn-node-red",
      apiBaseUrl: import.meta.env.VITE_TTN_API_BASE_URL?.trim(),
    },
    brand: {
      kind: "image",
      text: "TTN",
      logo: ttnLogo,
      logoAlt: "TTN Logo",
      sidebarLogoSize: 52,
      loginLogoSize: 60,
    },
    report: {
      logo: ttnLogo,
      logoBox: { x: 34.5, y: -15, width: 105, height: 105 },
    },
    theme: {
      primary: "#ab84fe",
      primarySoft: "#efe7ff",
      primaryStrong: "#8e67eb",
      accent: "#f0c35c",
      accentHover: "#deac34",
      onAccent: "#ffffff",
      sidebar: "#ab84fe",
      sidebarHead: "#ab84fe",
      sidebarText: "#ffffff",
      sidebarMuted: "rgba(255, 255, 255, 0.84)",
      background: "#f3f8fb",
      surface: "#ffffff",
      surfaceSoft: "#fbf9ff",
      surfaceStrong: "#f3edff",
      ink: "#3f4550",
      inkStrong: "#30343b",
      muted: "#7b8190",
      mutedSoft: "#a5a8b2",
      line: "#e1d8fa",
      lineStrong: "#cdbef6",
      cardHeader: "#efe7ff",
      cardBorder: "#dccdff",
      detailButton: "#eec16c",
      detailButtonHover: "#dfb25d",
    },
  },
} as const satisfies Record<string, CompanyConfig>;

export type CompanyId = keyof typeof companies;

export const DEFAULT_COMPANY_ID: CompanyId = "ttn";
export const DEFAULT_ACCOUNT_ID = companies[DEFAULT_COMPANY_ID].accounts[0].id;
export const companyList = Object.values(companies);
export const accountList = companyList.flatMap((company) =>
  company.accounts.map((account) => ({ ...account, companyId: company.id as CompanyId })),
);

export function getCompany(companyId: string | null | undefined): CompanyConfig {
  return companies[companyId as CompanyId] ?? companies[DEFAULT_COMPANY_ID];
}

export function getCurrentCompany(): CompanyConfig {
  if (typeof window === "undefined") return companies[DEFAULT_COMPANY_ID];
  return getCompany(localStorage.getItem("stcr-company-id"));
}

export function applyCompanyTheme(companyId: CompanyId): void {
  const root = document.documentElement;
  const company = companies[companyId];
  const theme = company.theme;

  root.dataset.company = companyId;

  const variables: Record<string, string> = {
    "--company-primary": theme.primary,
    "--company-primary-soft": theme.primarySoft,
    "--company-primary-strong": theme.primaryStrong,
    "--company-accent": theme.accent,
    "--company-accent-hover": theme.accentHover,
    "--company-on-accent": theme.onAccent,
    "--company-sidebar": theme.sidebar,
    "--company-sidebar-head": theme.sidebarHead,
    "--company-sidebar-text": theme.sidebarText,
    "--company-sidebar-muted": theme.sidebarMuted,
    "--company-bg": theme.background,
    "--company-surface": theme.surface,
    "--company-surface-soft": theme.surfaceSoft,
    "--company-surface-strong": theme.surfaceStrong,
    "--company-ink": theme.ink,
    "--company-ink-strong": theme.inkStrong,
    "--company-muted": theme.muted,
    "--company-muted-soft": theme.mutedSoft,
    "--company-line": theme.line,
    "--company-line-strong": theme.lineStrong,
    "--company-card-header": theme.cardHeader,
    "--company-card-border": theme.cardBorder,
    "--company-detail-button": theme.detailButton,
    "--company-detail-button-hover": theme.detailButtonHover,
    "--company-sidebar-logo-size": `${company.brand.sidebarLogoSize}px`,
    "--company-login-logo-size": `${company.brand.loginLogoSize}px`,
  };

  Object.entries(variables).forEach(([name, value]) => root.style.setProperty(name, value));
}
