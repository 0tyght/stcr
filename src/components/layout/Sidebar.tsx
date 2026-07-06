import { PackageOpen } from "lucide-react";
import { NavLink } from "react-router-dom";
import { appRoutes } from "../../app/routes";
import { useAppData } from "../../app/providers";

export function Sidebar() {
  const { ovens } = useAppData();

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <NavLink to="/" className="brand-mark" aria-label="กลับ Dashboard">
          GR
        </NavLink>

        <div className="brand-text">
          <strong>GRAND RUBBER</strong>
          <span>Smoking Control</span>
        </div>
      </div>

      <nav className="primary-nav" aria-label="เมนูหลัก">
        {appRoutes.map((route) => {
          const Icon = route.icon;

          return (
            <NavLink
              key={route.key}
              className="nav-item"
              to={route.path}
              end={route.path === "/"}
            >
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

            <span className="oven-label">
              <span className="oven-word">เตา </span>
              {oven.number}
            </span>

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