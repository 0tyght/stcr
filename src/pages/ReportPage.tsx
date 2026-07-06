import { Download, FileDown, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAppData } from "../app/providers";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { apiClient } from "../services/apiClient";
import { downloadElementAsLandscapePdf } from "../services/pdfExport";
import { downloadCsv } from "../services/reportExport";
import type { Oven, SensorKey, TimeSeriesPoint } from "../types";
import { formatNumber } from "../utils/format";
import { clampCycleStart, REPORT_CYCLE_DAYS, REPORT_CYCLE_MS } from "../utils/reportCycle";
import { sensorByKey } from "../utils/sensors";

type ReportMode = "current" | "history";

const reportSensors: SensorKey[] = ["chamberTemp", "humidity"];

export function ReportPage() {
  const { ovens } = useAppData();
  const [searchParams] = useSearchParams();
  const ovenId = searchParams.get("ovenId") ?? "";
  const mode: ReportMode = searchParams.get("mode") === "history" ? "history" : "current";
  const autoPdf = searchParams.get("auto") === "pdf";
  const requestedCycle = Number(searchParams.get("cycle"));
  const oven = ovens.find((item) => item.id === ovenId);
  const [selectedCycle, setSelectedCycle] = useState<number | null>(null);
  const [points, setPoints] = useState<TimeSeriesPoint[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [autoDownloaded, setAutoDownloaded] = useState(false);
  const reportRef = useRef<HTMLDivElement | null>(null);

  const cycleOptions = useMemo(() => {
    if (!oven) return [];
    const latest = oven.cycleCount || 1;
    const count = Math.min(latest, 12);
    return Array.from({ length: count }, (_, index) => latest - index);
  }, [oven]);

  useEffect(() => {
    if (!oven) return;
    const fallbackCycle = mode === "current" ? oven.cycleCount : getDefaultHistoricalCycle(oven);
    const cycle = Number.isFinite(requestedCycle) && requestedCycle > 0 ? requestedCycle : fallbackCycle;
    setSelectedCycle(Math.min(Math.max(1, cycle), Math.max(oven.cycleCount, 1)));
  }, [mode, oven?.id, oven?.cycleCount, requestedCycle]);

  const cycleRange = useMemo(() => {
    if (!oven || selectedCycle == null) return null;
    return getCycleRange(oven, mode, selectedCycle);
  }, [mode, oven, selectedCycle]);

  const loadReport = useCallback(async () => {
    if (!oven || !cycleRange) return;
    setLoadingReport(true);
    const nextPoints = await apiClient.getHistory({
      ovenId: oven.id,
      preset: "custom",
      startAt: cycleRange.start.toISOString(),
      endAt: cycleRange.end.toISOString(),
      cycleNumber: selectedCycle ?? undefined,
      sensors: reportSensors,
    });
    setPoints(nextPoints);
    setLoadingReport(false);
  }, [cycleRange, oven, selectedCycle]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const summaries = useMemo(() => summarizeReport(points), [points]);

  const downloadPdf = useCallback(async () => {
    if (!oven || !cycleRange || !reportRef.current) return;
    await downloadElementAsLandscapePdf(
      reportRef.current,
      `OVEN${oven.number}_Cycle${selectedCycle ?? oven.cycleCount}_${formatFileDate(cycleRange.start)}_to_${formatFileDate(
        cycleRange.end,
      )}.pdf`,
    );
  }, [cycleRange, oven, selectedCycle]);

  useEffect(() => {
    if (!autoPdf || autoDownloaded || loadingReport || !points.length) return;
    setAutoDownloaded(true);
    window.setTimeout(() => {
      void downloadPdf();
    }, 450);
  }, [autoDownloaded, autoPdf, downloadPdf, loadingReport, points.length]);

  if (!oven) {
    return (
      <EmptyState
        title="ไม่พบเตาสำหรับรายงาน"
        description="เปิดรายงานจากหน้ารายละเอียดเตา เพื่อให้ระบบล็อกเตาและรอบอบถูกต้อง"
      />
    );
  }

  if (!cycleRange) {
    return <EmptyState title="ยังไม่มีรอบอบสำหรับรายงาน" description="เตานี้ยังไม่มีข้อมูลรอบอบให้สร้างรายงาน" />;
  }

  return (
    <>
      <PageHeader
        title={mode === "current" ? "รายงานรอบปัจจุบัน" : "รายงานย้อนหลัง"}
        description={`${oven.name} · รอบ ${selectedCycle ?? oven.cycleCount} · 1 กราฟต่อ 1 รอบอบ (${REPORT_CYCLE_DAYS} วันหรือต่ำกว่า)`}
        actions={
          <>
            <Link className="button" to={`/ovens/${oven.id}`}>
              กลับหน้าเตา
            </Link>
            <button className="button button-primary" type="button" onClick={() => void downloadPdf()}>
              <FileDown size={17} />
              ดาวน์โหลด PDF
            </button>
            <button className="button" type="button" onClick={() => downloadCsv(`${oven.name}-cycle-report.csv`, points, reportSensors)}>
              <Download size={17} />
              ส่งออก CSV
            </button>
          </>
        }
      />

      <section className="panel report-filter report-cycle-toolbar">
        <div>
          <strong>{oven.name}</strong>
          <span>
            {formatReportDateTime(cycleRange.start)} ถึง {formatReportDateTime(cycleRange.end)}
          </span>
        </div>
        {mode === "history" ? (
          <label className="field compact-field">
            <span>เลือกรอบย้อนหลัง</span>
            <select value={selectedCycle ?? ""} onChange={(event) => setSelectedCycle(Number(event.target.value))}>
              {cycleOptions.map((cycle) => (
                <option key={cycle} value={cycle}>
                  รอบ {cycle}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button className="button button-dark" type="button" onClick={() => void loadReport()} disabled={loadingReport}>
          <RefreshCw size={17} />
          โหลดรายงานใหม่
        </button>
      </section>

      <section className="report-page-shell">
        <div className="report-sheet" ref={reportRef}>
          <header className="report-sheet-header">
            <h1>รายงานการตรวจสอบอุณหภูมิและความชื้น หน้า 1/1 OVEN{oven.number}</h1>
          </header>

          <section className="report-meta-grid">
            <div>
              <p>ชนิดยาง : ........................</p>
              <p>ปริมาณน้ำหนักยางเข้าเตา (ก.ก.) : ........................</p>
              <p>ปริมาณน้ำหนักยางออกเตา (ก.ก.) : ........................</p>
            </div>
            <div>
              <p>
                เริ่มอบวันที่ : {formatReportDate(cycleRange.start)} &nbsp; เวลา: {formatReportTime(cycleRange.start)}
              </p>
              <p>ระยะเวลาการอบ : {formatDuration(cycleRange.start, cycleRange.end)}</p>
              <p>รอบการอบ/ปี : {selectedCycle ?? oven.cycleCount}</p>
            </div>
            <div>
              <p>
                หยุดอบวันที่ : {formatReportDate(cycleRange.end)} &nbsp; เวลา : {formatReportTime(cycleRange.end)}
              </p>
            </div>
          </section>

          <div className="report-chart-title">Temperature and Humidity Variation 1</div>
          <div className="report-chart-frame">
            <TimeSeriesChart
              points={points}
              sensors={reportSensors}
              limits={oven.limits}
              title=""
              realtime={mode === "current"}
              rightAxisSensors={[]}
              leftAxisName="Temperature Oven / Humidity Oven"
              rightAxisName=""
              limitSensors={["chamberTemp"]}
              theme="print"
            />
          </div>

          <div className="report-summary-row">
            {summaries.map((summary) => {
              const definition = sensorByKey[summary.sensor];
              const unit = definition.unit === "C" ? "°C" : "%";
              return (
                <div key={summary.sensor}>
                  <strong>{definition.label}</strong>
                  <span>
                    Avg {formatNumber(summary.average)} {unit} · Min {formatNumber(summary.min)} · Max {formatNumber(summary.max)}
                  </span>
                </div>
              );
            })}
          </div>

          <footer className="report-signatures">
            <p>
              ผู้รายงาน <span />
            </p>
            <p>
              หัวหน้าฝ่ายผลิต <span />
            </p>
          </footer>
        </div>
      </section>
    </>
  );
}

function getCycleRange(oven: Oven, mode: ReportMode, cycleNumber: number): { start: Date; end: Date } {
  const now = new Date();
  if (mode === "current" && oven.startedAt && oven.status === "open") {
    const end = now;
    return { start: clampCycleStart(new Date(oven.startedAt), end), end };
  }

  const latestCycle = Math.max(oven.cycleCount, 1);
  const cycleOffset = Math.max(0, latestCycle - cycleNumber);
  const baseEnd = new Date(oven.stoppedAt ?? oven.lastUpdatedAt ?? now);
  const end = new Date(baseEnd.getTime() - cycleOffset * (REPORT_CYCLE_MS + 12 * 60 * 60 * 1000));
  const start = new Date(end.getTime() - REPORT_CYCLE_MS);
  return { start, end };
}

function getDefaultHistoricalCycle(oven: Oven): number {
  if (oven.status === "open") return Math.max(1, oven.cycleCount - 1);
  return Math.max(1, oven.cycleCount);
}

function summarizeReport(points: TimeSeriesPoint[]) {
  return reportSensors.map((sensor) => {
    const values = points.map((point) => point[sensor]);
    if (!values.length) return { sensor, min: 0, max: 0, average: 0 };
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      sensor,
      min: Math.min(...values),
      max: Math.max(...values),
      average: total / values.length,
    };
  });
}

function formatReportDate(value: Date): string {
  return `${String(value.getDate()).padStart(2, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${value.getFullYear()}`;
}

function formatFileDate(value: Date): string {
  return formatReportDate(value).replaceAll("-", "");
}

function formatReportTime(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}.${String(value.getMinutes()).padStart(2, "0")}`;
}

function formatReportDateTime(value: Date): string {
  return `${formatReportDate(value)} ${formatReportTime(value)}`;
}

function formatDuration(start: Date, end: Date): string {
  const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days} วัน ${hours} ชั่วโมง ${minutes} นาที`;
}
