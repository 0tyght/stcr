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
  theme = "dark",
  showDataZoom = theme !== "print",
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
  theme?: "dark" | "print";
  showDataZoom?: boolean;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ECharts | null>(null);

  const option = useMemo<EChartsCoreOption>(() => {
    const leftSensors = sensors.filter((sensor) => !rightAxisSensors.includes(sensor));
    const rightSensors = sensors.filter((sensor) => rightAxisSensors.includes(sensor));
    const shownLimitSensors = limitSensors ?? sensors;
    const leftBounds = getAxisBounds(points, leftSensors, limits, shownLimitSensors);
    const rightBounds = getAxisBounds(points, rightSensors, limits, []);
    const isPrint = theme === "print";
    const textColor = isPrint ? "#111827" : "#d8dce3";
    const mutedColor = isPrint ? "#4b5563" : "#9aa3b2";
    const gridColor = isPrint ? "#d1d5db" : "#2a3038";
    const axisColor = isPrint ? "#6b7280" : "#3a424f";

    const series = sensors.map((sensor) => {
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
          width: 2,
          color: definition.color,
        },
        areaStyle: {
          color: withAlpha(definition.color, 0.06),
          opacity: 1,
        },
        itemStyle: {
          color: definition.color,
        },
        markLine: showLimit
          ? {
              symbol: "none" as const,
              silent: true,
              lineStyle: {
                type: "dashed" as const,
                width: 1,
                color: definition.color,
                opacity: 0.62,
              },
              label: {
                show: true,
                position: "insideEndTop",
                formatter: "{b}",
                color: definition.color,
                fontSize: 11,
                fontWeight: 700,
                backgroundColor: isPrint ? "rgba(255,255,255,0.82)" : "rgba(17, 24, 39, 0.76)",
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
      backgroundColor: isPrint ? "#ffffff" : "transparent",
      color: sensors.map((sensor) => sensorByKey[sensor].color),
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: isPrint ? "#ffffff" : "#111820",
        borderColor: axisColor,
        textStyle: { color: textColor },
        valueFormatter: (value: unknown) => (typeof value === "number" ? value.toFixed(1) : String(value)),
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
        bottom: realtime || !showDataZoom ? 38 : 72,
      },
      xAxis: {
        type: "time",
        axisLabel: {
          color: mutedColor,
          formatter: (value: number) => formatShortDateTime(new Date(value)),
        },
        axisLine: { lineStyle: { color: axisColor } },
        axisTick: { lineStyle: { color: axisColor } },
        splitLine: {
          show: true,
          lineStyle: { color: gridColor },
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
          axisLine: { lineStyle: { color: axisColor } },
          axisTick: { lineStyle: { color: axisColor } },
          splitLine: { lineStyle: { color: gridColor } },
        },
        {
          type: "value",
          name: rightAxisName,
          min: rightBounds.min,
          max: rightBounds.max,
          show: rightSensors.length > 0,
          nameTextStyle: { color: mutedColor },
          axisLabel: { color: mutedColor },
          axisLine: { lineStyle: { color: axisColor } },
          axisTick: { lineStyle: { color: axisColor } },
          splitLine: { show: false },
        },
      ],
      dataZoom: realtime || !showDataZoom
        ? []
        : [
            { type: "inside", throttle: 80 },
            {
              type: "slider",
              height: 24,
              bottom: 22,
              borderColor: gridColor,
              fillerColor: "rgba(87, 148, 242, 0.18)",
              backgroundColor: isPrint ? "#f9fafb" : "#111820",
              textStyle: { color: mutedColor },
            },
          ],
      series,
    };
  }, [leftAxisName, limitSensors, limits, points, realtime, rightAxisName, rightAxisSensors, sensors, showDataZoom, theme, title]);

  useEffect(() => {
    if (!chartRef.current) return;
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
  }, []);

  useEffect(() => {
    instanceRef.current?.setOption(option, true);
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
