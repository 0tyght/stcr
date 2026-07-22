import {
  Building2,
  Check,
  Flame,
  LogIn,
  Moon,
  Palette,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  applyCompanyTheme,
  companies,
  companyList,
  getCompany,
  type CompanyId,
} from "../config/companies";
import {
  ACCOUNT_STORAGE_KEY,
  COMPANY_STORAGE_KEY,
  getStoredAccountId,
  getStoredCompanyId,
  getStoredThemeMode,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "../config/preferences";

export function LoginPage({
  onLogin,
}: {
  onLogin: (username: string, password: string, companyId: CompanyId) => Promise<void>;
}) {
  const [companyId, setCompanyId] = useState<CompanyId>(() => getStoredCompanyId());
  const [username, setUsername] = useState(() => getStoredAccountId());
  const [password, setPassword] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode("company"));
  const [loginError, setLoginError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const company = useMemo(() => getCompany(companyId), [companyId]);

  useEffect(() => {
    applyCompanyTheme(companyId);
    document.documentElement.dataset.uiTheme = themeMode;
    localStorage.setItem(COMPANY_STORAGE_KEY, companyId);
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    localStorage.setItem(ACCOUNT_STORAGE_KEY, username);
  }, [companyId, themeMode, username]);

  function selectCompany(nextCompanyId: CompanyId) {
    if (nextCompanyId === companyId) return;
    const nextCompany = companies[nextCompanyId];
    setCompanyId(nextCompanyId);
    setUsername(nextCompany.accounts[0]?.id ?? "");
    setPassword("");
    setLoginError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    localStorage.setItem(COMPANY_STORAGE_KEY, companyId);
    localStorage.setItem(ACCOUNT_STORAGE_KEY, username);
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);

    setLoginError("");
    setSubmitting(true);
    try {
      await onLogin(username, password, companyId);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleTheme() {
    setThemeMode((current) => (current === "company" ? "dark" : "company"));
  }

  return (
    <main className="login-screen login-modern">
      <div className="login-ambient login-ambient-one" />
      <div className="login-ambient login-ambient-two" />

      <button
        className={`theme-switch login-corner-theme is-${themeMode}`}
        type="button"
        onClick={toggleTheme}
        aria-label="สลับธีม"
        title="สลับธีม"
      >
        {themeMode === "company" ? <Palette size={15} /> : <Moon size={15} />}
        <span>{themeMode === "company" ? "ธีมบริษัท" : "ธีมมืด"}</span>
        <span className="theme-switch-track" aria-hidden="true">
          <span className="theme-switch-dot" />
        </span>
      </button>

      <section className="login-modern-shell">
        <aside className="login-showcase" aria-label="ระบบควบคุมอุณหภูมิการรมควัน">
          <div className="login-showcase-badge">
            <Radio size={15} />
            <span>REAL-TIME MONITORING</span>
          </div>

          <div className="login-showcase-copy">
            <div className="login-showcase-icon"><Flame size={35} /></div>
            <p className="eyebrow">Smoking Temperature Control</p>
            <h1>ติดตามทุกเตา<br />มั่นใจในทุกรอบการผลิต</h1>
            <p>
              ดูสถานะ อุณหภูมิ ความชื้น Alarm และรายงานย้อนหลังจากข้อมูลโรงงานจริง
              ในระบบเดียว
            </p>
          </div>

          <div className="login-showcase-points">
            <span><Radio size={16} /> ข้อมูลจาก MQTT แบบเรียลไทม์</span>
            <span><ShieldCheck size={16} /> แยกข้อมูลตามบริษัทอย่างปลอดภัย</span>
          </div>
        </aside>

        <form className="login-panel login-modern-panel" onSubmit={handleSubmit}>
          <div className="login-panel-heading">
            <div className="login-active-brand" aria-hidden="true">
              {company.brand.kind === "image" && company.brand.logo ? (
                <img src={company.brand.logo} alt="" />
              ) : (
                <span>{company.brand.text}</span>
              )}
            </div>
            <div>
              <p className="eyebrow">ยินดีต้อนรับ</p>
              <h2>เข้าสู่ระบบ</h2>
              <p>เลือกบริษัทและกรอกข้อมูลบัญชีของคุณ</p>
            </div>
          </div>

          <fieldset className="company-picker">
            <legend>เลือกบริษัท</legend>
            <div className="company-picker-grid">
              {companyList.map((option) => {
                const selected = option.id === companyId;
                return (
                  <button
                    key={option.id}
                    className={`company-choice company-choice-${option.id}${selected ? " is-selected" : ""}`}
                    type="button"
                    onClick={() => selectCompany(option.id as CompanyId)}
                    aria-pressed={selected}
                  >
                    <span className="company-choice-logo">
                      {option.brand.kind === "image" && option.brand.logo ? (
                        <img src={option.brand.logo} alt={option.brand.logoAlt} />
                      ) : (
                        <span>{option.brand.text}</span>
                      )}
                    </span>
                    <span className="company-choice-copy">
                      <strong>{option.shortName}</strong>
                      <small>{option.name}</small>
                    </span>
                    <span className="company-choice-check" aria-hidden="true">
                      {selected ? <Check size={14} /> : <Building2 size={14} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="login-fields">
            <label>
              <span>ชื่อผู้ใช้</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                type="text"
                autoComplete="username"
                maxLength={80}
                required
                placeholder="กรอกชื่อผู้ใช้"
              />
            </label>

            <label>
              <span>รหัสผ่าน</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                placeholder="กรอกรหัสผ่าน"
                autoComplete="current-password"
                required
              />
            </label>
          </div>

          {loginError ? <p className="login-error" role="alert">{loginError}</p> : null}

          <button className="button button-primary login-modern-submit" type="submit" disabled={submitting}>
            <LogIn size={18} />
            {submitting ? "กำลังตรวจสอบ..." : `เข้าสู่ระบบ ${company.shortName}`}
          </button>

          <p className="login-support-note">
            ระบบสำหรับผู้ใช้งานที่ได้รับอนุญาตของ {company.name}
          </p>
        </form>
      </section>
    </main>
  );
}
