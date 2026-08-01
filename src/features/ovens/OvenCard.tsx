import { CalendarDays, Clock3, Droplets, Flame, Gauge, Thermometer, Wind } from "lucide-react";
import { Link } from "react-router";
import { StatusBadge } from "../../components/ui/StatusBadge";
import type { Oven } from "../../types";
import { formatDate, formatNumber, formatSensorValue, formatTime } from "../../utils/format";
import { getReadingState } from "../../utils/limits";

export function OvenCard({ oven }: { oven: Oven }) {
  const isLive = oven.status === "open";
  const chamberFresh = readingIsFresh(oven.readings.chamberTemp.updatedAt);
  const chamberState = chamberFresh
    ? getReadingState(oven.readings.chamberTemp.value, "chamberTemp", oven.limits)
    : "offline";

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
          {isLive && chamberFresh ? (
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
            {formatMiniReading(oven.readings.humidity.value, oven.readings.humidity.updatedAt, 1, "%")}
          </span>
          <span>
            <Flame size={13} />
            {formatMiniReading(oven.readings.furnaceTemp.value, oven.readings.furnaceTemp.updatedAt, 0, "°C")}
          </span>
          <span>
            <Wind size={13} />
            {formatMiniReading(oven.readings.blowerTemp.value, oven.readings.blowerTemp.updatedAt, 1, "°C")}
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

function readingIsFresh(updatedAt: string): boolean {
  const ageMs = Date.now() - Date.parse(updatedAt);
  return Number.isFinite(ageMs) && ageMs <= 5 * 60 * 1000;
}

function formatMiniReading(
  value: number,
  updatedAt: string,
  precision: number,
  unit: string,
): string {
  return readingIsFresh(updatedAt) ? `${formatNumber(value, precision)}${unit}` : "—";
}
