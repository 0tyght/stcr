import { CalendarDays, Clock3, Droplets, Flame, Gauge, Thermometer, Wind } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../../components/ui/StatusBadge";
import type { Oven } from "../../types";
import { formatDate, formatNumber, formatSensorValue, formatTime } from "../../utils/format";

export function OvenCard({ oven }: { oven: Oven }) {
  return (
    <article className={`oven-card status-${oven.status}`}>
      <header className={`oven-card-header status-${oven.status}`}>
        <h2>{oven.name}</h2>
        <StatusBadge kind={oven.status} />
      </header>
      <div className="oven-card-body">
        <div className="oven-meta">
          <span>อัปเดตล่าสุด</span>
          <strong>
            <CalendarDays size={15} />
            {formatDate(oven.lastUpdatedAt)}
          </strong>
          <strong>
            <Clock3 size={15} />
            {formatTime(oven.lastUpdatedAt)}
          </strong>
          <span>ค่าในห้องอบ</span>
          <strong>
            <Thermometer size={15} />
            {formatSensorValue("chamberTemp", oven.readings.chamberTemp.value)}
          </strong>
        </div>
        <div className="cycle-box">
          <Gauge size={20} />
          <strong>{oven.cycleCount}</strong>
          <span>รอบ</span>
        </div>
      </div>
      <div className="oven-mini-strip" aria-label="ค่าล่าสุดของเซนเซอร์">
        <span>
          <Droplets size={13} />
          {formatNumber(oven.readings.humidity.value, 1)}%
        </span>
        <span>
          <Flame size={13} />
          {formatNumber(oven.readings.furnaceTemp.value, 0)}°C
        </span>
        <span>
          <Wind size={13} />
          {formatNumber(oven.readings.blowerTemp.value, 1)}°C
        </span>
      </div>
      <footer className="oven-card-footer">
        <Link className="button button-dark" to={`/ovens/${oven.id}`}>
          ดูรายละเอียดเตา
        </Link>
      </footer>
    </article>
  );
}
