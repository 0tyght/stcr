import { LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use, type ECharts, type EChartsCoreOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LimitMap, SensorKey, TimeSeriesPoint } from "../../types";
import { sensorByKey } from "../../utils/sensors";

use([
  LineChart,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

type ChartTheme = "dark" | "company" | "print";

type OverlayLine = {
  id: string;
  x1: number;
  x2: number;
  y: number;
  color: string;
  label: "Upper" | "Lower";
  labelX: number;
  labelY: number;
};

type SensorChartData = {
  actual: Array<[number, number | null]>;
  gaps: Array<[number, number | null]>;
};

const MIN_GAP_THRESHOLD_MS = 5 * 60 * 1000;
const MAX_GAP_THRESHOLD_MS = 30 * 60 * 1000;

export function TimeSeriesChart({
  points,
  sensors,
  limits,
  title,
  realtime,
  rightAxisSensors = ["humidity"],
  leftAxisName = "°C",
  rightAxisName = "%",
  limitSensors,
  theme,
  showDataZoom,
  timeRange,
}: {
  points: TimeSeriesPoint[];
  sensors: SensorKey[];
  limits: LimitMap;
  title: string;
  realtime?: boolean;
  rightAxisSensors?: SensorKey[];
  leftAxisName?: string;
  rightAxisName?: string;
  limitSensors?: SensorKey[];
  theme?: ChartTheme;
  showDataZoom?: boolean;
  timeRange?: { start: Date; end: Date };
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ECharts | null>(null);
  const updateOverlayRef = useRef<() => void>(() => undefined);

  const [pageTheme, setPageTheme] = useState<"dark" | "company">(() => getCurrentPageTheme());
  const [overlayBox, setOverlayBox] = useState({ width: 0, height: 0 });
  const [overlayLines, setOverlayLines] = useState<OverlayLine[]>([]);

  useEffect(() => {
    if (theme === "print") return;

    const root = document.documentElement;

    const updateTheme = () => {
      setPageTheme(getCurrentPageTheme());
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-ui-theme", "data-company"],
    });

    window.addEventListener("storage", updateTheme);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", updateTheme);
    };
  }, [theme]);

  const resolvedTheme: ChartTheme = theme === "print" ? "print" : theme ?? pageTheme;
  const effectiveShowDataZoom = showDataZoom ?? resolvedTheme !== "print";
  const palette = useMemo(() => getChartPalette(resolvedTheme), [resolvedTheme]);
  const axisDescription = useMemo(() => getAxisDescription(sensors), [sensors]);
  const gapThresholdMs = useMemo(() => getGapThresholdMs(points), [points]);
  const hasDataGaps = useMemo(
    () =>
      sensors.some(
        (sensor) => buildSensorChartData(points, sensor, gapThresholdMs).gaps.length > 0,
      ),
    [gapThresholdMs, points, sensors],
  );

  const option = useMemo<EChartsCoreOption>(() => {
    const leftSensors = sensors.filter((sensor) => !rightAxisSensors.includes(sensor));
    const rightSensors = sensors.filter((sensor) => rightAxisSensors.includes(sensor));
    const shownLimitSensors = limitSensors ?? sensors;

    const leftBounds = getAxisBounds(points, leftSensors, limits, shownLimitSensors);
    const rightBounds = getAxisBounds(points, rightSensors, limits, []);

    const series = sensors.flatMap((sensor) => {
      const definition = sensorByKey[sensor];
      const useRightAxis = rightAxisSensors.includes(sensor);
      const chartData = buildSensorChartData(points, sensor, gapThresholdMs);

      return [
        {
          name: definition.shortLabel,
          type: "line" as const,
          showSymbol: false,
          smooth: true,
          connectNulls: false,
          hoverAnimation: false,
          yAxisIndex: useRightAxis ? 1 : 0,
          data: chartData.actual,
          lineStyle: {
            width: 2.2,
            color: definition.color,
            opacity: 1,
          },
          areaStyle: {
            color: withAlpha(definition.color, palette.areaAlpha),
            opacity: 1,
          },
          itemStyle: {
            color: definition.color,
          },
          emphasis: {
            disabled: true,
          },
        },
        {
          name: definition.shortLabel,
          type: "line" as const,
          showSymbol: false,
          smooth: false,
          connectNulls: false,
          silent: true,
          hoverAnimation: false,
          yAxisIndex: useRightAxis ? 1 : 0,
          data: chartData.gaps,
          lineStyle: {
            width: 2.2,
            type: "solid" as const,
            color: definition.color,
            opacity: 1,
          },
          itemStyle: {
            color: definition.color,
          },
          tooltip: {
            show: false,
          },
          emphasis: {
            disabled: true,
          },
          z: 3,
        },
      ];
    });

    return {
      animation: false,
      backgroundColor: palette.background,
      color: sensors.map((sensor) => sensorByKey[sensor].color),

      tooltip: {
        trigger: "axis",
        triggerOn: "mousemove|click",
        transitionDuration: 0,
        confine: true,
        axisPointer: {
          type: "cross",
          animation: false,
          lineStyle: {
            color: palette.axis,
            width: 1,
            opacity: palette.axisPointerOpacity,
          },
          crossStyle: {
            color: palette.axis,
          },
          label: {
            backgroundColor: palette.tooltipBackground,
            borderColor: palette.tooltipBorder,
            borderWidth: 1,
            color: palette.text,
          },
        },
        backgroundColor: palette.tooltipBackground,
        borderColor: palette.tooltipBorder,
        borderWidth: 1,
        textStyle: {
          color: palette.text,
        },
        valueFormatter: (value: unknown) =>
          typeof value === "number" ? value.toFixed(1) : String(value),
      },

      legend: {
        top: 8,
        type: "scroll",
        data: sensors.map((sensor) => sensorByKey[sensor].shortLabel),
        selectedMode: true,
        textStyle: {
          color: palette.muted,
        },
      },

      grid: {
        left: 78,
        right: rightSensors.length ? 64 : 54,
        top: 54,
        bottom: realtime || !effectiveShowDataZoom ? 38 : 72,
        containLabel: false,
      },

      xAxis: {
        type: "time",
        min: timeRange?.start.getTime(),
        max: timeRange?.end.getTime(),
        axisLabel: {
          color: palette.muted,
          formatter: (value: number) => formatShortDateTime(new Date(value)),
        },
        axisLine: {
          lineStyle: {
            color: palette.axis,
            width: 1,
          },
        },
        axisTick: {
          lineStyle: {
            color: palette.axis,
            width: 1,
          },
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: palette.grid,
            width: 1,
            opacity: palette.gridOpacity,
          },
        },
      },

      yAxis: [
        {
          type: "value",
          name: axisDescription,
          nameLocation: "middle",
          nameGap: 54,
          nameRotate: 90,
          min: leftBounds.min,
          max: leftBounds.max,
          nameTextStyle: {
            color: palette.text,
            fontSize: 12,
            fontWeight: 700,
          },
          axisLabel: {
            color: palette.muted,
          },
          axisLine: {
            lineStyle: {
              color: palette.axis,
              width: 1,
            },
          },
          axisTick: {
            lineStyle: {
              color: palette.axis,
              width: 1,
            },
          },
          splitLine: {
            lineStyle: {
              color: palette.grid,
              width: 1,
              opacity: palette.gridOpacity,
            },
          },
        },
        {
          type: "value",
          name: "",
          min: rightBounds.min,
          max: rightBounds.max,
          show: rightSensors.length > 0,
          axisLabel: {
            color: palette.muted,
          },
          axisLine: {
            lineStyle: {
              color: palette.axis,
              width: 1,
            },
          },
          axisTick: {
            lineStyle: {
              color: palette.axis,
              width: 1,
            },
          },
          splitLine: {
            show: false,
          },
        },
      ],

      dataZoom:
        realtime || !effectiveShowDataZoom
          ? []
          : [
              {
                type: "inside",
                throttle: 80,
              },
              {
                type: "slider",
                height: 24,
                bottom: 22,
                borderColor: palette.zoomBorder,
                fillerColor: palette.zoomFiller,
                backgroundColor: palette.zoomBackground,
                dataBackground: {
                  lineStyle: {
                    color: palette.axis,
                  },
                  areaStyle: {
                    color: palette.zoomArea,
                  },
                },
                selectedDataBackground: {
                  lineStyle: {
                    color: palette.axis,
                  },
                  areaStyle: {
                    color: palette.zoomFiller,
                  },
                },
                textStyle: {
                  color: palette.muted,
                },
              },
            ],

      series,
    };
  }, [
    axisDescription,
    effectiveShowDataZoom,
    gapThresholdMs,
    limitSensors,
    limits,
    palette,
    points,
    realtime,
    rightAxisSensors,
    sensors,
    timeRange,
  ]);

  const updateOverlayLines = useCallback(() => {
    const chart = instanceRef.current;
    const element = chartRef.current;

    if (!chart || !element) {
      setOverlayLines([]);
      return;
    }

    const rect = element.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      setOverlayLines([]);
      return;
    }

    const rightSensors = sensors.filter((sensor) => rightAxisSensors.includes(sensor));
    const shownLimitSensors = limitSensors ?? sensors;
    const legendSelected = getLegendSelectedMap(chart);

    const x1 = 78;
    const x2 = rect.width - (rightSensors.length ? 64 : 54);

    if (x2 <= x1) {
      setOverlayLines([]);
      return;
    }

    const lines: OverlayLine[] = [];

    shownLimitSensors.forEach((sensor) => {
      if (!isSensorVisible(sensor, legendSelected)) return;

      const limit = limits[sensor];
      const definition = sensorByKey[sensor];
      const yAxisIndex = rightAxisSensors.includes(sensor) ? 1 : 0;

      const upperY = Number(chart.convertToPixel({ yAxisIndex }, limit.upper));
      const lowerY = Number(chart.convertToPixel({ yAxisIndex }, limit.lower));

      if (Number.isFinite(upperY)) {
        lines.push(createOverlayLine(sensor, "Upper", upperY, x1, x2, definition.color));
      }

      if (Number.isFinite(lowerY)) {
        lines.push(createOverlayLine(sensor, "Lower", lowerY, x1, x2, definition.color));
      }
    });

    setOverlayBox({
      width: rect.width,
      height: rect.height,
    });

    setOverlayLines(lines);
  }, [limitSensors, limits, rightAxisSensors, sensors]);

  useEffect(() => {
    updateOverlayRef.current = updateOverlayLines;
  }, [updateOverlayLines]);

  useEffect(() => {
    if (!chartRef.current) return;

    instanceRef.current?.dispose();
    instanceRef.current = init(chartRef.current);

    const handleChartStateChange = () => {
      window.requestAnimationFrame(() => {
        updateOverlayRef.current();
      });
    };

    instanceRef.current.on("legendselectchanged", handleChartStateChange);
    instanceRef.current.on("datazoom", handleChartStateChange);
    instanceRef.current.on("finished", handleChartStateChange);

    const resizeObserver = new ResizeObserver(() => {
      instanceRef.current?.resize();
      handleChartStateChange();
    });

    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();

      instanceRef.current?.off("legendselectchanged", handleChartStateChange);
      instanceRef.current?.off("datazoom", handleChartStateChange);
      instanceRef.current?.off("finished", handleChartStateChange);

      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, [resolvedTheme]);

  useEffect(() => {
    if (!instanceRef.current) return;

    instanceRef.current.setOption(option, true);
    instanceRef.current.resize();

    window.requestAnimationFrame(() => {
      updateOverlayRef.current();
    });
  }, [option]);

  return (
    <div
      className="time-series-chart-wrap"
      style={{
        position: "relative",
      }}
    >
      {hasDataGaps && resolvedTheme !== "print" ? (
        <div className="chart-gap-note" role="note">
          <span aria-hidden="true" />
          ช่วงที่ไม่มีข้อมูลจริงจะแสดงเฉพาะเส้นเชื่อม
        </div>
      ) : null}
      <div className="time-series-chart" ref={chartRef} role="img" aria-label={title} />

      {overlayLines.length ? (
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${overlayBox.width} ${overlayBox.height}`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          <style>
            {`
              @keyframes stcrDashMove {
                from {
                  stroke-dashoffset: 0;
                }
                to {
                  stroke-dashoffset: -30;
                }
              }
            `}
          </style>

          {overlayLines.map((line) => (
            <g key={line.id}>
              <line
                x1={line.x1}
                x2={line.x2}
                y1={line.y}
                y2={line.y}
                stroke={line.color}
                strokeWidth="1"
                strokeDasharray="8 7"
                opacity={palette.markLineOpacity}
                style={{
                  animation: "stcrDashMove 3s linear infinite",
                }}
              />

              <rect
                x={line.labelX - 6}
                y={line.labelY - 14}
                width="54"
                height="20"
                rx="2"
                fill={palette.markLabelBackground}
                stroke={palette.markLabelBorder}
                strokeWidth="1"
                opacity="0.98"
              />

              <text
                x={line.labelX}
                y={line.labelY}
                fill={line.color}
                fontSize="11"
                fontWeight="800"
              >
                {line.label}
              </text>
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  );
}

function createOverlayLine(
  sensor: SensorKey,
  label: "Upper" | "Lower",
  y: number,
  x1: number,
  x2: number,
  color: string,
): OverlayLine {
  const safeY = Math.max(18, y);
  const labelX = Math.max(x1 + 8, x2 - 48);
  const labelY = Math.max(18, safeY - 8);

  return {
    id: `${sensor}-${label}`,
    x1,
    x2,
    y: safeY,
    color,
    label,
    labelX,
    labelY,
  };
}

function getLegendSelectedMap(chart: ECharts): Record<string, boolean> {
  const option = chart.getOption() as {
    legend?: Array<{
      selected?: Record<string, boolean>;
    }>;
  };

  return option.legend?.[0]?.selected ?? {};
}

function isSensorVisible(sensor: SensorKey, selected: Record<string, boolean>): boolean {
  const legendName = sensorByKey[sensor].shortLabel;
  return selected[legendName] !== false;
}

function getCurrentPageTheme(): "dark" | "company" {
  const rootTheme = document.documentElement.dataset.uiTheme;

  if (rootTheme === "company") {
    return "company";
  }

  const savedTheme = localStorage.getItem("stcr-theme-mode");

  return savedTheme === "company" ? "company" : "dark";
}

function getAxisDescription(sensors: SensorKey[]): string {
  const hasChamber = sensors.includes("chamberTemp");
  const hasHumidity = sensors.includes("humidity");
  const hasFurnace = sensors.includes("furnaceTemp");
  const hasBlower = sensors.includes("blowerTemp");

  if (hasChamber && hasHumidity) {
    return "อุณหภูมิ (°C) และ ความชื้น (%)";
  }

  if (hasFurnace && hasBlower) {
    return "อุณหภูมิเตาเผา (°C) และ อุณหภูมิ Blower (°C)";
  }

  if (hasChamber) {
    return "อุณหภูมิห้องอบ (°C)";
  }

  if (hasHumidity) {
    return "ความชื้น (%)";
  }

  if (hasFurnace) {
    return "อุณหภูมิเตาเผา (°C)";
  }

  if (hasBlower) {
    return "อุณหภูมิ Blower (°C)";
  }

  return "ค่าเซ็นเซอร์";
}

function getChartPalette(theme: ChartTheme) {
  if (theme === "print") {
    return {
      background: "#ffffff",
      text: "#111827",
      muted: "#4b5563",
      grid: "#d1d5db",
      gridOpacity: 1,
      axis: "#6b7280",
      axisPointerOpacity: 0.75,
      tooltipBackground: "#ffffff",
      tooltipBorder: "#d1d5db",
      markLabelBackground: "rgba(255, 255, 255, 0.94)",
      markLabelBorder: "#d1d5db",
      markLineOpacity: 0.86,
      areaAlpha: 0.07,
      zoomBackground: "#f9fafb",
      zoomBorder: "#d1d5db",
      zoomFiller: "rgba(148, 163, 184, 0.22)",
      zoomArea: "rgba(148, 163, 184, 0.14)",
    };
  }

  if (theme === "company") {
    return {
      background: "#ffffff",
      text: "#334155",
      muted: "#64748b",
      grid: "#e2e8f0",
      gridOpacity: 0.85,
      axis: "#cbd5e1",
      axisPointerOpacity: 0.7,
      tooltipBackground: "#ffffff",
      tooltipBorder: "#d8dde5",
      markLabelBackground: "rgba(255, 255, 255, 0.94)",
      markLabelBorder: "#d8dde5",
      markLineOpacity: 0.85,
      areaAlpha: 0.08,
      zoomBackground: "#f8fafc",
      zoomBorder: "#e2e8f0",
      zoomFiller: "rgba(148, 163, 184, 0.18)",
      zoomArea: "rgba(148, 163, 184, 0.14)",
    };
  }

  return {
    background: "transparent",
    text: "#d8dce3",
    muted: "#9aa3b2",
    grid: "#2a3038",
    gridOpacity: 1,
    axis: "#3a424f",
    axisPointerOpacity: 0.58,
    tooltipBackground: "#111820",
    tooltipBorder: "#3a424f",
    markLabelBackground: "rgba(8, 13, 20, 0.92)",
    markLabelBorder: "rgba(255, 255, 255, 0.16)",
    markLineOpacity: 0.72,
    areaAlpha: 0.06,
    zoomBackground: "#111820",
    zoomBorder: "#2a3038",
    zoomFiller: "rgba(87, 148, 242, 0.18)",
    zoomArea: "rgba(154, 163, 178, 0.12)",
  };
}

function formatShortDateTime(value: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");

  if (normalized.length !== 6) return hex;

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getGapThresholdMs(points: TimeSeriesPoint[]): number {
  const timestamps = points
    .map((point) => Date.parse(point.timestamp))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const intervals = timestamps
    .slice(1)
    .map((timestamp, index) => timestamp - timestamps[index])
    .filter((interval) => interval > 0 && interval <= 60 * 60 * 1000)
    .sort((left, right) => left - right);

  if (!intervals.length) return MIN_GAP_THRESHOLD_MS;

  const middle = Math.floor(intervals.length / 2);
  const median =
    intervals.length % 2
      ? intervals[middle]
      : (intervals[middle - 1] + intervals[middle]) / 2;

  return Math.min(
    MAX_GAP_THRESHOLD_MS,
    Math.max(MIN_GAP_THRESHOLD_MS, median * 3),
  );
}

function buildSensorChartData(
  points: TimeSeriesPoint[],
  sensor: SensorKey,
  gapThresholdMs: number,
): SensorChartData {
  const actual: SensorChartData["actual"] = [];
  const gaps: SensorChartData["gaps"] = [];
  let previous: { timestamp: number; value: number } | null = null;
  let missingSincePrevious = false;

  for (const point of points) {
    const timestamp = Date.parse(point.timestamp);
    const rawValue = point[sensor] as number | null | undefined;
    const value = rawValue == null ? Number.NaN : Number(rawValue);

    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
      if (Number.isFinite(timestamp)) actual.push([timestamp, null]);
      missingSincePrevious = true;
      continue;
    }

    const hasGap =
      previous !== null &&
      (missingSincePrevious || timestamp - previous.timestamp > gapThresholdMs);

    if (hasGap && previous) {
      const breakAt = previous.timestamp + (timestamp - previous.timestamp) / 2;
      actual.push([breakAt, null]);
      gaps.push(
        [previous.timestamp, previous.value],
        [timestamp, value],
        [timestamp + 1, null],
      );
    }

    actual.push([timestamp, value]);
    previous = { timestamp, value };
    missingSincePrevious = false;
  }

  return { actual, gaps };
}

function getAxisBounds(
  points: TimeSeriesPoint[],
  sensors: SensorKey[],
  limits: LimitMap,
  limitSensors: SensorKey[],
): { min: number; max: number } {
  if (sensors.length === 1 && sensors[0] === "humidity") {
    return { min: 40, max: 90 };
  }

  if (!sensors.length && !limitSensors.length) {
    return { min: 0, max: 100 };
  }

  const values = [
    ...sensors.flatMap((sensor) => points.map((point) => point[sensor])),
    ...limitSensors.flatMap((sensor) => [limits[sensor].lower, limits[sensor].upper]),
  ];

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = Math.max(maxValue - minValue, 1);
  const pad = spread * 0.08;

  return {
    min: Math.max(0, Math.floor(minValue - pad)),
    max: Math.ceil(maxValue + pad),
  };
}
