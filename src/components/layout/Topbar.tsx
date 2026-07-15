import { Clock3, LogOut, Palette, Search, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  applyCompanyTheme,
} from "../../config/companies";
import {
  ACCOUNT_STORAGE_KEY,
  getStoredAccountId,
  getStoredCompanyId,
  getStoredThemeMode,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "../../config/preferences";

type Crumb = {
  label: string;
  to?: string;
};

type TopbarProps = {
  onLogout: () => void;
};

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
    () => getStoredAccountId(),
  );

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return getStoredThemeMode();
  });

  const companyId = getStoredCompanyId();
  const breadcrumbs = useMemo(() => buildBreadcrumbs(location.pathname), [location.pathname]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const savedAccount = getStoredAccountId();
    setAccount(savedAccount);
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.dataset.uiTheme = themeMode;
    applyCompanyTheme(companyId);

    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [companyId, themeMode]);

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
