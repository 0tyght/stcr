import {
  CalendarClock,
  Download,
  FileDown,
  History,
  Pause,
  Play,
  RefreshCw,
  Thermometer,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useAppData } from "../app/providers";
import { ThresholdLegend } from "../components/charts/ThresholdLegend";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";
import { SensorGauge } from "../components/ui/SensorGauge";
import { StatusBadge } from "../components/ui/StatusBadge";
import { apiClient } from "../services/apiClient";
import { downloadCsv } from "../services/reportExport";
import type { LimitMap, Oven, OvenStatus, SensorKey, TimeSeriesPoint } from "../types";
import { formatDateTime } from "../utils/format";
import { getReadingState } from "../utils/limits";
import { clampCycleStart, REPORT_CYCLE_MS } from "../utils/reportCycle";
import { allSensorKeys } from "../utils/sensors";

type ChartMode = "realtime" | "historical";

const environmentSensors: SensorKey[] = ["chamberTemp", "humidity"];
const heatSensors: SensorKey[] = ["furnaceTemp", "blowerTemp"];

const realtimeGaugeOrder: SensorKey[] = [
  "furnaceTemp",
  "blowerTemp",
  "chamberTemp",
  "humidity",
];

export function OvenDetailPage() {
  const { ovenId = "" } = useParams();
  const { ovens, alarms, loading, refresh } = useAppData();

  const oven = ovens.find((item) => item.id === ovenId);

  const [mode, setMode] = useState<ChartMode>("realtime");
  const [selectedCycle, setSelectedCycle] = useState<number | null>(null);
  const [points, setPoints] = useState<TimeSeriesPoint[]>([]);

  const realtimeAvailable = oven ? canUseRealtime(oven.status) : false;

  const cycleOptions = useMemo(() => {
    if (!oven) return [];

    const latest = Math.max(oven.cycleCount, 1);
    const count = Math.min(latest, 12);

    return Array.from({ length: count }, (_, index) => latest - index);
  }, [oven]);

  useEffect(() => {
    if (!oven) return;

    setMode(canUseRealtime(oven.status) ? "realtime" : "historical");
    setSelectedCycle(getDefaultHistoricalCycle(oven));
  }, [oven?.id, oven?.cycleCount, oven?.status]);

  useEffect(() => {
    if (!oven) return;

    if (!realtimeAvailable && mode === "realtime") {
      setMode("historical");
    }
  }, [mode, oven, realtimeAvailable]);

  const effectiveMode = realtimeAvailable ? mode : "historical";

  const cycleRange = useMemo(() => {
    if (!oven) return null;

    return getDetailCycleRange(
      oven,
      effectiveMode,
      selectedCycle ?? getDefaultHistoricalCycle(oven),
    );
  }, [effectiveMode, oven, selectedCycle]);

  useEffect(() => {
    if (!oven || !cycleRange) return;

    void apiClient
      .getHistory({
        ovenId: oven.id,
        preset: "custom",
        sensors: allSensorKeys,
        startAt: cycleRange.start.toISOString(),
        endAt: cycleRange.end.toISOString(),
        cycleNumber:
          effectiveMode === "historical"
            ? selectedCycle ?? undefined
            : oven.cycleCount,
      })
      .then(setPoints);
  }, [cycleRange, effectiveMode, oven, selectedCycle]);

  const ovenAlarms = useMemo(
    () => alarms.filter((alarm) => alarm.ovenId === ovenId),
    [alarms, ovenId],
  );

  if (loading) {
    return <LoadingState />;
  }

  if (!oven) {
    return (
      <EmptyState
        title="ไม่พบข้อมูลเตา"
        description="กลับไปเลือกเตาจาก Dashboard หรือเมนูด้านซ้าย"
      />
    );
  }

  return (
    <>
      <PageHeader
        title={`${oven.name} / Temperature control`}
        description={`${oven.zone} · ${oven.line} · อัปเดตล่าสุด ${formatDateTime(
          oven.lastUpdatedAt,
        )}`}
        actions={
          <>
            <StatusBadge kind={oven.status} />

            <button
              className="button"
              type="button"
              onClick={async () => {
                await apiClient.advanceRealtime();
                await refresh();
              }}
            >
              <RefreshCw size={17} />
              รีเฟรช
            </button>
          </>
        }
      />

      <section className="panel detail-control-bar">
        <div className="tabs" role="tablist" aria-label="โหมดกราฟ">
          <button
            className={`tab ${effectiveMode === "realtime" ? "is-active" : ""}`}
            type="button"
            disabled={!realtimeAvailable}
            onClick={() => setMode("realtime")}
            title={
              realtimeAvailable
                ? "ดูกราฟรอบปัจจุบัน"
                : "เตานี้ไม่ได้เปิดอยู่ จึงไม่มีกราฟ Realtime"
            }
          >
            Realtime
          </button>

          <button
            className={`tab ${effectiveMode === "historical" ? "is-active" : ""}`}
            type="button"
            onClick={() => setMode("historical")}
          >
            Historical
          </button>
        </div>

        {effectiveMode === "historical" ? (
          <div className="range-controls cycle-selector">
            <label className="field compact-field">
              <span>เลือกรอบอบย้อนหลัง</span>

              <select
                value={selectedCycle ?? ""}
                onChange={(event) => setSelectedCycle(Number(event.target.value))}
              >
                {cycleOptions.map((cycle) => (
                  <option key={cycle} value={cycle}>
                    รอบ {cycle}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="mode-note">
            <CalendarClock size={16} />
            Realtime คือกราฟรอบปัจจุบัน ข้อมูลจะเติมเข้ากราฟตามรอบส่งจริง
          </p>
        )}

        {!realtimeAvailable ? (
          <p className="mode-note mode-note-warning">
            เตานี้อยู่สถานะ {statusText(oven.status)} จึงดูได้เฉพาะข้อมูลย้อนหลังตามรอบอบ
          </p>
        ) : null}
      </section>

      {effectiveMode === "realtime" ? (
        <section className="realtime-gauge-grid" aria-label="ค่า realtime จากเซนเซอร์">
          {realtimeGaugeOrder.map((sensor) => (
            <SensorGauge
              key={sensor}
              sensor={sensor}
              value={oven.readings[sensor].value}
              limit={getGaugeLimit(oven, sensor)}
              showLimit={sensor !== "humidity"}
            />
          ))}
        </section>
      ) : null}

      <section className="detail-overview-grid">
        <div className="panel operation-panel">
          <div className="panel-heading">
            <div>
              <h2>Operation</h2>
              <p>เวลาเปิดเตา เวลาเลิกใช้งาน และจำนวนรอบสะสม</p>
            </div>
          </div>

          <div className="operation-times">
            <div className="time-block">
              <h3>
                <Play size={18} />
                เวลาเปิดเตา
              </h3>
              <strong>{oven.startedAt ? formatDateTime(oven.startedAt) : "-"}</strong>
            </div>

            <div className="time-block">
              <h3>
                <Pause size={18} />
                เวลาเลิกใช้งาน
              </h3>
              <strong>{oven.stoppedAt ? formatDateTime(oven.stoppedAt) : "-"}</strong>
            </div>
          </div>

          <div className="download-row">
            <Link
              className="button button-primary"
              to={`/reports?ovenId=${oven.id}&mode=${
                effectiveMode === "realtime" ? "current" : "history"
              }&cycle=${
                effectiveMode === "realtime"
                  ? oven.cycleCount
                  : selectedCycle ?? getDefaultHistoricalCycle(oven)
              }&auto=pdf`}
            >
              <FileDown size={17} />
              {effectiveMode === "realtime"
                ? "รายงานรอบปัจจุบัน"
                : "รายงานย้อนหลัง"}
            </Link>

            <button
              className="button"
              type="button"
              onClick={() => downloadCsv(`${oven.name}-cycle.csv`, points, allSensorKeys)}
            >
              <Download size={17} />
              ส่งออก CSV
            </button>
          </div>
        </div>

        <div className="status-side-stack">
          <div className={`status-panel status-banner status-${oven.status}`}>
            <p>สถานะเตา</p>
            <strong>{statusText(oven.status)}</strong>
            <span>{oven.cycleCount} รอบทั้งหมด</span>
          </div>

          {effectiveMode === "realtime" && realtimeAvailable ? (
            <TemperatureRangeCard oven={oven} />
          ) : null}
        </div>
      </section>

      <section className="chart-grid-two">
        <ChartPanel
          title="อุณหภูมิและความชื้นในห้องอบ"
          description="1 กราฟต่อ 1 รอบอบ แสดงเส้น Upper/Lower เฉพาะอุณหภูมิห้องอบ"
          points={points}
          sensors={environmentSensors}
          limits={oven.limits}
          mode={effectiveMode}
          rightAxisSensors={["humidity"]}
          leftAxisName="อุณหภูมิ °C"
          rightAxisName="ความชื้น %"
          limitSensors={["chamberTemp"]}
        />

        <ChartPanel
          title="อุณหภูมิเตาเผาและ Blower"
          description="เตาเผาและ Blower ใช้ Upper/Lower ชุดเดียวกัน"
          points={points}
          sensors={heatSensors}
          limits={oven.limits}
          mode={effectiveMode}
          rightAxisSensors={[]}
          leftAxisName="อุณหภูมิ °C"
          rightAxisName=""
          limitSensors={["furnaceTemp"]}
          limitLabel="เตาเผา / Blower"
        />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Alarm ที่เกี่ยวข้อง</h2>
            <p>เหตุการณ์ผิดปกติปัจจุบันและย้อนหลังของเตานี้</p>
          </div>

          <Link className="button" to="/alarms">
            <History size={17} />
            ดูทั้งหมด
          </Link>
        </div>

        {ovenAlarms.length ? (
          <div className="alarm-list">
            {ovenAlarms.slice(0, 5).map((alarm) => (
              <article key={alarm.id} className={`alarm-item severity-${alarm.severity}`}>
                <h3>
                  {alarm.title}
                  <StatusBadge kind={alarm.severity} />
                </h3>

                <p>
                  {formatDateTime(alarm.createdAt)} · {alarm.detail}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="ไม่มี Alarm ของเตานี้" description="ค่าปัจจุบันอยู่ในช่วงมาตรฐาน" />
        )}
      </section>
    </>
  );
}

function ChartPanel({
  title,
  description,
  points,
  sensors,
  limits,
  mode,
  rightAxisSensors,
  leftAxisName,
  rightAxisName,
  limitSensors,
  limitLabel,
}: {
  title: string;
  description: string;
  points: TimeSeriesPoint[];
  sensors: SensorKey[];
  limits: LimitMap;
  mode: ChartMode;
  rightAxisSensors: SensorKey[];
  leftAxisName: string;
  rightAxisName: string;
  limitSensors: SensorKey[];
  limitLabel?: string;
}) {
  return (
    <section className="panel chart-panel grafana-chart-panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>

        <span className="panel-mode-chip">{mode === "realtime" ? "Live" : "Historical"}</span>
      </div>

      <ThresholdLegend
        sensors={limitSensors}
        limits={limits}
        labelOverrides={limitLabel ? { [limitSensors[0]]: limitLabel } : undefined}
      />

      <TimeSeriesChart
        points={points}
        sensors={sensors}
        limits={limits}
        title={title}
        realtime={mode === "realtime"}
        rightAxisSensors={rightAxisSensors}
        leftAxisName={leftAxisName}
        rightAxisName={rightAxisName}
        limitSensors={limitSensors}
      />
    </section>
  );
}

function getGaugeLimit(oven: Oven, sensor: SensorKey) {
  if (sensor === "furnaceTemp" || sensor === "blowerTemp") {
    return oven.limits.furnaceTemp;
  }

  return oven.limits[sensor];
}

function getDefaultHistoricalCycle(oven: Oven): number {
  if (oven.status === "open") {
    return Math.max(1, oven.cycleCount - 1);
  }

  return Math.max(1, oven.cycleCount);
}

function TemperatureRangeCard({ oven }: { oven: Oven }) {
  const reading = oven.readings.chamberTemp;
  const limit = oven.limits.chamberTemp;
  const state = getReadingState(reading.value, "chamberTemp", oven.limits);

  const labels = {
    normal: "อยู่ในช่วง",
    warning: reading.value > limit.upper ? "สูงกว่า Upper" : "ต่ำกว่า Lower",
    danger: reading.value > limit.upper ? "สูงกว่า Upper มาก" : "ต่ำกว่า Lower มาก",
  } satisfies Record<ReturnType<typeof getReadingState>, string>;

  return (
    <div className={`status-range-card status-${state}`}>
      <p>
        <Thermometer size={16} />
        ช่วงอุณหภูมิ
      </p>

      <strong>{labels[state]}</strong>

      <span>
        Lower {limit.lower}°C · Upper {limit.upper}°C · ตอนนี้ {reading.value.toFixed(1)}°C
      </span>
    </div>
  );
}

function getDetailCycleRange(
  oven: Oven,
  mode: ChartMode,
  cycleNumber: number,
): { start: Date; end: Date } {
  const now = new Date();

  if (mode === "realtime" && oven.startedAt) {
    const end = now;

    return {
      start: clampCycleStart(new Date(oven.startedAt), end),
      end,
    };
  }

  const latestCycle = Math.max(oven.cycleCount, 1);
  const cycleOffset = Math.max(0, latestCycle - cycleNumber);
  const baseEnd = new Date(oven.stoppedAt ?? oven.lastUpdatedAt ?? now);
  const end = new Date(baseEnd.getTime() - cycleOffset * (REPORT_CYCLE_MS + 12 * 60 * 60 * 1000));
  const start = new Date(end.getTime() - REPORT_CYCLE_MS);

  return { start, end };
}

function canUseRealtime(status: OvenStatus): boolean {
  return status === "open";
}

function statusText(status: OvenStatus): string {
  const labels: Record<OvenStatus, string> = {
    open: "เปิด",
    closed: "ปิด",
    offline: "ขาดการเชื่อมต่อ",
  };

  return labels[status];
}