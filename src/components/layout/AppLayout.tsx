import { Outlet } from "react-router-dom";
import { DataConnectionBanner } from "../ui/DataConnectionBanner";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppLayout({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="workspace">
        <Topbar onLogout={onLogout} />
        <main className="view-root">
          <DataConnectionBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
