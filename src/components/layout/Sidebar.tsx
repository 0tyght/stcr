import { Menu, PackageOpen } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { appRoutes } from "../../app/routes";
import { useAppData } from "../../app/providers";

export function Sidebar() {
  const { ovens } = useAppData();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="brand-row">
        <NavLink to="/" className="brand-mark" aria-label="กลับ Dashboard">
          GR
        </NavLink>
        <button className="icon-button" type="button" onClick={() => setCollapsed((value) => !value)} aria-label="ย่อเมนู">
          <Menu size={20} />
        </button>
      </div>

      <nav className="primary-nav" aria-label="เมนูหลัก">
        {appRoutes.map((route) => {
          const Icon = route.icon;
          return (
            <NavLink key={route.key} className="nav-item" to={route.path} end={route.path === "/"}>
              <Icon size={18} />
              <span>{route.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <nav className="oven-nav" aria-label="รายการเตา">
        {ovens.map((oven) => (
          <NavLink key={oven.id} className="oven-link" to={`/ovens/${oven.id}`}>
            <PackageOpen size={17} />
            <span className="oven-label">เตา {oven.number}</span>
            <span className={`mini-status status-${oven.status}`} />
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <strong>GRAND RUBBER</strong>
        <span>Smoking Control</span>
      </div>
    </aside>
  );
}
