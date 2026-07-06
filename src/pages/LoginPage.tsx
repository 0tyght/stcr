import {
  CheckCircle2,
  Factory,
  LogIn,
  Moon,
  Palette,
  ShieldCheck,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type ThemeMode = "company" | "dark";
type LoginAccount = "gr_dev_admin" | "ttn_dev_admin";

const THEME_STORAGE_KEY = "stcr-theme-mode";
const ACCOUNT_STORAGE_KEY = "stcr-account";

const accounts: Array<{
  username: LoginAccount;
  company: "gr" | "ttn";
  label: string;
  description: string;
  mark: string;
}> = [
  {
    username: "gr_dev_admin",
    company: "gr",
    label: "Grand Rubber",
    description: "โรงงานอบยาง / เตา GR",
    mark: "GR",
  },
  {
    username: "ttn_dev_admin",
    company: "ttn",
    label: "TTN Rubber",
    description: "โรงงานอบยาง / เตา TTN",
    mark: "TTN",
  },
];

function getInitialThemeMode(): ThemeMode {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  return savedTheme === "dark" ? "dark" : "company";
}

function getInitialAccount(): LoginAccount {
  const savedAccount = localStorage.getItem(ACCOUNT_STORAGE_KEY);

  if (savedAccount === "ttn_dev_admin") {
    return "ttn_dev_admin";
  }

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
  const activeAccount = accounts.find((account) => account.username === username) ?? accounts[0];

  useEffect(() => {
    document.documentElement.dataset.company = company;
    document.documentElement.dataset.uiTheme = themeMode;

    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    localStorage.setItem(ACCOUNT_STORAGE_KEY, username);
  }, [company, themeMode, username]);

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
    <main className="login-screen login-v2">
      <button
        className={`theme-switch login-floating-theme is-${themeMode}`}
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

      <section className="login-shell" aria-label="เข้าสู่ระบบ Smoking Temperature Control">
        <aside className="login-hero">
          <div className={`login-logo-badge login-logo-${company}`}>
            {activeAccount.mark}
          </div>

          <div className="login-hero-content">
            <p className="login-kicker">Smoking Temperature Control</p>
            <h1>ระบบติดตามอุณหภูมิเตาอบยาง</h1>
            <p className="login-hero-text">
              ตรวจสอบสถานะเตา ค่าล่าสุด กราฟ Realtime และรายงานรอบอบย้อนหลัง
              ผ่าน Dashboard เดียว
            </p>
          </div>

          <div className="login-feature-grid">
            <div className="login-feature-card">
              <Factory size={18} />
              <strong>Oven Dashboard</strong>
              <span>ดูสถานะเตาทั้งหมดในหน้าเดียว</span>
            </div>

            <div className="login-feature-card">
              <ShieldCheck size={18} />
              <strong>Alarm Control</strong>
              <span>แยกเตือน อันตราย และขาดการเชื่อมต่อ</span>
            </div>
          </div>

          <div className="login-hero-footer">
            <span>GR / TTN Company Theme</span>
            <strong>{activeAccount.label}</strong>
          </div>
        </aside>

        <form className="login-panel login-form-panel" onSubmit={handleSubmit}>
          <div className="login-form-head">
            <span className={`login-mini-mark login-mini-${company}`}>
              {activeAccount.mark}
            </span>

            <div>
              <p className="eyebrow">{activeAccount.label}</p>
              <h2>เข้าสู่ระบบ</h2>
            </div>
          </div>

          <div className="login-account-grid" aria-label="เลือกบัญชีบริษัท">
            {accounts.map((account) => (
              <button
                key={account.username}
                type="button"
                className={`login-account-card ${
                  username === account.username ? "is-active" : ""
                }`}
                onClick={() => setUsername(account.username)}
              >
                <span className={`login-account-mark login-account-${account.company}`}>
                  {account.mark}
                </span>

                <span className="login-account-content">
                  <strong>{account.label}</strong>
                  <small>{account.username}</small>
                  <em>{account.description}</em>
                </span>

                {username === account.username ? (
                  <CheckCircle2 className="login-account-check" size={18} />
                ) : null}
              </button>
            ))}
          </div>

          <label className="login-field">
            <span>รหัสผ่าน</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="กรอกรหัสผ่าน"
              autoComplete="current-password"
            />
          </label>

          <button className="button button-primary login-submit" type="submit">
            <LogIn size={18} />
            เข้าสู่ระบบ
          </button>

          <p className="login-note">
            ใช้สำหรับต้นแบบระบบ Smoking Temperature Control
            <br />
            เลือกบัญชีเพื่อเปลี่ยนธีมบริษัทอัตโนมัติ
          </p>
        </form>
      </section>
    </main>
  );
}