import { Clock3, LogOut, Palette, Search, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const ACCOUNT_STORAGE_KEY = "stcr-account";
const THEME_STORAGE_KEY = "stcr-theme-mode";

type ThemeMode = "dark" | "company";
type CompanyCode = "gr" | "ttn";

type Crumb = {
  label: string;
  to?: string;
};

type TopbarProps = {
  onLogout: () => void;
};

function getCompanyFromAccount(account: string): CompanyCode {
  return account.toLowerCase().startsWith("ttn") ? "ttn" : "gr";
}

function getOvenNumberFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/ovens\/oven-(\d+)/);
  return match ? match[1] : null;
}

function buildBreadcrumbs(pathname: string): Crumb[] {
  if (pathname === "/") {
    return [{ label: "Home" }, { label: "Dashboard" }];
  }

  if (pathname.startsWith("/ovens/")) {
    const ovenNumber = getOvenNumberFromPath(pathname);

    return [
      { label: "Home", to: "/" },
      { label: "Dashboard", to: "/" },
      { label: ovenNumber ? `เตา ${ovenNumber}` : "รายละเอียดเตา" },
    ];
  }

  if (pathname.startsWith("/alarms")) {
    return [{ label: "Home", to: "/" }, { label: "Alarms" }];
  }

  if (pathname.startsWith("/reports")) {
    return [{ label: "Home", to: "/" }, { label: "Reports" }];
  }

  if (pathname.startsWith("/settings")) {
    return [{ label: "Home", to: "/" }, { label: "Settings" }];
  }

  return [{ label: "Home", to: "/" }, { label: "Dashboard" }];
}

export function Topbar({ onLogout }: TopbarProps) {
  const location = useLocation();

  const [now, setNow] = useState(() => new Date());
  const [account, setAccount] = useState(
    () => localStorage.getItem(ACCOUNT_STORAGE_KEY) || "gr_dev_admin",
  );

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "company" ? "company" : "dark";
  });

  const company = useMemo<CompanyCode>(() => getCompanyFromAccount(account), [account]);
  const breadcrumbs = useMemo(() => buildBreadcrumbs(location.pathname), [location.pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const savedAccount = localStorage.getItem(ACCOUNT_STORAGE_KEY) || "gr_dev_admin";
    setAccount(savedAccount);
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.dataset.uiTheme = themeMode;
    document.documentElement.dataset.company = company;

    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [company, themeMode]);

  function toggleTheme() {
    setThemeMode((current) => (current === "dark" ? "company" : "dark"));
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;

            return (
              <span key={`${crumb.label}-${index}`} className="breadcrumb-item">
                {crumb.to && !isLast ? (
                  <Link to={crumb.to}>{crumb.label}</Link>
                ) : isLast ? (
                  <strong>{crumb.label}</strong>
                ) : (
                  <span>{crumb.label}</span>
                )}

                {!isLast ? <span className="breadcrumb-sep">/</span> : null}
              </span>
            );
          })}
        </nav>

        <label className="global-search" aria-label="Global search">
          <Search size={15} />
          <input type="text" placeholder="Search or jump to..." />
          <kbd>cmd+k</kbd>
        </label>
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className={`theme-switch is-${themeMode}`}
          onClick={toggleTheme}
          aria-label="สลับธีม"
          title="สลับธีม"
        >
          <Palette size={15} />
          <span>{themeMode === "dark" ? "ธีมมืด" : "ธีมบริษัท"}</span>

          <span className="theme-switch-track">
            <span className="theme-switch-dot" />
          </span>
        </button>

        <span className="live-clock">
          <Clock3 size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
          {new Intl.DateTimeFormat("th-TH", {
            dateStyle: "medium",
            timeStyle: "medium",
            timeZone: "Asia/Bangkok",
          }).format(now)}
        </span>

        <span className="user-chip">
          <User size={14} />
          {account}
        </span>

        <button
          type="button"
          className="icon-button"
          onClick={onLogout}
          aria-label="ออกจากระบบ"
          title="ออกจากระบบ"
        >
          <LogOut size={15} />
        </button>
      </div>
    </header>
  );
}