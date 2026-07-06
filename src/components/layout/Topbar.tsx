import {
  Clock3,
  HelpCircle,
  LogOut,
  Monitor,
  Palette,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../../utils/format";

type ThemeMode = "company" | "dark";
type CompanyKey = "gr" | "ttn";

const THEME_STORAGE_KEY = "stcr-theme-mode";
const ACCOUNT_STORAGE_KEY = "stcr-account";

function getStoredAccount(): string {
  return localStorage.getItem(ACCOUNT_STORAGE_KEY) || "gr_dev_admin";
}

function getInitialThemeMode(): ThemeMode {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);

  if (savedTheme === "dark") return "dark";
  return "company";
}

function getCompanyFromAccount(account: string): CompanyKey {
  const normalized = account.toLowerCase();

  if (normalized.includes("ttn")) return "ttn";
  return "gr";
}

export function Topbar({ onLogout }: { onLogout: () => void }) {
  const [now, setNow] = useState(() => new Date());
  const [account] = useState(() => getStoredAccount());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    getInitialThemeMode(),
  );

  const company = useMemo(() => getCompanyFromAccount(account), [account]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.company = company;
    document.documentElement.dataset.uiTheme = themeMode;

    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    localStorage.setItem(ACCOUNT_STORAGE_KEY, account);
  }, [account, company, themeMode]);

  function toggleTheme() {
    setThemeMode((current) => (current === "company" ? "dark" : "company"));
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="breadcrumbs" aria-label="breadcrumb">
          <span>Home</span>
          <span>/</span>
          <span>Dashboards</span>
          <span>/</span>
          <strong>Smoking Temperature Control</strong>
        </div>

        <label className="global-search">
          <Search size={17} />
          <input
            placeholder="Search or jump to..."
            aria-label="Search or jump to"
          />
          <kbd>cmd+k</kbd>
        </label>
      </div>

      <div className="topbar-actions">
        <button
          className="toolbar-button"
          type="button"
          aria-label="Refresh dashboard"
        >
          <RefreshCw size={16} />
          <span>1m</span>
        </button>

        <span className="toolbar-button">
          <Clock3 size={16} />
          Last 1 hour
        </span>

        <button
          className={`theme-switch is-${themeMode}`}
          type="button"
          onClick={toggleTheme}
          aria-label="สลับธีมสี"
          aria-pressed={themeMode === "dark"}
        >
          <Palette size={15} />
          <span className="theme-switch-track">
            <span className="theme-switch-dot" />
          </span>
          <span>{themeMode === "company" ? "ธีมบริษัท" : "ธีมมืด"}</span>
        </button>

        <span className="live-clock">{formatDateTime(now)}</span>

        <button className="icon-button" type="button" aria-label="Display mode">
          <Monitor size={17} />
        </button>

        <button className="icon-button" type="button" aria-label="Help">
          <HelpCircle size={17} />
        </button>

        <span className="user-chip">
          <UserRound size={18} />
          {account}
        </span>

        <button
          className="icon-button"
          type="button"
          onClick={onLogout}
          aria-label="ออกจากระบบ"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}