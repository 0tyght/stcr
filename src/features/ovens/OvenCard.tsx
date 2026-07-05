import { CalendarDays, Clock3, Droplets, Flame, Gauge, Thermometer, Wind } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../../components/ui/StatusBadge";
import type { Oven } from "../../types";
import { formatDate, formatNumber, formatSensorValue, formatTime } from "../../utils/format";
import { getReadingState } from "../../utils/limits";

export function OvenCard({ oven }: { oven: Oven }) {
  const isLive = oven.status === "open";
  const chamberState = getReadingState(oven.readings.chamberTemp.value, "chamberTemp", oven.limits);

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
          <span>{isLive ? "Realtime ในห้องอบ" : "ค่าล่าสุดก่อนหยุด"}</span>
          {isLive ? (
            <strong className={`reading-inline tone-${chamberState}`}>
              <Thermometer size={15} />
              {formatSensorValue("chamberTemp", oven.readings.chamberTemp.value)}
            </strong>
          ) : (
            <strong className="reading-inline tone-muted">-</strong>
          )}
        </div>
        <div className="cycle-box">
          <Gauge size={20} />
          <strong>{oven.cycleCount}</strong>
          <span>รอบ</span>
        </div>
      </div>
      {isLive ? (
        <div className="oven-mini-strip" aria-label="ค่า realtime แบบย่อ">
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
      ) : (
        <div className="oven-state-note">ดูข้อมูลย้อนหลังได้จากรายละเอียดเตา</div>
      )}
      <footer className="oven-card-footer">
        <Link className="button button-dark" to={`/ovens/${oven.id}`}>
          ดูรายละเอียดเตา
        </Link>
      </footer>
    </article>
  );
}
