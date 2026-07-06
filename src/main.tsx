import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/globals.css";
import "./styles/theme.css";

function getInitialThemeMode(): "dark" | "company" {
  const savedTheme = localStorage.getItem("stcr-theme-mode");
  return savedTheme === "company" ? "company" : "dark";
}

function getInitialCompany(): "gr" | "ttn" {
  const savedAccount = localStorage.getItem("stcr-account") || "gr_dev_admin";
  return savedAccount.toLowerCase().includes("ttn") ? "ttn" : "gr";
}

document.documentElement.dataset.uiTheme = getInitialThemeMode();
document.documentElement.dataset.company = getInitialCompany();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root was not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);