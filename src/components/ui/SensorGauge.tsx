import { useEffect, useMemo, useState } from "react";
import type { LimitRule, SensorKey } from "../../types";
import { formatNumber } from "../../utils/format";
import { sensorByKey } from "../../utils/sensors";

type GaugeTone = "normal" | "warning" | "danger";
type UiTheme = "dark" | "company";

const SVG_WIDTH = 220;
const SVG_HEIGHT = 140;
const CENTER_X = 110;
const CENTER_Y = 112;
const OUTER_RADIUS = 78;
const INNER_RADIUS = 66;
const START_ANGLE = 210;
const END_ANGLE = 330;
const TOTAL_SWEEP = END_ANGLE - START_ANGLE;

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
  const theme = usePageTheme();

  const hasLimit = showLimit && !!limit;
  const scale = hasLimit ? getLimitScale(limit) : getDefaultScale(sensor, value);
  const tone = hasLimit ? getGaugeTone(value, limit.lower, limit.upper) : "normal";

  const ratio = clamp((value - scale.min) / Math.max(scale.max - scale.min, 1), 0, 1);

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
          color: withAlpha(definition.color, 0.55),
        },
      ];

  const palette = getGaugePalette(theme);
  const progressColor = hasLimit ? getToneColor(tone) : definition.color;
  const toneLabel = hasLimit ? getToneLabel(tone) : "ปกติ";
  const progressEndAngle = START_ANGLE + TOTAL_SWEEP * ratio;

  const gaugeId = useMemo(
    () =>
      `gauge-grad-${sensor}-${Math.round(value * 10)}-${
        hasLimit ? `${limit?.lower}-${limit?.upper}` : "nolimit"
      }`,
    [sensor, value, hasLimit, limit?.lower, limit?.upper],
  );

  return (
    <article
      className="sensor-gauge"
      style={{
        border: `1px solid ${palette.cardBorder}`,
        background: palette.cardBackground,
        borderRadius: 8,
        padding: 10,
        minHeight: 130,
      }}
    >
      <div
        className="sensor-gauge-head"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: palette.label,
          }}
        >
          {definition.label}
        </span>

        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            color: getToneTextColor(tone),
          }}
        >
          {toneLabel}
        </span>
      </div>

      <div
        className="sensor-gauge-body"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <svg
          width="100%"
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          role="img"
          aria-label={`${definition.label} ${formattedValue}${unit}`}
        >
          <defs>
            <linearGradient id={gaugeId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={withAlpha(progressColor, 0.72)} />
              <stop offset="100%" stopColor={progressColor} />
            </linearGradient>
          </defs>

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

            const startAngle = START_ANGLE + TOTAL_SWEEP * fromRatio;
            const endAngle = START_ANGLE + TOTAL_SWEEP * toRatio;

            if (toRatio <= fromRatio) return null;

            return (
              <path
                key={`${segment.color}-${index}`}
                d={describeArc(CENTER_X, CENTER_Y, OUTER_RADIUS, startAngle, endAngle)}
                fill="none"
                stroke={segment.color}
                strokeWidth={6}
                strokeLinecap="round"
                opacity={0.95}
              />
            );
          })}

          <path
            d={describeArc(CENTER_X, CENTER_Y, INNER_RADIUS, START_ANGLE, END_ANGLE)}
            fill="none"
            stroke={palette.track}
            strokeWidth={18}
            strokeLinecap="round"
          />

          <path
            d={describeArc(CENTER_X, CENTER_Y, INNER_RADIUS, START_ANGLE, progressEndAngle)}
            fill="none"
            stroke={`url(#${gaugeId})`}
            strokeWidth={18}
            strokeLinecap="round"
          />

          <text
            x={CENTER_X}
            y={74}
            textAnchor="middle"
            style={{
              fontSize: 20,
              fontWeight: 800,
              fill: palette.value,
            }}
          >
            {formattedValue}
            <tspan
              dx="3"
              style={{
                fontSize: 10,
                fontWeight: 700,
                fill: palette.unit,
              }}
            >
              {unit}
            </tspan>
          </text>

          <text
            x={CENTER_X}
            y={92}
            textAnchor="middle"
            style={{
              fontSize: 13,
              fontWeight: 700,
              fill: palette.caption,
            }}
          >
            {definition.shortLabel}
          </text>

          <text
            x={CENTER_X}
            y={112}
            textAnchor="middle"
            style={{
              fontSize: 10,
              fontWeight: 600,
              fill: palette.helper,
            }}
          >
            {hasLimit
              ? `Lower ${formatCompact(limit.lower)}${unit} · Upper ${formatCompact(
                  limit.upper,
                )}${unit}`
              : "ไม่มี Upper/Lower สำหรับค่านี้"}
          </text>
        </svg>
      </div>
    </article>
  );
}

function usePageTheme(): UiTheme {
  const [theme, setTheme] = useState<UiTheme>(() => getCurrentTheme());

  useEffect(() => {
    const root = document.documentElement;

    const sync = () => {
      setTheme(getCurrentTheme());
    };

    sync();

    const observer = new MutationObserver(sync);

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-ui-theme"],
    });

    window.addEventListener("storage", sync);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", sync);
    };
  }, []);

  return theme;
}

function getCurrentTheme(): UiTheme {
  const rootTheme = document.documentElement.dataset.uiTheme;
  return rootTheme === "company" ? "company" : "dark";
}

function getGaugePalette(theme: UiTheme) {
  if (theme === "company") {
    return {
      cardBackground: "#ffffff",
      cardBorder: "#d9e2ec",
      label: "#6b7280",
      track: "#253042",
      value: "#253042",
      unit: "#64748b",
      caption: "#374151",
      helper: "#94a3b8",
    };
  }

  return {
    cardBackground: "transparent",
    cardBorder: "#1f2937",
    label: "#cbd5e1",
    track: "#273142",
    value: "#f8fafc",
    unit: "#cbd5e1",
    caption: "#d8dee9",
    helper: "#94a3b8",
  };
}

function getLimitScale(limit: LimitRule): { min: number; max: number } {
  const range = Math.max(limit.upper - limit.lower, 1);

  return {
    min: 0,
    max: limit.upper + range,
  };
}

function getDefaultScale(sensor: SensorKey, value: number): { min: number; max: number } {
  if (sensor === "humidity") {
    return { min: 0, max: 100 };
  }

  return {
    min: 0,
    max: Math.max(100, Math.ceil(value * 1.25)),
  };
}

function getGaugeTone(value: number, lower: number, upper: number): GaugeTone {
  if (value > upper) return "danger";
  if (value < lower) return "warning";
  return "normal";
}

function getToneLabel(tone: GaugeTone): string {
  if (tone === "danger") return "เกิน limit";
  if (tone === "warning") return "ต่ำกว่า limit";
  return "ปกติ";
}

function getToneColor(tone: GaugeTone): string {
  if (tone === "danger") return "#ef4444";
  if (tone === "warning") return "#eab308";
  return "#22c55e";
}

function getToneTextColor(tone: GaugeTone): string {
  if (tone === "danger") return "#ef4444";
  if (tone === "warning") return "#eab308";
  return "#22c55e";
}

function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polarToCartesian(cx, cy, radius, startAngle);
  const end = polarToCartesian(cx, cy, radius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M",
    start.x,
    start.y,
    "A",
    radius,
    radius,
    0,
    largeArcFlag,
    1,
    end.x,
    end.y,
  ].join(" ");
}

function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleInDegrees: number,
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;

  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
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