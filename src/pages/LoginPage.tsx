import { LogIn } from "lucide-react";
import { FormEvent } from "react";

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onLogin();
  }

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="login-brand">GR</div>
        <p className="eyebrow">Smoking Temperature Control Report</p>
        <h1>เข้าสู่ระบบ</h1>
        <label>
          <span>ผู้ใช้</span>
          <input name="username" autoComplete="username" defaultValue="gr_dev_admin" required />
        </label>
        <label>
          <span>รหัสผ่าน</span>
          <input name="password" type="password" autoComplete="current-password" defaultValue="admin123" required />
        </label>
        <button className="button button-primary" type="submit">
          <LogIn size={18} />
          เข้าสู่ระบบ
        </button>
      </form>
    </main>
  );
}
