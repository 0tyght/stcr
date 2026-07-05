import { lazy, Suspense, useState } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "../components/layout/AppLayout";
import { LoadingState } from "../components/ui/LoadingState";
import { LoginPage } from "../pages/LoginPage";
import { AppDataProvider } from "./providers";

const DashboardPage = lazy(() => import("../pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const OvenDetailPage = lazy(() => import("../pages/OvenDetailPage").then((module) => ({ default: module.OvenDetailPage })));
const AlarmPage = lazy(() => import("../pages/AlarmPage").then((module) => ({ default: module.AlarmPage })));
const ReportPage = lazy(() => import("../pages/ReportPage").then((module) => ({ default: module.ReportPage })));
const SettingPage = lazy(() => import("../pages/SettingPage").then((module) => ({ default: module.SettingPage })));

export function App() {
  const [authenticated, setAuthenticated] = useState(() => localStorage.getItem("stcr-authenticated") === "true");

  function handleLogin() {
    localStorage.setItem("stcr-authenticated", "true");
    setAuthenticated(true);
  }

  function handleLogout() {
    localStorage.removeItem("stcr-authenticated");
    setAuthenticated(false);
  }

  if (!authenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <AppDataProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppLayout onLogout={handleLogout} />}>
            <Route
              index
              element={
                <Suspense fallback={<LoadingState label="กำลังเปิด Dashboard" />}>
                  <DashboardPage />
                </Suspense>
              }
            />
            <Route
              path="ovens/:ovenId"
              element={
                <Suspense fallback={<LoadingState label="กำลังเปิดรายละเอียดเตา" />}>
                  <OvenDetailPage />
                </Suspense>
              }
            />
            <Route
              path="alarms"
              element={
                <Suspense fallback={<LoadingState label="กำลังเปิด Alarm" />}>
                  <AlarmPage />
                </Suspense>
              }
            />
            <Route
              path="reports"
              element={
                <Suspense fallback={<LoadingState label="กำลังเปิด Report" />}>
                  <ReportPage />
                </Suspense>
              }
            />
            <Route
              path="settings"
              element={
                <Suspense fallback={<LoadingState label="กำลังเปิด Setting" />}>
                  <SettingPage />
                </Suspense>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppDataProvider>
  );
}
