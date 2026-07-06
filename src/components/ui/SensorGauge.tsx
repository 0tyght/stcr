import type { LimitRule, SensorKey } from "../../types";
import { formatNumber } from "../../utils/format";
import { sensorByKey } from "../../utils/sensors";

type GaugeTone = "normal" | "warning" | "danger";

const SVG_WIDTH = 220;
const SVG_HEIGHT = 118;

const CENTER_X = 110;
const CENTER_Y = 104;

const OUTER_RADIUS = 78;
const INNER_RADIUS = 66;

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
  const formattedValue = formatNumber(value, sensor === "furnaceTemp" ? 0 : 1);

  const hasLimit = showLimit && !!limit;
  const scale = hasLimit ? getLimitScale(limit) : getDefaultScale(sensor, value);
  const ratio = clamp((value - scale.min) / Math.max(scale.max - scale.min, 1), 0, 1);

  const tone = hasLimit ? getGaugeTone(value, limit.lower, limit.upper) : "normal";
  const progressColor = hasLimit ? getToneColor(tone) : definition.color;

  const outerSegments = hasLimit
    ? [
        {
          from: scale.min,
          to: limit.lower,
          color: "#eab308",
        },
        {
          from: limit.lower,
          to: limit.upper,
          color: "#22c55e",
        },
        {
          from: limit.upper,
          to: scale.max,
          color: "#ef4444",
        },
      ]
    : [
        {
          from: scale.min,
          to: scale.max,
          color: withAlpha(definition.color, 0.72),
        },
      ];

  return (
    <article className={`gauge-card tone-${tone} ${hasLimit ? "" : "no-limit"}`}>
      <div className="gauge-card-head">
        <span>{definition.label}</span>

        <strong style={{ color: hasLimit ? getToneColor(tone) : definition.color }}>
          {hasLimit ? getToneLabel(tone) : "ปกติ"}
        </strong>
      </div>

      <div className="gauge-visual">
        <svg
          className="gauge-svg"
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          role="img"
          aria-label={`${definition.label} ${formattedValue}${unit}`}
        >
          {outerSegments.map((segment, index) => {
            const fromRatio = clamp(
              (segment.from - scale.min) / Math.max(scale.max - scale.min, 1),
              0,
              1,
            );

            const toRatio = clamp(
              (segment.to - scale.min) / Math.max(scale.max - scale.min, 1),
              0,
              1,
            );

            if (toRatio <= fromRatio) return null;

            return (
              <path
                key={`${segment.color}-${index}`}
                d={describeGaugeArc(OUTER_RADIUS, fromRatio, toRatio)}
                fill="none"
                stroke={segment.color}
                strokeWidth={5}
                strokeLinecap="round"
                opacity={0.96}
              />
            );
          })}

          <path
            d={describeGaugeArc(INNER_RADIUS, 0, 1)}
            fill="none"
            stroke="var(--surface-strong)"
            strokeWidth={18}
            strokeLinecap="round"
          />

          <path
            d={describeGaugeArc(INNER_RADIUS, 0, ratio)}
            fill="none"
            stroke={progressColor}
            strokeWidth={18}
            strokeLinecap="round"
          />
        </svg>

        <strong>
          {formattedValue}
          <span>{unit}</span>
        </strong>

        <em>{definition.shortLabel}</em>
      </div>

      <div className="gauge-meta">
        <span>
          {hasLimit
            ? `Lower ${formatCompact(limit.lower)}${unit} · Upper ${formatCompact(
                limit.upper,
              )}${unit}`
            : "ไม่มี Upper/Lower สำหรับค่านี้"}
        </span>
      </div>
    </article>
  );
}

function getLimitScale(limit: LimitRule): { min: number; max: number } {
  const range = Math.max(limit.upper - limit.lower, 1);
  const padding = range * 0.5;

  return {
    min: Math.max(0, limit.lower - padding),
    max: limit.upper + padding,
  };
}

function getDefaultScale(sensor: SensorKey, value: number): { min: number; max: number } {
  if (sensor === "humidity") {
    return {
      min: 0,
      max: 100,
    };
  }

  return {
    min: 0,
    max: Math.max(100, Math.ceil(value * 1.25)),
  };
}

function getGaugeTone(value: number, lower: number, upper: number): GaugeTone {
  if (value > upper) return "danger";
  if (value < lower) return "warning";

  const range = Math.max(upper - lower, 1);
  const warningHigh = upper - range * 0.08;
  const warningLow = lower + range * 0.08;

  if (value >= warningHigh || value <= warningLow) {
    return "warning";
  }

  return "normal";
}

function getToneLabel(tone: GaugeTone): string {
  if (tone === "danger") return "เกิน limit";
  if (tone === "warning") return "ใกล้ limit";
  return "ปกติ";
}

function getToneColor(tone: GaugeTone): string {
  if (tone === "danger") return "#ef4444";
  if (tone === "warning") return "#eab308";
  return "#22c55e";
}

function describeGaugeArc(radius: number, fromRatio: number, toRatio: number): string {
  const start = pointOnGauge(radius, fromRatio);
  const end = pointOnGauge(radius, toRatio);
  const largeArcFlag = toRatio - fromRatio > 0.5 ? "1" : "0";

  return [
    "M",
    start.x.toFixed(3),
    start.y.toFixed(3),
    "A",
    radius,
    radius,
    0,
    largeArcFlag,
    1,
    end.x.toFixed(3),
    end.y.toFixed(3),
  ].join(" ");
}

function pointOnGauge(radius: number, ratio: number) {
  const angle = Math.PI + Math.PI * clamp(ratio, 0, 1);

  return {
    x: CENTER_X + radius * Math.cos(angle),
    y: CENTER_Y + radius * Math.sin(angle),
  };
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");

  if (normalized.length !== 6) return hex;

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatCompact(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}