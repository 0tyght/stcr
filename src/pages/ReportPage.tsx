import JSZip from "jszip";
import { Download, FileArchive, FileDown, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAppData } from "../app/providers";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { apiClient } from "../services/apiClient";
import {
  createLandscapePdfBlobFromElement,
  downloadBlob,
  downloadElementAsLandscapePdf,
} from "../services/pdfExport";
import { downloadCsv } from "../services/reportExport";
import type { Oven, SensorKey, TimeSeriesPoint } from "../types";
import { formatNumber } from "../utils/format";
import { clampCycleStart, REPORT_CYCLE_DAYS, REPORT_CYCLE_MS } from "../utils/reportCycle";
import { allSensorKeys, sensorByKey } from "../utils/sensors";

type ReportMode = "current" | "history";
type HistoricalDownloadMode = "single" | "range";

const environmentReportSensors: SensorKey[] = ["chamberTemp", "humidity"];
const heatReportSensors: SensorKey[] = ["furnaceTemp", "blowerTemp"];
const reportSensors: SensorKey[] = [...environmentReportSensors, ...heatReportSensors];

export function ReportPage() {
  const { ovens } = useAppData();
  const [searchParams] = useSearchParams();

  const ovenId = searchParams.get("ovenId") ?? "";
  const mode: ReportMode = searchParams.get("mode") === "history" ? "history" : "current";
  const autoPdf = searchParams.get("auto") === "pdf";
  const requestedCycle = Number(searchParams.get("cycle"));

  const oven =
    ovens.find((item) => item.id === ovenId) ??
    ovens.find((item) => item.number === 18) ??
    ovens[0];

  const [selectedCycle, setSelectedCycle] = useState<number | null>(null);
  const [rangeFromCycle, setRangeFromCycle] = useState<number | null>(null);
  const [rangeToCycle, setRangeToCycle] = useState<number | null>(null);
  const [historicalDownloadMode, setHistoricalDownloadMode] =
    useState<HistoricalDownloadMode>("single");

  const [points, setPoints] = useState<TimeSeriesPoint[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [autoDownloaded, setAutoDownloaded] = useState(false);

  const reportRef = useRef<HTMLDivElement | null>(null);

  const cycleOptions = useMemo(() => {
    if (!oven) return [];

    const latest = Math.max(oven.cycleCount || 1, 1);
    return Array.from({ length: latest }, (_, index) => latest - index);
  }, [oven]);

  useEffect(() => {
    if (!oven) return;

    const fallbackCycle = mode === "current" ? oven.cycleCount : getDefaultHistoricalCycle(oven);
    const cycle =
      Number.isFinite(requestedCycle) && requestedCycle > 0 ? requestedCycle : fallbackCycle;
    const safeCycle = clampCycleNumber(cycle, oven);

    setSelectedCycle(safeCycle);
    setRangeFromCycle(safeCycle);
    setRangeToCycle(safeCycle);
    setHistoricalDownloadMode("single");
  }, [mode, oven?.id, oven?.cycleCount, requestedCycle]);

  const cycleRange = useMemo(() => {
    if (!oven || selectedCycle == null) return null;
    return getCycleRange(oven, mode, selectedCycle);
  }, [mode, oven, selectedCycle]);

  const loadReport = useCallback(async () => {
    if (!oven || !cycleRange || selectedCycle == null) return;

    setLoadingReport(true);

    const nextPoints = await apiClient.getHistory({
      ovenId: oven.id,
      preset: "custom",
      startAt: cycleRange.start.toISOString(),
      endAt: cycleRange.end.toISOString(),
      cycleNumber: selectedCycle,
      sensors: allSensorKeys,
    });

    setPoints(nextPoints);
    setLoadingReport(false);
  }, [cycleRange, oven, selectedCycle]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const summaries = useMemo(() => summarizeReport(points), [points]);

  const renderCycleAndCreatePdfBlob = useCallback(
    async (cycle: number): Promise<{ blob: Blob; filename: string }> => {
      if (!oven || !reportRef.current) {
        throw new Error("ยังไม่พบข้อมูลเตาหรือพื้นที่รายงาน");
      }

      const safeCycle = clampCycleNumber(cycle, oven);
      const range = getCycleRange(oven, mode, safeCycle);

      setSelectedCycle(safeCycle);

      const nextPoints = await apiClient.getHistory({
        ovenId: oven.id,
        preset: "custom",
        startAt: range.start.toISOString(),
        endAt: range.end.toISOString(),
        cycleNumber: safeCycle,
        sensors: allSensorKeys,
      });

      setPoints(nextPoints);

      await waitForRender(850);

      if (!reportRef.current) {
        throw new Error("ไม่สามารถสร้าง PDF ได้");
      }

      const filename = `OVEN${oven.number}_Cycle${safeCycle}_${formatFileDate(
        range.start,
      )}_to_${formatFileDate(range.end)}.pdf`;

      const blob = await createLandscapePdfBlobFromElement(reportRef.current);

      return { blob, filename };
    },
    [mode, oven],
  );

  const downloadSelectedPdf = useCallback(async () => {
    if (!oven || selectedCycle == null) return;

    setDownloadingPdf(true);
    setDownloadMessage("กำลังสร้าง PDF...");

    try {
      const safeCycle = clampCycleNumber(selectedCycle, oven);
      const range = getCycleRange(oven, mode, safeCycle);

      const nextPoints = await apiClient.getHistory({
        ovenId: oven.id,
        preset: "custom",
        startAt: range.start.toISOString(),
        endAt: range.end.toISOString(),
        cycleNumber: safeCycle,
        sensors: allSensorKeys,
      });

      setPoints(nextPoints);
      await waitForRender(850);

      if (!reportRef.current) return;

      await downloadElementAsLandscapePdf(
        reportRef.current,
        `OVEN${oven.number}_Cycle${safeCycle}_${formatFileDate(range.start)}_to_${formatFileDate(
          range.end,
        )}.pdf`,
      );
    } finally {
      setDownloadMessage("");
      setDownloadingPdf(false);
    }
  }, [mode, oven, selectedCycle]);

  const downloadHistoricalRangeZip = useCallback(async () => {
    if (!oven || rangeFromCycle == null || rangeToCycle == null) return;

    const cycles = getCycleRangeList(rangeFromCycle, rangeToCycle, oven);

    if (!cycles.length) return;

    setDownloadingPdf(true);

    try {
      const zip = new JSZip();
      const folder = zip.folder(`OVEN${oven.number}_reports`) ?? zip;

      for (const [index, cycle] of cycles.entries()) {
        setDownloadMessage(`กำลังสร้างไฟล์ ${index + 1}/${cycles.length} · รอบ ${cycle}`);

        const { blob, filename } = await renderCycleAndCreatePdfBlob(cycle);
        folder.file(filename, blob);

        await waitForRender(250);
      }

      setDownloadMessage("กำลังรวมไฟล์เป็น ZIP...");

      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: {
          level: 6,
        },
      });

      const high = Math.max(rangeFromCycle, rangeToCycle);
      const low = Math.min(rangeFromCycle, rangeToCycle);

      downloadBlob(zipBlob, `OVEN${oven.number}_Cycle${high}_to_${low}_reports.zip`);
    } finally {
      setDownloadMessage("");
      setDownloadingPdf(false);
    }
  }, [oven, rangeFromCycle, rangeToCycle, renderCycleAndCreatePdfBlob]);

  useEffect(() => {
    if (!autoPdf || autoDownloaded || loadingReport || !points.length || !oven) return;

    setAutoDownloaded(true);

    window.setTimeout(() => {
      void downloadSelectedPdf();
    }, 520);
  }, [autoDownloaded, autoPdf, downloadSelectedPdf, loadingReport, oven, points.length]);

  if (!oven) {
    return <EmptyState title="ยังไม่มีข้อมูลเตา" description="ยังไม่มีข้อมูลเตาสำหรับสร้างรายงาน" />;
  }

  if (!cycleRange || selectedCycle == null) {
    return (
      <EmptyState
        title="ยังไม่มีรอบอบสำหรับรายงาน"
        description="เตานี้ยังไม่มีข้อมูลรอบอบให้สร้างรายงาน"
      />
    );
  }

  const rangeCycles =
    rangeFromCycle != null && rangeToCycle != null
      ? getCycleRangeList(rangeFromCycle, rangeToCycle, oven)
      : [];

  return (
    <>
      <PageHeader
        title={mode === "current" ? "รายงานรอบปัจจุบัน" : "ดาวน์โหลดรายงานย้อนหลัง"}
        description={`${oven.name} · รอบ ${selectedCycle} · 1 กราฟต่อ 1 รอบอบ (${REPORT_CYCLE_DAYS} วันหรือต่ำกว่า)`}
        actions={
          <>
            <Link className="button" to={`/ovens/${oven.id}`}>
              กลับหน้าเตา
            </Link>

            {mode === "current" ? (
              <button
                className="button button-primary"
                type="button"
                onClick={() => void downloadSelectedPdf()}
                disabled={downloadingPdf || loadingReport}
              >
                <FileDown size={17} />
                {downloadingPdf ? "กำลังโหลด..." : "ดาวน์โหลด PDF"}
              </button>
            ) : null}

            <button
              className="button"
              type="button"
              onClick={() =>
                downloadCsv(`${oven.name}-cycle-${selectedCycle}-report.csv`, points, reportSensors)
              }
              disabled={loadingReport || !points.length || downloadingPdf}
            >
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

        {mode === "current" ? (
          <button
            className="button button-dark"
            type="button"
            onClick={() => void loadReport()}
            disabled={loadingReport || downloadingPdf}
          >
            <RefreshCw size={17} />
            โหลดรายงานใหม่
          </button>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 12,
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  gap: 8,
                  padding: 4,
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  background: "var(--surface-soft)",
                }}
              >
                <button
                  className={`tab ${historicalDownloadMode === "single" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setHistoricalDownloadMode("single")}
                  disabled={downloadingPdf}
                >
                  โหลดไฟล์เดียว
                </button>

                <button
                  className={`tab ${historicalDownloadMode === "range" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setHistoricalDownloadMode("range")}
                  disabled={downloadingPdf}
                >
                  โหลดหลายรอบเป็น ZIP
                </button>
              </div>

              <button
                className="button button-dark"
                type="button"
                onClick={() => void loadReport()}
                disabled={loadingReport || downloadingPdf}
              >
                <RefreshCw size={17} />
                โหลดพรีวิวใหม่
              </button>
            </div>

            {historicalDownloadMode === "single" ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(220px, 1fr) auto",
                  gap: 12,
                  alignItems: "end",
                }}
              >
                <label className="field compact-field">
                  <span>เลือกรอบย้อนหลัง</span>

                  <select
                    value={selectedCycle}
                    disabled={downloadingPdf}
                    onChange={(event) => setSelectedCycle(Number(event.target.value))}
                  >
                    {cycleOptions.map((cycle) => (
                      <option key={cycle} value={cycle}>
                        รอบ {cycle}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => void downloadSelectedPdf()}
                  disabled={downloadingPdf || loadingReport}
                >
                  <FileDown size={17} />
                  {downloadingPdf ? "กำลังโหลด..." : "ดาวน์โหลดรอบนี้"}
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(160px, 1fr) minmax(160px, 1fr) auto",
                  gap: 12,
                  alignItems: "end",
                }}
              >
                <label className="field compact-field">
                  <span>ตั้งแต่รอบที่</span>

                  <select
                    value={rangeFromCycle ?? ""}
                    disabled={downloadingPdf}
                    onChange={(event) => {
                      const cycle = Number(event.target.value);
                      setRangeFromCycle(cycle);
                      setSelectedCycle(cycle);
                    }}
                  >
                    {cycleOptions.map((cycle) => (
                      <option key={cycle} value={cycle}>
                        รอบ {cycle}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field compact-field">
                  <span>ถึงรอบที่</span>

                  <select
                    value={rangeToCycle ?? ""}
                    disabled={downloadingPdf}
                    onChange={(event) => setRangeToCycle(Number(event.target.value))}
                  >
                    {cycleOptions.map((cycle) => (
                      <option key={cycle} value={cycle}>
                        รอบ {cycle}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => void downloadHistoricalRangeZip()}
                  disabled={downloadingPdf || loadingReport || !rangeCycles.length}
                >
                  <FileArchive size={17} />
                  {downloadingPdf ? "กำลังรวม ZIP..." : `ดาวน์โหลด ZIP (${rangeCycles.length} รอบ)`}
                </button>
              </div>
            )}

            {downloadMessage ? (
              <p style={{ margin: 0, color: "var(--ink-strong)", fontSize: 12, fontWeight: 750 }}>
                {downloadMessage}
              </p>
            ) : (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                โหมดหลายรอบจะรวม PDF เป็น ZIP โดยแยก 1 ไฟล์ต่อ 1 รอบ
              </p>
            )}
          </div>
        )}
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
                เริ่มอบวันที่ : {formatReportDate(cycleRange.start)} &nbsp; เวลา:{" "}
                {formatReportTime(cycleRange.start)}
              </p>
              <p>ระยะเวลาการอบ : {formatDuration(cycleRange.start, cycleRange.end)}</p>
              <p>รอบการอบ/ปี : {selectedCycle}</p>
            </div>

            <div>
              <p>
                หยุดอบวันที่ : {formatReportDate(cycleRange.end)} &nbsp; เวลา :{" "}
                {formatReportTime(cycleRange.end)}
              </p>
            </div>
          </section>

          <div className="report-chart-title">Temperature and Humidity Variation 1</div>

          <div className="report-chart-frame compact-report-chart">
            <TimeSeriesChart
              points={points}
              sensors={environmentReportSensors}
              limits={oven.limits}
              title=""
              realtime={mode === "current"}
              rightAxisSensors={["humidity"]}
              leftAxisName="Temperature Oven"
              rightAxisName="Humidity Oven"
              limitSensors={["chamberTemp"]}
              theme="print"
              showDataZoom={false}
            />
          </div>

          <div className="report-chart-title">Furnace and Blower Temperature Variation 2</div>

          <div className="report-chart-frame compact-report-chart">
            <TimeSeriesChart
              points={points}
              sensors={heatReportSensors}
              limits={oven.limits}
              title=""
              realtime={mode === "current"}
              rightAxisSensors={[]}
              leftAxisName="Furnace / Blower Temperature"
              rightAxisName=""
              limitSensors={["furnaceTemp"]}
              theme="print"
              showDataZoom={false}
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
                    Avg {formatNumber(summary.average)} {unit} · Min{" "}
                    {formatNumber(summary.min)} · Max {formatNumber(summary.max)}
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

function getCycleRange(
  oven: Oven,
  mode: ReportMode,
  cycleNumber: number,
): { start: Date; end: Date } {
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

    if (!values.length) {
      return { sensor, min: 0, max: 0, average: 0 };
    }

    const total = values.reduce((sum, value) => sum + value, 0);

    return {
      sensor,
      min: Math.min(...values),
      max: Math.max(...values),
      average: total / values.length,
    };
  });
}

function clampCycleNumber(cycle: number, oven: Oven): number {
  const latest = Math.max(oven.cycleCount, 1);
  return Math.min(Math.max(1, Math.round(cycle)), latest);
}

function getCycleRangeList(from: number, to: number, oven: Oven): number[] {
  const safeFrom = clampCycleNumber(from, oven);
  const safeTo = clampCycleNumber(to, oven);
  const high = Math.max(safeFrom, safeTo);
  const low = Math.min(safeFrom, safeTo);

  return Array.from({ length: high - low + 1 }, (_, index) => high - index);
}

function waitForRender(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatReportDate(value: Date): string {
  return `${String(value.getDate()).padStart(2, "0")}-${String(value.getMonth() + 1).padStart(
    2,
    "0",
  )}-${value.getFullYear()}`;
}

function formatFileDate(value: Date): string {
  return formatReportDate(value).replaceAll("-", "");
}

function formatReportTime(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}.${String(value.getMinutes()).padStart(
    2,
    "0",
  )}`;
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