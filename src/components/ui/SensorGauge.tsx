import type { LimitRule, SensorKey } from "../../types";
import { formatNumber, formatTime } from "../../utils/format";
import { sensorByKey } from "../../utils/sensors";

type GaugeTone = "normal" | "warning" | "danger";

const SVG_WIDTH = 220;
const SVG_HEIGHT = 134;

const CENTER_X = 110;
const CENTER_Y = 112;

const OUTER_RADIUS = 88;
const INNER_RADIUS = 71;

const OUTER_STROKE_WIDTH = 6;
const INNER_STROKE_WIDTH = 18;

export function SensorGauge({
  sensor,
  value,
  updatedAt,
  limit,
  showLimit = true,
}: {
  sensor: SensorKey;
  value: number;
  updatedAt: string;
  limit?: LimitRule;
  showLimit?: boolean;
}) {
  const definition = sensorByKey[sensor];
  const unit = definition.unit === "C" ? "°C" : "%";
  const precision = sensor === "chamberTemp" || sensor === "humidity" ? 2 : 0;
  const formattedValue = formatNumber(value, precision);
  const readingAgeMs = Date.now() - Date.parse(updatedAt);
  const readingIsStale = !Number.isFinite(readingAgeMs) || readingAgeMs > 180_000;

  const hasLimit = showLimit && !!limit && sensor !== "blowerTemp";
  const scale = getSensorScale(sensor);
  const ratio = clamp((value - scale.min) / Math.max(scale.max - scale.min, 1), 0, 1);

  // หัวกลมของ stroke จะยื่นเลยปลาย path ครึ่งหนึ่งของความหนาเส้น
  // จึงหดปลาย centerline กลับ เพื่อให้ขอบหัวกลมตรงกับค่าจริงบนสเกล
  const progressCapRatio =
    (INNER_STROKE_WIDTH / 2) / (Math.PI * INNER_RADIUS);
  const progressArcEndRatio =
    ratio > 0 ? Math.max(0, ratio - progressCapRatio) : 0;
  const outerStartPoint = pointOnGauge(OUTER_RADIUS, 0);
  const outerEndPoint = pointOnGauge(OUTER_RADIUS, 1);

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
          {hasLimit ? getToneLabel(value, limit.lower, limit.upper) : "ปกติ"}
        </strong>
      </div>

      <div
        className="gauge-visual"
        style={{
          minHeight: 132,
          height: 132,
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
        }}
      >
        <svg
          className="gauge-svg"
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          role="img"
          aria-label={`${definition.label} ${formattedValue}${unit}`}
          style={{
            width: 245,
            maxWidth: "100%",
            height: 132,
            display: "block",
          }}
        >
          <path
            d={describeGaugeArc(OUTER_RADIUS, 0, 1)}
            fill="none"
            stroke="var(--surface-strong)"
            strokeWidth={OUTER_STROKE_WIDTH}
            strokeLinecap="round"
            opacity={0.9}
          />

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
                strokeWidth={OUTER_STROKE_WIDTH}
                strokeLinecap={hasLimit ? "butt" : "round"}
                opacity={0.96}
              />
            );
          })}
          {hasLimit ? (
            <>
              <circle
                cx={outerStartPoint.x}
                cy={outerStartPoint.y}
                r={OUTER_STROKE_WIDTH / 2 + 0.35}
                fill={outerSegments[0]?.color}
              />
              <circle
                cx={outerEndPoint.x}
                cy={outerEndPoint.y}
                r={OUTER_STROKE_WIDTH / 2 + 0.35}
                fill={outerSegments[outerSegments.length - 1]?.color}
              />
            </>
          ) : null}
          <path
            d={describeGaugeArc(INNER_RADIUS, 0, 1)}
            fill="none"
            stroke="var(--surface-strong)"
            strokeWidth={INNER_STROKE_WIDTH}
            strokeLinecap="round"
          />
          {ratio > 0 ? (
            <path
              d={describeGaugeArc(
                INNER_RADIUS,
                0,
                progressArcEndRatio,
              )}
              fill="none"
              stroke={progressColor}
              strokeWidth={INNER_STROKE_WIDTH}
              strokeLinecap="round"
            />
          ) : null}

          <text
            x={CENTER_X}
            y="81"
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fill: "var(--ink-strong)",
              fontSize: 24,
              fontWeight: 850,
            }}
          >
            {formattedValue}
            <tspan
              dx="4"
              style={{
                fill: "var(--muted)",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {unit}
            </tspan>
          </text>

          <text
            x={CENTER_X}
            y="103"
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fill: "var(--muted)",
              fontSize: 15,
              fontWeight: 800,
            }}
          >
            {definition.shortLabel}
          </text>
        </svg>
      </div>

      <div className="gauge-meta">
        <span>
          {hasLimit
            ? `Lower ${formatCompact(limit.lower)}${unit} · Upper ${formatCompact(
                limit.upper,
              )}${unit}`
            : "ไม่มี Upper/Lower สำหรับค่านี้"}
        </span>
        <small className={readingIsStale ? "is-stale" : ""}>
          {readingIsStale ? "ข้อมูลล่าสุด " : "อัปเดต "}
          {formatTime(updatedAt)}
        </small>
      </div>
    </article>
  );
}

function getSensorScale(
  sensor: SensorKey,
): { min: number; max: number } {
  if (sensor === "furnaceTemp" || sensor === "blowerTemp") {
    return { min: 0, max: 1000 };
  }

  return { min: 0, max: 100 };
}

function getGaugeTone(value: number, lower: number, upper: number): GaugeTone {
  if (value > upper) return "danger";
  if (value < lower) return "warning";

  const range = Math.max(upper - lower, 1);
  const warningGap = range * 0.08;

  if (value >= upper - warningGap || value <= lower + warningGap) {
    return "warning";
  }

  return "normal";
}

function getToneLabel(
  value: number,
  lower: number,
  upper: number,
): string {
  if (value > upper) return "เกิน limit";
  if (value < lower) return "ต่ำกว่า limit";

  const range = Math.max(upper - lower, 1);
  const warningGap = range * 0.08;

  if (value >= upper - warningGap || value <= lower + warningGap) {
    return "ใกล้ limit";
  }

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

  return [
    "M",
    start.x.toFixed(3),
    start.y.toFixed(3),
    "A",
    radius,
    radius,
    0,
    "0",
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
