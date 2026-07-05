import { CalendarClock, Download, FileDown, History, Pause, Play, RefreshCw } from "lucide-react";
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
import type { HistoryRangePreset, LimitMap, OvenStatus, SensorKey, TimeSeriesPoint } from "../types";
import { formatDateTime, formatNumber, toDateInputValue } from "../utils/format";
import { REPORT_CYCLE_DAYS, getDefaultCycleRange } from "../utils/reportCycle";
import { summarizeHistory } from "../utils/report";
import { allSensorKeys, sensorByKey } from "../utils/sensors";

type ChartMode = "realtime" | "historical";

const environmentSensors: SensorKey[] = ["chamberTemp", "humidity"];
const heatSensors: SensorKey[] = ["furnaceTemp", "blowerTemp"];

export function OvenDetailPage() {
  const { ovenId = "" } = useParams();
  const { ovens, alarms, loading, refresh } = useAppData();
  const oven = ovens.find((item) => item.id === ovenId);
  const [mode, setMode] = useState<ChartMode>("realtime");
  const [preset, setPreset] = useState<HistoryRangePreset>("cycle");
  const [points, setPoints] = useState<TimeSeriesPoint[]>([]);
  const [customStart, setCustomStart] = useState(() => toDateInputValue(getDefaultCycleRange().start));
  const [customEnd, setCustomEnd] = useState(() => toDateInputValue(getDefaultCycleRange().end));

  const realtimeAvailable = oven ? canUseRealtime(oven.status) : false;

  useEffect(() => {
    if (!oven) return;
    setMode(canUseRealtime(oven.status) ? "realtime" : "historical");
  }, [oven?.id]);

  useEffect(() => {
    if (!oven) return;
    if (!realtimeAvailable && mode === "realtime") {
      setMode("historical");
    }
  }, [mode, oven, realtimeAvailable]);

  useEffect(() => {
    if (!oven) return;
    const effectiveMode = realtimeAvailable ? mode : "historical";
    const queryPreset = effectiveMode === "realtime" ? "24h" : preset;

    void apiClient
      .getHistory({
        ovenId: oven.id,
        preset: queryPreset,
        sensors: allSensorKeys,
        startAt: queryPreset === "custom" ? new Date(customStart).toISOString() : undefined,
        endAt: queryPreset === "custom" ? new Date(customEnd).toISOString() : undefined,
      })
      .then(setPoints);
  }, [customEnd, customStart, mode, oven, preset, realtimeAvailable]);

  const ovenAlarms = useMemo(() => alarms.filter((alarm) => alarm.ovenId === ovenId), [alarms, ovenId]);
  const historySummaries = useMemo(() => {
    if (!oven) return [];
    return summarizeHistory(points, allSensorKeys, oven.limits);
  }, [oven, points]);

  if (loading) return <LoadingState />;

  if (!oven) {
    return <EmptyState title="ไม่พบข้อมูลเตา" description="กลับไปเลือกเตาจาก Dashboard หรือเมนูด้านซ้าย" />;
  }

  const effectiveMode = realtimeAvailable ? mode : "historical";

  return (
    <>
      <PageHeader
        title={`${oven.name} / Temperature control`}
        description={`${oven.zone} · ${oven.line} · อัปเดตล่าสุด ${formatDateTime(oven.lastUpdatedAt)}`}
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
            title={realtimeAvailable ? "ดูข้อมูลล่าสุด" : "เตานี้ปิดอยู่ จึงดู Realtime ไม่ได้"}
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
          <div className="range-controls">
            {[
              ["today", "วันนี้"],
              ["24h", "24 ชั่วโมง"],
              ["cycle", `1 รอบ (${REPORT_CYCLE_DAYS} วัน)`],
              ["7d", "7 วัน"],
              ["30d", "30 วัน"],
              ["custom", "กำหนดเอง"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={`segment ${preset === value ? "is-active" : ""}`}
                type="button"
                onClick={() => setPreset(value as HistoryRangePreset)}
              >
                {label}
              </button>
            ))}
            {preset === "custom" ? (
              <>
                <input type="datetime-local" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                <input type="datetime-local" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
              </>
            ) : null}
          </div>
        ) : (
          <p className="mode-note">
            <CalendarClock size={16} />
            Realtime ใช้กับเตาที่กำลังทำงานเท่านั้น และอัปเดตตามรอบส่งข้อมูล
          </p>
        )}

        {!realtimeAvailable ? (
          <p className="mode-note mode-note-warning">
            เตานี้อยู่สถานะ {statusText(oven.status)} จึงแสดงเฉพาะข้อมูลย้อนหลัง
          </p>
        ) : null}
      </section>

      {effectiveMode === "realtime" ? (
        <section className="realtime-gauge-grid" aria-label="ค่า realtime จากเซนเซอร์">
          {allSensorKeys.map((sensor) => (
            <SensorGauge key={sensor} sensor={sensor} value={oven.readings[sensor].value} limit={oven.limits[sensor]} />
          ))}
        </section>
      ) : (
        <section className="history-stat-grid" aria-label={`สรุปย้อนหลัง ${REPORT_CYCLE_DAYS} วัน`}>
          {historySummaries.map((summary) => {
            const definition = sensorByKey[summary.sensor];
            const unit = definition.unit === "C" ? "°C" : "%";
            const digits = summary.sensor === "furnaceTemp" ? 0 : 1;
            return (
              <article className="history-stat-card" key={summary.sensor}>
                <span>{definition.label}</span>
                <strong>
                  {formatNumber(summary.average, digits)} {unit}
                </strong>
                <small>
                  Min {formatNumber(summary.min, digits)} · Max {formatNumber(summary.max, digits)} · เกิน limit{" "}
                  {summary.exceedCount} จุด
                </small>
              </article>
            );
          })}
        </section>
      )}

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
            <Link className="button button-primary" to={`/reports?ovenId=${oven.id}`}>
              <FileDown size={17} />
              รายงาน PDF 1 รอบ
            </Link>
            <button className="button" type="button" onClick={() => downloadCsv(`${oven.name}-history.csv`, points, allSensorKeys)}>
              <Download size={17} />
              ส่งออก CSV
            </button>
          </div>
        </div>

        <div className={`status-panel status-banner status-${oven.status}`}>
          <p>สถานะเตา</p>
          <strong>{statusText(oven.status)}</strong>
          <span>{oven.cycleCount} รอบทั้งหมด</span>
        </div>
      </section>

      <section className="chart-grid-two">
        <ChartPanel
          title="อุณหภูมิและความชื้นในห้องอบ"
          description="ใช้ดูสภาพในห้องอบเทียบกับ Upper/Lower limit"
          points={points}
          sensors={environmentSensors}
          limits={oven.limits}
          mode={effectiveMode}
          rightAxisSensors={["humidity"]}
          leftAxisName="อุณหภูมิ °C"
          rightAxisName="ความชื้น %"
        />
        <ChartPanel
          title="อุณหภูมิเตาเผาและ Blower"
          description="แยกดูระบบให้ความร้อนและการเป่าลม ไม่ปนกับกราฟห้องอบ"
          points={points}
          sensors={heatSensors}
          limits={oven.limits}
          mode={effectiveMode}
          rightAxisSensors={["blowerTemp"]}
          leftAxisName="เตาเผา °C"
          rightAxisName="Blower °C"
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
      <ThresholdLegend sensors={sensors} limits={limits} />
      <TimeSeriesChart
        points={points}
        sensors={sensors}
        limits={limits}
        title={title}
        realtime={mode === "realtime"}
        rightAxisSensors={rightAxisSensors}
        leftAxisName={leftAxisName}
        rightAxisName={rightAxisName}
      />
    </section>
  );
}

function canUseRealtime(status: OvenStatus): boolean {
  return status === "open" || status === "warning" || status === "danger";
}

function statusText(status: OvenStatus): string {
  const labels: Record<OvenStatus, string> = {
    open: "เปิด",
    closed: "ปิด",
    warning: "เตือน",
    danger: "อันตราย",
    offline: "ขาดการเชื่อมต่อ",
    disabled: "ปิดใช้งาน",
  };
  return labels[status];
}
