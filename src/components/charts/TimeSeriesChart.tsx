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
import { useEffect, useMemo, useRef, useState } from "react";
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

  const [pageTheme, setPageTheme] = useState<"dark" | "company">(() => getCurrentPageTheme());

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

  const option = useMemo<EChartsCoreOption>(() => {
    const leftSensors = sensors.filter((sensor) => !rightAxisSensors.includes(sensor));
    const rightSensors = sensors.filter((sensor) => rightAxisSensors.includes(sensor));
    const shownLimitSensors = limitSensors ?? sensors;

    const leftBounds = getAxisBounds(points, leftSensors, limits, shownLimitSensors);
    const rightBounds = getAxisBounds(points, rightSensors, limits, []);

    const palette = getChartPalette(resolvedTheme);

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
                opacity: palette.markLineOpacity,
              },
              label: {
                show: true,
                position: "insideEndTop",
                formatter: "{b}",
                color: definition.color,
                fontSize: 11,
                fontWeight: 800,
                backgroundColor: palette.markLabelBackground,
                borderColor: palette.markLabelBorder,
                borderWidth: 1,
                borderRadius: 2,
                padding: [3, 6],
                shadowColor: palette.markLabelShadow,
                shadowBlur: palette.markLabelShadowBlur,
              },
              data: [
                { name: "Upper", yAxis: limit.upper },
                { name: "Lower", yAxis: limit.lower },
              ],
            }
          : undefined,
      };
    });

    return {
      animation: false,
      backgroundColor: palette.background,
      color: sensors.map((sensor) => sensorByKey[sensor].color),

      title: {
        text: title,
        left: 8,
        top: 0,
        textStyle: {
          fontSize: 15,
          fontWeight: 700,
          color: palette.text,
        },
      },

      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
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
        top: 28,
        type: "scroll",
        textStyle: {
          color: palette.muted,
        },
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
          name: leftAxisName,
          min: leftBounds.min,
          max: leftBounds.max,
          nameTextStyle: {
            color: palette.muted,
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
          name: rightAxisName,
          min: rightBounds.min,
          max: rightBounds.max,
          show: rightSensors.length > 0,
          nameTextStyle: {
            color: palette.muted,
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

function getCurrentPageTheme(): "dark" | "company" {
  const rootTheme = document.documentElement.dataset.uiTheme;

  if (rootTheme === "company") {
    return "company";
  }

  const savedTheme = localStorage.getItem("stcr-theme-mode");

  return savedTheme === "company" ? "company" : "dark";
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
      markLabelShadow: "rgba(15, 23, 42, 0.12)",
      markLabelShadowBlur: 4,
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
      markLabelShadow: "rgba(15, 23, 42, 0.12)",
      markLabelShadowBlur: 4,
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
    markLabelShadow: "rgba(0, 0, 0, 0.5)",
    markLabelShadowBlur: 5,
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