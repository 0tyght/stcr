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
import { formatDateTime } from "../../utils/format";
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
}: {
  points: TimeSeriesPoint[];
  sensors: SensorKey[];
  limits: LimitMap;
  title: string;
  realtime?: boolean;
  rightAxisSensors?: SensorKey[];
  leftAxisName?: string;
  rightAxisName?: string;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ECharts | null>(null);

  const option = useMemo<EChartsCoreOption>(() => {
    const leftSensors = sensors.filter((sensor) => !rightAxisSensors.includes(sensor));
    const rightSensors = sensors.filter((sensor) => rightAxisSensors.includes(sensor));
    const leftBounds = getAxisBounds(points, leftSensors, limits);
    const rightBounds = getAxisBounds(points, rightSensors, limits);

    const series = sensors.map((sensor) => {
      const definition = sensorByKey[sensor];
      const limit = limits[sensor];
      const useRightAxis = rightAxisSensors.includes(sensor);

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
          color: withAlpha(definition.color, 0.07),
          opacity: 1,
        },
        itemStyle: {
          color: definition.color,
        },
        markLine: {
          symbol: "none" as const,
          silent: true,
          lineStyle: {
            type: "dashed" as const,
            width: 1,
            color: definition.color,
            opacity: 0.55,
          },
          label: {
            show: false,
          },
          data: [
            { name: `${definition.shortLabel} Upper`, yAxis: limit.upper },
            { name: `${definition.shortLabel} Lower`, yAxis: limit.lower },
          ],
        },
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
          color: "#d8dce3",
        },
      },
      backgroundColor: "transparent",
      color: sensors.map((sensor) => sensorByKey[sensor].color),
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "#111820",
        borderColor: "#3a424f",
        textStyle: { color: "#d8dce3" },
        valueFormatter: (value: unknown) => (typeof value === "number" ? value.toFixed(1) : String(value)),
      },
      legend: {
        top: 28,
        type: "scroll",
        textStyle: { color: "#9aa3b2" },
      },
      grid: {
        left: 54,
        right: 64,
        top: 74,
        bottom: realtime ? 38 : 72,
      },
      xAxis: {
        type: "time",
        axisLabel: {
          color: "#9aa3b2",
          formatter: (value: number) => formatDateTime(new Date(value)),
        },
        axisLine: { lineStyle: { color: "#3a424f" } },
        axisTick: { lineStyle: { color: "#3a424f" } },
        splitLine: {
          show: true,
          lineStyle: { color: "#2a3038" },
        },
      },
      yAxis: [
        {
          type: "value",
          name: leftAxisName,
          min: leftBounds.min,
          max: leftBounds.max,
          nameTextStyle: { color: "#9aa3b2" },
          axisLabel: { color: "#9aa3b2" },
          axisLine: { lineStyle: { color: "#3a424f" } },
          axisTick: { lineStyle: { color: "#3a424f" } },
          splitLine: { lineStyle: { color: "#2a3038" } },
        },
        {
          type: "value",
          name: rightAxisName,
          min: rightBounds.min,
          max: rightBounds.max,
          nameTextStyle: { color: "#9aa3b2" },
          axisLabel: { color: "#9aa3b2" },
          axisLine: { lineStyle: { color: "#3a424f" } },
          axisTick: { lineStyle: { color: "#3a424f" } },
          splitLine: { show: false },
        },
      ],
      dataZoom: realtime
        ? []
        : [
            { type: "inside", throttle: 80 },
            {
              type: "slider",
              height: 24,
              bottom: 22,
              borderColor: "#2a3038",
              fillerColor: "rgba(87, 148, 242, 0.18)",
              backgroundColor: "#111820",
              textStyle: { color: "#9aa3b2" },
            },
          ],
      series,
    };
  }, [leftAxisName, limits, points, realtime, rightAxisName, rightAxisSensors, sensors, title]);

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

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return hex;

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getAxisBounds(points: TimeSeriesPoint[], sensors: SensorKey[], limits: LimitMap): { min: number; max: number } {
  if (!sensors.length) {
    return { min: 0, max: 100 };
  }

  const values = sensors.flatMap((sensor) => [
    ...points.map((point) => point[sensor]),
    limits[sensor].lower,
    limits[sensor].upper,
  ]);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const spread = Math.max(maxValue - minValue, 1);
  const pad = spread * 0.08;

  return {
    min: Math.max(0, Math.floor(minValue - pad)),
    max: Math.ceil(maxValue + pad),
  };
}
