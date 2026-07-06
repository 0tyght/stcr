import { LogIn, Moon, Palette } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type ThemeMode = "company" | "dark";
type LoginAccount = "gr_dev_admin" | "ttn_dev_admin";

const THEME_STORAGE_KEY = "stcr-theme-mode";
const ACCOUNT_STORAGE_KEY = "stcr-account";

function getInitialThemeMode(): ThemeMode {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  return savedTheme === "dark" ? "dark" : "company";
}

function getInitialAccount(): LoginAccount {
  const savedAccount = localStorage.getItem(ACCOUNT_STORAGE_KEY);

  if (savedAccount === "ttn_dev_admin") return "ttn_dev_admin";
  return "gr_dev_admin";
}

function getCompanyFromUsername(username: string): "gr" | "ttn" {
  return username.toLowerCase().includes("ttn") ? "ttn" : "gr";
}

export function LoginPage({
  onLogin,
}: {
  onLogin: (username: string) => void;
}) {
  const [username, setUsername] = useState<LoginAccount>(() => getInitialAccount());
  const [password, setPassword] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode());

  const company = useMemo(() => getCompanyFromUsername(username), [username]);
  const companyLabel = company === "ttn" ? "TTN Rubber" : "Grand Rubber";

  useEffect(() => {
    document.documentElement.dataset.company = company;
    document.documentElement.dataset.uiTheme = themeMode;

    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    localStorage.setItem(ACCOUNT_STORAGE_KEY, username);
  }, [company, themeMode, username]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    localStorage.setItem(ACCOUNT_STORAGE_KEY, username);
    onLogin(username);
  }

  function toggleTheme() {
    setThemeMode((current) => (current === "company" ? "dark" : "company"));
  }

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className={`login-brand login-brand-${company}`}>
          {company === "ttn" ? "TTN" : "GR"}
        </div>

        <p className="eyebrow">{companyLabel}</p>

        <h1>เข้าสู่ระบบ</h1>

        <label>
          <span>ผู้ใช้</span>
          <select
            value={username}
            onChange={(event) => setUsername(event.target.value as LoginAccount)}
          >
            <option value="gr_dev_admin">gr_dev_admin</option>
            <option value="ttn_dev_admin">ttn_dev_admin</option>
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

        <button
          className={`theme-switch login-theme-switch is-${themeMode}`}
          type="button"
          onClick={toggleTheme}
        >
          {themeMode === "company" ? <Palette size={15} /> : <Moon size={15} />}
          <span className="theme-switch-track">
            <span className="theme-switch-dot" />
          </span>
          <span>{themeMode === "company" ? "ธีมบริษัท" : "ธีมมืด"}</span>
        </button>

        <button className="button button-primary" type="submit">
          <LogIn size={18} />
          เข้าสู่ระบบ
        </button>
      </form>
    </main>
  );
}