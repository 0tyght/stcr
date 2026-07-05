import type { LucideIcon } from "lucide-react";
import { Bell, FileDown, LayoutDashboard, Settings } from "lucide-react";

export type AppRouteKey = "dashboard" | "alarm" | "report" | "setting";

export type AppRouteDefinition = {
  key: AppRouteKey;
  label: string;
  path: string;
  icon: LucideIcon;
};

export const appRoutes: AppRouteDefinition[] = [
  { key: "dashboard", label: "Dashboard", path: "/", icon: LayoutDashboard },
  { key: "alarm", label: "Alarm", path: "/alarms", icon: Bell },
  { key: "report", label: "Report", path: "/reports", icon: FileDown },
  { key: "setting", label: "Setting", path: "/settings", icon: Settings },
];
