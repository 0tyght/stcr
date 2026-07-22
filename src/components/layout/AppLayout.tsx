import { Outlet, useLocation } from "react-router-dom";
import { DataConnectionBanner } from "../ui/DataConnectionBanner";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppLayout({ onLogout }: { onLogout: () => void }) {
  const { pathname } = useLocation();
  const pageClass = pathname.startsWith("/ovens/")
    ? "page-oven-detail"
    : pathname.startsWith("/alarms")
      ? "page-alarm"
      : pathname.startsWith("/reports")
        ? "page-report"
        : pathname.startsWith("/settings")
          ? "page-settings"
          : "page-dashboard";

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="workspace">
        <Topbar onLogout={onLogout} />
        <main className={`view-root ${pageClass}`}>
          <DataConnectionBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
