import { LogIn, Moon, Palette } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  accountList,
  applyCompanyTheme,
  getCompany,
  getCompanyIdFromAccount,
} from "../config/companies";
import {
  ACCOUNT_STORAGE_KEY,
  getStoredAccountId,
  getStoredThemeMode,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "../config/preferences";

export function LoginPage({
  onLogin,
}: {
  onLogin: (username: string) => void;
}) {
  const [username, setUsername] = useState(() => getStoredAccountId());
  const [password, setPassword] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode("company"));

  const companyId = useMemo(() => getCompanyIdFromAccount(username), [username]);
  const company = useMemo(() => getCompany(companyId), [companyId]);

  useEffect(() => {
    applyCompanyTheme(companyId);
    document.documentElement.dataset.uiTheme = themeMode;

    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    localStorage.setItem(ACCOUNT_STORAGE_KEY, username);
  }, [companyId, themeMode, username]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    localStorage.setItem(ACCOUNT_STORAGE_KEY, username);
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);

    onLogin(username);
  }

  function toggleTheme() {
    setThemeMode((current) => (current === "company" ? "dark" : "company"));
  }

  return (
    <main className="login-screen login-simple">
      <button
        className={`theme-switch login-corner-theme is-${themeMode}`}
        type="button"
        onClick={toggleTheme}
        aria-label="สลับธีม"
        title="สลับธีม"
      >
        {themeMode === "company" ? <Palette size={15} /> : <Moon size={15} />}
        <span>{themeMode === "company" ? "ธีมบริษัท" : "ธีมมืด"}</span>

        <span className="theme-switch-track">
          <span className="theme-switch-dot" />
        </span>
      </button>

      <form className="login-panel login-simple-panel" onSubmit={handleSubmit}>
        <div className="login-simple-brand">
          <div className="login-simple-mark-wrap">
            {company.brand.kind === "image" && company.brand.logo ? (
              <img
                src={company.brand.logo}
                alt={company.brand.logoAlt}
                className="login-simple-mark-image"
              />
            ) : (
              <div className="login-simple-mark">{company.brand.text}</div>
            )}
          </div>

          <div>
            <p className="eyebrow">{company.name}</p>
            <h1>เข้าสู่ระบบ</h1>
            <span>Smoking Temperature Control</span>
          </div>
        </div>

        <label>
          <span>ผู้ใช้</span>
          <select
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          >
            {accountList.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>รหัสผ่าน</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder="กรอกรหัสผ่าน"
            autoComplete="current-password"
          />
        </label>

        <button className="button button-primary login-simple-submit" type="submit">
          <LogIn size={18} />
          เข้าสู่ระบบ
        </button>
      </form>
    </main>
  );
}
