import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import {
  applyCompanyTheme,
  getCompanyIdFromAccount,
} from "./config/companies";
import { getStoredAccountId, getStoredThemeMode } from "./config/preferences";
import { loadRuntimeConfig } from "./config/runtime";
import "./styles/globals.css";
import "./styles/theme.css";
import "./styles/auth.css";

async function bootstrap() {
  await loadRuntimeConfig();

  document.documentElement.dataset.uiTheme = getStoredThemeMode();
  applyCompanyTheme(getCompanyIdFromAccount(getStoredAccountId()));

  const root = document.getElementById("root");

  if (!root) {
    throw new Error("Root element #root was not found");
  }

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
