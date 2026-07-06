import { lazy, Suspense, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "../components/layout/AppLayout";
import { LoadingState } from "../components/ui/LoadingState";
import { LoginPage } from "../pages/LoginPage";
import { AppDataProvider } from "./providers";

const DashboardPage = lazy(() =>
  import("../pages/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);

const OvenDetailPage = lazy(() =>
  import("../pages/OvenDetailPage").then((module) => ({
    default: module.OvenDetailPage,
  })),
);

const AlarmPage = lazy(() =>
  import("../pages/AlarmPage").then((module) => ({
    default: module.AlarmPage,
  })),
);

const ReportPage = lazy(() =>
  import("../pages/ReportPage").then((module) => ({
    default: module.ReportPage,
  })),
);

const SettingPage = lazy(() =>
  import("../pages/SettingPage").then((module) => ({
    default: module.SettingPage,
  })),
);

export function App() {
  const [authenticated, setAuthenticated] = useState(
    () => localStorage.getItem("stcr-authenticated") === "true",
  );

  function handleLogin(username: string) {
    localStorage.setItem("stcr-authenticated", "true");
    localStorage.setItem("stcr-account", username);
    setAuthenticated(true);
  }

  function handleLogout() {
    localStorage.removeItem("stcr-authenticated");
    localStorage.removeItem("stcr-account");
    localStorage.removeItem("stcr-theme-mode");
    setAuthenticated(false);
  }

  if (!authenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <HashRouter>
      <AppDataProvider>
        <Suspense fallback={<LoadingState />}>
          <Routes>
            <Route element={<AppLayout onLogout={handleLogout} />}>
              <Route index element={<DashboardPage />} />
              <Route path="/ovens/:ovenId" element={<OvenDetailPage />} />
              <Route path="/alarms" element={<AlarmPage />} />
              <Route path="/reports" element={<ReportPage />} />
              <Route path="/settings" element={<SettingPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </AppDataProvider>
    </HashRouter>
  );
}