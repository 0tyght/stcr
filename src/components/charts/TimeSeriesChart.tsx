import { LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { init, use, type ECharts, type EChartsCoreOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef } from "react";
import type { LimitMap, SensorKey, TimeSeriesPoint } from "../../types";
import { sensorByKey } from "../../utils/sensors";

use([
  LineChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

type ChartTheme = "dark" | "company" | "print";

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
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ECharts | null>(null);

  const resolvedTheme = useMemo<ChartTheme>(() => {
    if (theme) return theme;

    const rootTheme = document.documentElement.dataset.uiTheme;
    if (rootTheme === "company") return "company";

    const savedTheme = localStorage.getItem("stcr-theme-mode");
    return savedTheme === "company" ? "company" : "dark";
  }, [theme]);

  const effectiveShowDataZoom = showDataZoom ?? resolvedTheme !== "print";

  const option = useMemo<EChartsCoreOption>(() => {
    const leftSensors = sensors.filter((sensor) => !rightAxisSensors.includes(sensor));
    const rightSensors = sensors.filter((sensor) => rightAxisSensors.includes(sensor));
    const shownLimitSensors = limitSensors ?? sensors;

    const leftBounds = getAxisBounds(points, leftSensors, limits, shownLimitSensors);
    const rightBounds = getAxisBounds(points, rightSensors, limits, []);

    const isPrint = resolvedTheme === "print";
    const isCompany = resolvedTheme === "company";

    const textColor = isPrint
      ? "#111827"
      : isCompany
        ? "#334155"
        : "#d8dce3";

    const mutedColor = isPrint
      ? "#4b5563"
      : isCompany
        ? "#64748b"
        : "#9aa3b2";

    const gridColor = isPrint
      ? "#d1d5db"
      : isCompany
        ? "#e2e8f0"
        : "#2a3038";

    const axisColor = isPrint
      ? "#6b7280"
      : isCompany
        ? "#cbd5e1"
        : "#3a424f";

    const chartBackground = isPrint
      ? "#ffffff"
      : isCompany
        ? "#ffffff"
        : "transparent";

    const tooltipBackground = isPrint
      ? "#ffffff"
      : isCompany
        ? "#ffffff"
        : "#111820";

    const tooltipBorder = isPrint
      ? "#d1d5db"
      : isCompany
        ? "#d8dde5"
        : axisColor;

    const sliderFill = isCompany
      ? "rgba(148, 163, 184, 0.18)"
      : "rgba(87, 148, 242, 0.18)";

    const sliderBackground = isPrint
      ? "#f9fafb"
      : isCompany
        ? "#f8fafc"
        : "#111820";

    const lineSeries = sensors.map((sensor) => {
      const definition = sensorByKey[sensor];
      const useRightAxis = rightAxisSensors.includes(sensor);
      const showLimit = shownLimitSensors.includes(sensor);
      const limit = limits[sensor];

      return {
        name: definition.shortLabel,
        type: "line" as const,
        showSymbol: false,
        smooth: true,
        yAxisIndex: useRightAxis ? 1 : 0,
        data: points.map((point) => [point.timestamp, point[sensor]]),
        lineStyle: {
          width: 2.2,
          color: definition.color,
          opacity: 1,
        },
        areaStyle: {
          color: withAlpha(definition.color, isCompany ? 0.08 : 0.06),
          opacity: 1,
        },
        itemStyle: {
          color: definition.color,
        },
        emphasis: {
          focus: "series" as const,
        },
        markLine: showLimit
          ? {
              symbol: "none" as const,
              silent: true,
              lineStyle: {
                type: "dashed" as const,
                width: 1,
                color: definition.color,
                opacity: isCompany ? 0.85 : 0.62,
              },
              label: {
                show: true,
                position: "insideEndTop",
                formatter: "{b}",
                color: definition.color,
                fontSize: 11,
                fontWeight: 700,
                backgroundColor: isPrint || isCompany
                  ? "rgba(255,255,255,0.88)"
                  : "rgba(17,24,39,0.76)",
                padding: [2, 4],
              },
              data: [
                { name: `${definition.shortLabel} Upper`, yAxis: limit.upper },
                { name: `${definition.shortLabel} Lower`, yAxis: limit.lower },
              ],
            }
          : undefined,
      };
    });

    return {
      animation: false,
      backgroundColor: chartBackground,
      color: sensors.map((sensor) => sensorByKey[sensor].color),

      title: {
        text: title,
        left: 8,
        top: 0,
        textStyle: {
          fontSize: 15,
          fontWeight: 700,
          color: textColor,
        },
      },

      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          lineStyle: {
            color: axisColor,
            width: 1,
            opacity: isCompany ? 0.7 : 0.5,
          },
          crossStyle: {
            color: axisColor,
          },
          label: {
            backgroundColor: tooltipBackground,
            color: textColor,
            borderColor: tooltipBorder,
            borderWidth: 1,
          },
        },
        backgroundColor: tooltipBackground,
        borderColor: tooltipBorder,
        borderWidth: 1,
        textStyle: { color: textColor },
        valueFormatter: (value: unknown) =>
          typeof value === "number" ? value.toFixed(1) : String(value),
      },

      legend: {
        top: 28,
        type: "scroll",
        textStyle: { color: mutedColor },
      },

      grid: {
        left: 54,
        right: rightSensors.length ? 64 : 54,
        top: 74,
        bottom: realtime || !effectiveShowDataZoom ? 38 : 72,
        containLabel: false,
      },

      xAxis: {
        type: "time",
        axisLabel: {
          color: mutedColor,
          formatter: (value: number) => formatShortDateTime(new Date(value)),
        },
        axisLine: { lineStyle: { color: axisColor, width: 1 } },
        axisTick: { lineStyle: { color: axisColor, width: 1 } },
        splitLine: {
          show: true,
          lineStyle: {
            color: gridColor,
            width: 1,
            opacity: isCompany ? 0.85 : 1,
          },
        },
      },

      yAxis: [
        {
          type: "value",
          name: leftAxisName,
          min: leftBounds.min,
          max: leftBounds.max,
          nameTextStyle: { color: mutedColor },
          axisLabel: { color: mutedColor },
          axisLine: { lineStyle: { color: axisColor, width: 1 } },
          axisTick: { lineStyle: { color: axisColor, width: 1 } },
          splitLine: {
            lineStyle: {
              color: gridColor,
              width: 1,
              opacity: isCompany ? 0.85 : 1,
            },
          },
        },
        {
          type: "value",
          name: rightAxisName,
          min: rightBounds.min,
          max: rightBounds.max,
          show: rightSensors.length > 0,
          nameTextStyle: { color: mutedColor },
          axisLabel: { color: mutedColor },
          axisLine: { lineStyle: { color: axisColor, width: 1 } },
          axisTick: { lineStyle: { color: axisColor, width: 1 } },
          splitLine: { show: false },
        },
      ],

      dataZoom:
        realtime || !effectiveShowDataZoom
          ? []
          : [
              { type: "inside", throttle: 80 },
              {
                type: "slider",
                height: 24,
                bottom: 22,
                borderColor: gridColor,
                fillerColor: sliderFill,
                backgroundColor: sliderBackground,
                textStyle: { color: mutedColor },
              },
            ],

      series: lineSeries,
    };
  }, [
    effectiveShowDataZoom,
    leftAxisName,
    limitSensors,
    limits,
    points,
    realtime,
    resolvedTheme,
    rightAxisName,
    rightAxisSensors,
    sensors,
    title,
  ]);

  useEffect(() => {
    if (!chartRef.current) return;

    instanceRef.current?.dispose();
    instanceRef.current = init(chartRef.current);

    const resizeObserver = new ResizeObserver(() => {
      instanceRef.current?.resize();
    });

    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, [resolvedTheme]);

  useEffect(() => {
    if (!instanceRef.current) return;
    instanceRef.current.clear();
    instanceRef.current.setOption(option, true);
    instanceRef.current.resize();
  }, [option]);

  return <div className="time-series-chart" ref={chartRef} role="img" aria-label={title} />;
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

function getAxisBounds(
  points: TimeSeriesPoint[],
  sensors: SensorKey[],
  limits: LimitMap,
  limitSensors: SensorKey[],
): { min: number; max: number } {
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