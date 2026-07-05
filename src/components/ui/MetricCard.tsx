import type { ReactNode } from "react";

export function MetricCard({
  label,
  value,
  unit,
  tone = "normal",
  footer,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "normal" | "warning" | "danger" | "offline";
  footer?: string;
  icon?: ReactNode;
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-card-head">
        <h3>{label}</h3>
        {icon}
      </div>
      <div className="metric-value">
        <strong>{value}</strong>
        {unit ? <span>{unit}</span> : null}
      </div>
      {footer ? <p>{footer}</p> : null}
    </article>
  );
}
