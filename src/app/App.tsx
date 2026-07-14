import { lazy, Suspense, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "../components/layout/AppLayout";
import { LoadingState } from "../components/ui/LoadingState";
import { LoginPage } from "../pages/LoginPage";
import { AppDataProvider } from "./providers";
import {
  ACCOUNT_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "../config/preferences";
import { login, logout, readAuthSession } from "../services/auth";

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
    () => readAuthSession() !== null,
  );

  useEffect(() => {
    const expireSession = () => setAuthenticated(false);
    window.addEventListener("stcr-auth-expired", expireSession);
    return () => window.removeEventListener("stcr-auth-expired", expireSession);
  }, []);

  async function handleLogin(username: string, password: string) {
    const session = await login(username, password);
    localStorage.setItem(ACCOUNT_STORAGE_KEY, session.username);
    window.location.hash = "/";
    setAuthenticated(true);
  }

  function handleLogout() {
    void logout();
    localStorage.removeItem(ACCOUNT_STORAGE_KEY);
    localStorage.removeItem(THEME_STORAGE_KEY);
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
