import type { LimitRule, SensorKey } from "../../types";
import { formatNumber } from "../../utils/format";
import { sensorByKey } from "../../utils/sensors";

export function SensorGauge({
  sensor,
  value,
  limit,
  showLimit = true,
}: {
  sensor: SensorKey;
  value: number;
  limit?: LimitRule;
  showLimit?: boolean;
}) {
  const definition = sensorByKey[sensor];
  const unit = definition.unit === "C" ? "°C" : "%";
  const ratio = showLimit && limit ? getLimitRatio(value, limit.lower, limit.upper) : getValueRatio(sensor, value);
  const tone = showLimit && limit ? getGaugeTone(value, limit.lower, limit.upper, ratio) : "normal";
  const formattedValue = formatNumber(value, sensor === "furnaceTemp" ? 0 : 1);

  return (
    <article className={`gauge-card tone-${tone}`}>
      <div className="gauge-card-head">
        <span>{definition.label}</span>
        <strong>{getToneLabel(tone)}</strong>
      </div>
      <div className="gauge-visual">
        <svg className="gauge-svg" viewBox="0 0 120 72" aria-hidden="true">
          <path className="gauge-threshold gauge-threshold-low" d="M 14 62 A 46 46 0 0 1 106 62" pathLength={100} />
          <path className="gauge-threshold gauge-threshold-ok" d="M 14 62 A 46 46 0 0 1 106 62" pathLength={100} />
          <path className="gauge-threshold gauge-threshold-high" d="M 14 62 A 46 46 0 0 1 106 62" pathLength={100} />
          <path className="gauge-bg" d="M 14 62 A 46 46 0 0 1 106 62" pathLength={100} />
          <path
            className="gauge-fill"
            d="M 14 62 A 46 46 0 0 1 106 62"
            pathLength={100}
            strokeDasharray={`${ratio} 100`}
          />
        </svg>
        <strong>
          {formattedValue}
          <span>{unit}</span>
        </strong>
      </div>
      <div className="gauge-meta">
        <span>{showLimit ? `${Math.round(ratio)}% ของช่วง limit` : "ค่าปัจจุบัน"}</span>
        {showLimit && limit ? (
          <small>
            Lower {limit.lower}
            {unit} · Upper {limit.upper}
            {unit}
          </small>
        ) : (
          <small>ไม่มี Upper/Lower สำหรับค่านี้</small>
        )}
      </div>
    </article>
  );
}

function getLimitRatio(value: number, lower: number, upper: number): number {
  const range = Math.max(upper - lower, 1);
  return clamp(((value - lower) / range) * 100, 0, 100);
}

function getValueRatio(sensor: SensorKey, value: number): number {
  if (sensor === "humidity") return clamp(value, 0, 100);
  return clamp(value, 0, 100);
}

function getGaugeTone(value: number, lower: number, upper: number, ratio: number): "normal" | "warning" | "danger" {
  if (value > upper) return "danger";
  if (value < lower || ratio >= 88) return "warning";
  return "normal";
}

function getToneLabel(tone: "normal" | "warning" | "danger"): string {
  if (tone === "danger") return "เกิน limit";
  if (tone === "warning") return "ใกล้ limit";
  return "ปกติ";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
