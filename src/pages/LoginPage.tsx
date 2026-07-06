import { LogIn } from "lucide-react";
import { FormEvent, useState } from "react";

export function LoginPage({
  onLogin,
}: {
  onLogin: (username: string) => void;
}) {
  const [username, setUsername] = useState("gr_dev_admin");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanUsername = username.trim();

    if (!cleanUsername) {
      alert("กรุณาเลือกผู้ใช้");
      return;
    }

    onLogin(cleanUsername);
  }

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="login-brand">
          {username.includes("ttn") ? "TTN" : "GR"}
        </div>

        <p className="eyebrow">Smoking Temperature Control Report</p>

        <h1>เข้าสู่ระบบ</h1>

        <label>
          <span>ผู้ใช้</span>
          <select
            value={username}
            onChange={(event) => setUsername(event.target.value)}
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

        <button className="button button-primary" type="submit">
          <LogIn size={18} />
          เข้าสู่ระบบ
        </button>
      </form>
    </main>
  );
}