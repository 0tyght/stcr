import { Clock3, HelpCircle, LogOut, Monitor, RefreshCw, Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDateTime } from "../../utils/format";

export function Topbar({ onLogout }: { onLogout: () => void }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
          <input placeholder="Search or jump to..." aria-label="Search or jump to" />
          <kbd>cmd+k</kbd>
        </label>
      </div>
      <div className="topbar-actions">
        <button className="toolbar-button" type="button" aria-label="Refresh dashboard">
          <RefreshCw size={16} />
          <span>1m</span>
        </button>
        <span className="toolbar-button">
          <Clock3 size={16} />
          Last 1 hour
        </span>
        <span className="live-clock">{formatDateTime(now)}</span>
        <button className="icon-button" type="button" aria-label="Display mode">
          <Monitor size={17} />
        </button>
        <button className="icon-button" type="button" aria-label="Help">
          <HelpCircle size={17} />
        </button>
        <span className="user-chip">
          <UserRound size={18} />
          gr_dev_admin
        </span>
        <button className="icon-button" type="button" onClick={onLogout} aria-label="ออกจากระบบ">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
