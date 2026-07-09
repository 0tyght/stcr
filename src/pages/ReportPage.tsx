import JSZip from "jszip";
import { Download, FileArchive, FileDown, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Link, useSearchParams } from "react-router-dom";

import { useAppData } from "../app/providers";
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
import { clampCycleStart, REPORT_CYCLE_MS } from "../utils/reportCycle";
import { allSensorKeys } from "../utils/sensors";

type ReportMode = "current" | "history";
type HistoricalDownloadMode = "single" | "range";

type ReportSlot = {
  index: number;
  dayIndex: number;
  timeLabel: string;
  date: Date;
  actual: number | null;
  target: number;
};

const reportSensors: SensorKey[] = ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"];

const timeSlots = ["08.00", "11.00", "14.00", "17.00", "20.00", "23.00", "02.00", "05.00"];

const reportDayCount = 10;
const reportSlotCount = reportDayCount * timeSlots.length;

const graphMinTemp = 30;
const graphMaxTemp = 65;

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

  const reportSlots = useMemo(() => {
    if (!oven || !cycleRange) return [];

    return buildReportSlots({
      points,
      start: cycleRange.start,
      upper: oven.limits.chamberTemp.upper,
      lower: oven.limits.chamberTemp.lower,
    });
  }, [cycleRange, oven, points]);

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

      await waitForRender(900);

      if (!reportRef.current) {
        throw new Error("ไม่สามารถสร้าง PDF ได้");
      }

      const filename = `F-WS-05_OVEN${oven.number}_Cycle${safeCycle}_${formatFileDate(
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
      await waitForRender(900);

      if (!reportRef.current) return;

      await downloadElementAsLandscapePdf(
        reportRef.current,
        `F-WS-05_OVEN${oven.number}_Cycle${safeCycle}_${formatFileDate(
          range.start,
        )}_to_${formatFileDate(range.end)}.pdf`,
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
      const folder = zip.folder(`F-WS-05_OVEN${oven.number}`) ?? zip;

      for (const [index, cycle] of cycles.entries()) {
        setDownloadMessage(`กำลังสร้างไฟล์ ${index + 1}/${cycles.length} · รอบ ${cycle}`);

        const { blob, filename } = await renderCycleAndCreatePdfBlob(cycle);
        folder.file(filename, blob);

        await waitForRender(260);
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

      downloadBlob(zipBlob, `F-WS-05_OVEN${oven.number}_Cycle${high}_to_${low}.zip`);
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
    }, 620);
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
        description={`${oven.name} · รอบ ${selectedCycle} · แบบฟอร์ม F-WS-05 รายงานการตรวจสอบอุณหภูมิเตา`}
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
                downloadCsv(`F-WS-05-${oven.name}-cycle-${selectedCycle}.csv`, points, reportSensors)
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
          <div style={{ display: "grid", gap: 12, width: "100%" }}>
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
        <FwsReportSheet
          refElement={reportRef}
          oven={oven}
          cycleRange={cycleRange}
          slots={reportSlots}
        />
      </section>
    </>
  );
}

function FwsReportSheet({
  refElement,
  oven,
  cycleRange,
  slots,
}: {
  refElement: RefObject<HTMLDivElement | null>;
  oven: Oven;
  cycleRange: { start: Date; end: Date };
  slots: ReportSlot[];
}) {
  const upper = oven.limits.chamberTemp.upper;
  const lower = oven.limits.chamberTemp.lower;

  return (
    <div className="fws-sheet" ref={refElement}>
      <style>{fwsStyles}</style>

      {/* ---------- header: logo | title | document no. box ---------- */}
      <header className="fws-header">
        <div className="fws-logo-cell">
          <EditableVectorLogo />
        </div>

        <div className="fws-title-cell">
          <h1>รายงานการตรวจสอบอุณหภูมิเตา</h1>
        </div>

        <div className="fws-doc-cell">
          <div>
            <strong>Document No.</strong>
            <b>F-WS-05 Rev.11</b>
          </div>

          <div>
            <strong>เริ่มใช้วันที่</strong>
            <b>1-ธ.ค.-68</b>
          </div>
        </div>
      </header>

      {/* ---------- meta: oven no / dates / weights / close time ---------- */}
      <section className="fws-meta">
        <div className="fws-meta-row1">
          <span className="meta-item">
            เตา No<span className="line dot oven-no">{oven.number}</span>
          </span>

          <span className="meta-item">
            เข้าเตาวันที่<span className="line dot date">{formatReportDate(cycleRange.start)}</span>
          </span>

          <span className="meta-item">
            ออกเตาวันที่<span className="line dot date">{formatReportDate(cycleRange.end)}</span>
          </span>

          <span className="meta-item meta-item-right">
            เวลาปิดเตา (ติดไฟ)
            <span className="line dot time">{formatReportTime(cycleRange.end)}</span> น.
          </span>
        </div>

        <div className="fws-meta-row2">
          <span className="rubber-type">
            <b>ชนิดยาง</b>

            <label>
              <i />
              USS ≥ 97%
            </label>

            <label>
              <i />
              USS ≥ 96%
              <br />
              แต่ &lt; 97%
            </label>

            <label>
              <i />
              USS ≥94%
              <br />
              แต่ &lt; 96% (ควบคุมพิเศษ)
            </label>
          </span>

          <span className="weight-item">
            ปริมาณน้ำหนักยางเข้าเตา (Net Weight) :<span className="line dot long" />
            (ก.ก.)
          </span>
        </div>

        <div className="fws-meta-row3">
          <span className="weight-item">
            ปริมาณน้ำหนักยางออกเตา (Net Weight) :<span className="line dot long" />
            (ก.ก.)
          </span>
        </div>
      </section>

      <FwsTemperatureGraph slots={slots} upper={upper} lower={lower} />

      <section className="fws-notes">
        <p>
          * ✕ ไม่สุก (ปากกาสีน้ำเงิน) &nbsp; ✓ สุก (ปากกาสีแดง) &nbsp; Ø
          ยางสุกแล้วยังไม่ออกเตา (อุ่นใช้ปากกาสีแดง) / เกณฑ์ประเมินวันรมยาง
          ต้องใช้ระยะเวลาการรมควันตามที่ WI กำหนด (WI-WS-06)
        </p>

        <p>** ควบคุมอุณหภูมิ: [รมควัน] 40 - 60°C, [อุ่นยาง] 35-40°C</p>

        <div className="fws-evaluate">
          <div className="fws-evaluate-left">
            <span>ประเมินวันรมควัน</span>

            <label>
              <i />
              อยู่ในเกณฑ์
            </label>

            <label>
              <i />
              เกินเกณฑ์ (เกณฑ์รมควัน = ระยะเวลาการรมควันเกินที่ WI กำหนด (WI-WS-06))
            </label>

            <label>
              <i />
              ไม่ถึงเกณฑ์ (เกณฑ์รมควัน = ระยะเวลาการรมควันไม่ถึงเกณฑ์ที่ WI กำหนด (WI-WS-06))
            </label>
          </div>

          <div className="fws-color-note">
            <p>สีน้ำเงิน = อุณหภูมิที่ต้องการ : หัวหน้างาน</p>
            <p>สีแดง = อุณหภูมิจริง : พนักงานคุมเตา</p>
          </div>
        </div>

        <p className="fws-cause">
          สาเหตุ
          <span className="line dot cause" />
        </p>
      </section>

      <footer className="fws-sign">
        <p>
          ผู้รายงาน <span />
        </p>

        <p>
          หัวหน้าฝ่ายผลิต <span />
        </p>
      </footer>

      <div className="fws-bottom-left">F-WS-05 รายงานการตรวจสอบอุณหภูมิเตา Rev.11</div>
      <div className="fws-bottom-right">Effectived Date : 1 Dec 2025</div>
    </div>
  );
}

function EditableVectorLogo() {
  return (
    <svg className="fws-logo-svg" viewBox="0 0 120 68" aria-label="โลโก้">
      <defs>
        <linearGradient id="logoSun" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffb329" />
          <stop offset="55%" stopColor="#ffe174" />
          <stop offset="100%" stopColor="#ef8500" />
        </linearGradient>
      </defs>

      <ellipse cx="60" cy="27" rx="38" ry="25" fill="url(#logoSun)" stroke="#a65b00" strokeWidth="1" />
      <path d="M25 38 C42 18, 52 18, 70 37 C80 25, 90 22, 105 37" fill="none" stroke="#453171" strokeWidth="6" strokeLinecap="round" />
      <path d="M35 43 C48 34, 65 34, 83 44" fill="none" stroke="#f6f1d5" strokeWidth="4" strokeLinecap="round" />
      <text x="60" y="62" textAnchor="middle" fontSize="18" fontWeight="900" fill="#f08a00" stroke="#8a4a00" strokeWidth="0.35" letterSpacing="7">
        ยาง
      </text>
    </svg>
  );
}

function FwsTemperatureGraph({
  slots,
  upper,
  lower,
}: {
  slots: ReportSlot[];
  upper: number;
  lower: number;
}) {
  const width = 1074;
  const height = 466;

  const left = 60;
  const dayHeight = 24;
  const timeHeight = 62;
  const chartTop = dayHeight + timeHeight;
  const chartHeight = 300;
  const rubberRowHeight = height - chartTop - chartHeight;
  const chartWidth = width - left - 2;
  const cellWidth = chartWidth / reportSlotCount;

  const tempToY = (value: number) => {
    const clamped = Math.max(graphMinTemp, Math.min(graphMaxTemp, value));
    return chartTop + ((graphMaxTemp - clamped) / (graphMaxTemp - graphMinTemp)) * chartHeight;
  };

  const actualPath = buildLinePath(
    slots
      .filter((slot) => slot.actual !== null)
      .map((slot) => ({
        x: left + (slot.index + 0.5) * cellWidth,
        y: tempToY(slot.actual ?? graphMinTemp),
      })),
  );

  const targetPath = buildLinePath(
    slots.map((slot) => ({
      x: left + (slot.index + 0.5) * cellWidth,
      y: tempToY(slot.target),
    })),
  );

  return (
    <svg
      className="fws-graph"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      shapeRendering="crispEdges"
      textRendering="geometricPrecision"
    >
      <rect x="0.5" y="0.5" width={width - 1} height={height - 1} fill="#ffffff" stroke="#000000" />

      {/* row separators */}
      <line x1={left} y1="0" x2={left} y2={height} stroke="#000000" strokeWidth="1" />
      <line x1="0" y1={dayHeight} x2={width} y2={dayHeight} stroke="#000000" />
      <line x1="0" y1={chartTop} x2={width} y2={chartTop} stroke="#000000" />
      <line x1="0" y1={chartTop + chartHeight} x2={width} y2={chartTop + chartHeight} stroke="#000000" />

      <text x="14" y={dayHeight / 2 + 4} className="fws-svg-label" textAnchor="start">
        วัน
      </text>
      <text x="10" y={dayHeight + timeHeight / 2 + 4} className="fws-svg-label" textAnchor="start">
        เวลา
      </text>
      <text x="8" y={chartTop + 14} className="fws-svg-label" textAnchor="start">
        อุณหภูมิ
      </text>
      <text
        x="8"
        y={chartTop + chartHeight + rubberRowHeight / 2 + 4}
        className="fws-svg-label"
        textAnchor="start"
      >
        สภาพยาง
      </text>

      {/* day header cells (1)..(10) */}
      {Array.from({ length: reportDayCount }).map((_, dayIndex) => {
        const x = left + dayIndex * timeSlots.length * cellWidth;
        const w = timeSlots.length * cellWidth;

        return (
          <g key={`day-${dayIndex}`}>
            <rect x={x} y="0" width={w} height={dayHeight} fill="#ffffff" stroke="#000000" strokeWidth="0.7" />
            <text x={x + w / 2} y={dayHeight / 2 + 4.5} textAnchor="middle" className="fws-svg-day">
              ({dayIndex + 1})
            </text>
          </g>
        );
      })}

      {/* per-slot vertical gridlines + rotated time labels, spanning the full sheet height */}
      {slots.map((slot) => {
        const x = left + slot.index * cellWidth;
        const isDayStart = slot.index % timeSlots.length === 0;
        const labelX = x + cellWidth / 2 + 3;
        const labelY = dayHeight + timeHeight - 6;

        return (
          <g key={`col-${slot.index}`}>
            <line
              x1={x}
              y1={dayHeight}
              x2={x}
              y2={height}
              stroke="#000000"
              strokeWidth={isDayStart ? 1.6 : 0.5}
            />

            <text
              x={labelX}
              y={labelY}
              transform={`rotate(-90 ${labelX} ${labelY})`}
              textAnchor="start"
              className="fws-svg-time"
            >
              {slot.timeLabel}
            </text>
          </g>
        );
      })}

      <line x1={width - 1} y1="0" x2={width - 1} y2={height} stroke="#000000" strokeWidth="1.2" />

      {/* temperature scale + horizontal gridlines */}
      {Array.from({ length: graphMaxTemp - graphMinTemp + 1 }).map((_, index) => {
        const temp = graphMaxTemp - index;
        const y = tempToY(temp);
        const isFive = temp % 5 === 0;
        const isMajor = temp === 40 || temp === 60;

        return (
          <g key={`temp-${temp}`}>
            <line
              x1={left}
              y1={y}
              x2={width - 1}
              y2={y}
              stroke="#000000"
              strokeWidth={isMajor ? 1.6 : isFive ? 0.9 : 0.35}
            />

            {isFive ? (
              <text x={left - 8} y={y + 3.5} textAnchor="end" className="fws-svg-temp">
                {temp}
              </text>
            ) : null}
          </g>
        );
      })}

      {(() => {
        const bandX = 22;
        const bandY = (tempToY(60) + tempToY(40)) / 2;
        return (
          <text
            x={bandX}
            y={bandY}
            transform={`rotate(-90 ${bandX} ${bandY})`}
            textAnchor="middle"
            className="fws-svg-band"
          >
            รมควัน
          </text>
        );
      })()}

      {(() => {
        const bandX = 26;
        const bandY = (tempToY(40) + tempToY(30)) / 2;
        return (
          <text
            x={bandX}
            y={bandY}
            transform={`rotate(-90 ${bandX} ${bandY})`}
            textAnchor="middle"
            className="fws-svg-band"
          >
            อุ่น
          </text>
        );
      })()}

      <line
        x1={left}
        y1={tempToY(upper)}
        x2={width - 1}
        y2={tempToY(upper)}
        stroke="#0f4c81"
        strokeWidth="1"
        strokeDasharray="4 4"
        opacity="0.75"
      />

      <line
        x1={left}
        y1={tempToY(lower)}
        x2={width - 1}
        y2={tempToY(lower)}
        stroke="#0f4c81"
        strokeWidth="1"
        strokeDasharray="4 4"
        opacity="0.75"
      />

      {targetPath ? (
        <path d={targetPath} fill="none" stroke="#0f4c81" strokeWidth="1.8" opacity="0.9" shapeRendering="geometricPrecision" />
      ) : null}

      {actualPath ? (
        <path d={actualPath} fill="none" stroke="#d62027" strokeWidth="2.1" opacity="0.95" shapeRendering="geometricPrecision" />
      ) : null}

      {slots
        .filter((slot) => slot.actual !== null)
        .map((slot) => (
          <circle
            key={`point-${slot.index}`}
            cx={left + (slot.index + 0.5) * cellWidth}
            cy={tempToY(slot.actual ?? graphMinTemp)}
            r="1.6"
            fill="#d62027"
          />
        ))}
    </svg>
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

function buildReportSlots({
  points,
  start,
  upper,
  lower,
}: {
  points: TimeSeriesPoint[];
  start: Date;
  upper: number;
  lower: number;
}): ReportSlot[] {
  const target = Math.round((upper + lower) / 2);
  const indexedPoints = points
    .map((point) => ({
      time: new Date(point.timestamp).getTime(),
      value: point.chamberTemp,
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));

  return Array.from({ length: reportSlotCount }, (_, index) => {
    const date = new Date(start.getTime() + index * 3 * 60 * 60 * 1000);
    const closest = findClosestPoint(indexedPoints, date.getTime());

    return {
      index,
      dayIndex: Math.floor(index / timeSlots.length),
      timeLabel: timeSlots[index % timeSlots.length],
      date,
      actual: closest ? closest.value : null,
      target,
    };
  });
}

function findClosestPoint(
  points: Array<{ time: number; value: number }>,
  targetTime: number,
): { time: number; value: number } | null {
  if (!points.length) return null;

  const maxDistance = 90 * 60 * 1000;

  let closest = points[0];
  let distance = Math.abs(points[0].time - targetTime);

  for (const point of points) {
    const nextDistance = Math.abs(point.time - targetTime);

    if (nextDistance < distance) {
      closest = point;
      distance = nextDistance;
    }
  }

  return distance <= maxDistance ? closest : null;
}

function buildLinePath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
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

/**
 * NOTE ON FONT / SHARPNESS:
 * "TH Sarabun New" is a licensed desktop font and is almost never present on a
 * server/browser used for PDF export (html2canvas / puppeteer), so it silently
 * falls back to Tahoma — this changes letter widths and can misplace Thai tone
 * marks, which reads as "blurry" once rasterized. Load the free, metric-close
 * replacement "Sarabun" from Google Fonts in your app's <head> (index.html):
 *
 *   <link rel="preconnect" href="https://fonts.googleapis.com" />
 *   <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
 *   <link
 *     href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap"
 *     rel="stylesheet"
 *   />
 *
 * Loading it in <head> (rather than inside this component's <style>) matters:
 * html2canvas snapshots the DOM before a component-scoped @import may have
 * finished downloading, which is a common cause of a "flash of fallback font"
 * baked into the exported PDF.
 *
 * Also check createLandscapePdfBlobFromElement / downloadElementAsLandscapePdf:
 * if they call html2canvas with the default scale (1), text and hairlines will
 * look soft once blown up to full-page PDF size. Use `scale: 3` (or `window.
 * devicePixelRatio * 2`) and export as PNG, not JPEG, e.g.:
 *
 *   html2canvas(element, { scale: 3, useCORS: true, backgroundColor: "#ffffff" })
 *
 * IMPORTANT — this graph has 80 columns x 36 rows of hairlines. Even with a
 * higher html2canvas scale, a *raster* PDF (canvas -> PNG -> pdf.addImage)
 * will show moiré/fuzziness on this much fine grid once a PDF viewer zooms
 * in, because you're stretching a fixed-resolution bitmap. Increasing scale
 * only pushes the problem further out, it doesn't remove it. The real fix is
 * a *vector* PDF: either render this SVG straight into the PDF with
 * svg2pdf.js (https://github.com/yWorks/svg2pdf.js) instead of html2canvas,
 * or use the browser's native print-to-PDF via `window.print()` with an
 * `@page { size: landscape; margin: 0 }` stylesheet. Both keep every line and
 * glyph crisp at any zoom level. I can wire this up directly if you share
 * pdfExport.ts (createLandscapePdfBlobFromElement / downloadElementAsLandscapePdf).
 */
const fwsStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap');

  .fws-sheet {
    position: relative;
    width: 1123px;
    height: 794px;
    margin: 0 auto;
    background: #ffffff;
    color: #000000;
    border: 1.5px solid #000000;
    box-sizing: border-box;
    overflow: hidden;
    font-family: "TH Sarabun New", "Sarabun", "Noto Sans Thai", "Tahoma", sans-serif;
    font-size: 13px;
    line-height: 1.2;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .fws-header {
    display: grid;
    grid-template-columns: 168px 1fr 200px;
    height: 74px;
    border-bottom: 1px solid #000000;
  }

  .fws-logo-cell,
  .fws-title-cell,
  .fws-doc-cell {
    border-right: 1px solid #000000;
  }

  .fws-doc-cell {
    border-right: 0;
    display: grid;
    grid-template-rows: 1fr 1fr;
  }

  .fws-doc-cell > div:first-child {
    border-bottom: 1px solid #000000;
  }

  .fws-doc-cell > div {
    display: grid;
    place-items: center;
    gap: 2px;
    font-size: 11.5px;
    text-align: center;
  }

  .fws-doc-cell b {
    font-weight: 800;
  }

  .fws-logo-cell {
    display: grid;
    place-items: center;
  }

  .fws-logo-svg {
    width: 108px;
    height: 60px;
    display: block;
  }

  .fws-title-cell {
    display: grid;
    place-items: center;
  }

  .fws-title-cell h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
  }

  /* ---------------- meta block: mirrors the 3-row layout of the paper form ---------------- */

  .fws-meta {
    border-bottom: 1px solid #000000;
    padding: 7px 16px 6px;
  }

  .fws-meta-row1 {
    display: flex;
    align-items: baseline;
    flex-wrap: nowrap;
    gap: 28px;
    white-space: nowrap;
    margin-bottom: 7px;
  }

  .meta-item {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-size: 13px;
  }

  .meta-item-right {
    margin-left: auto;
  }

  .fws-meta-row2 {
    display: flex;
    align-items: flex-start;
    gap: 30px;
    margin-bottom: 6px;
  }

  .fws-meta-row3 {
    display: flex;
  }

  .rubber-type {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    font-size: 11px;
    flex: 0 0 auto;
  }

  .rubber-type > b {
    font-size: 13px;
    padding-top: 1px;
  }

  .rubber-type label {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    max-width: 108px;
    line-height: 1.25;
  }

  .rubber-type i,
  .fws-evaluate i {
    display: inline-block;
    width: 12px;
    height: 12px;
    min-width: 12px;
    border: 1px solid #000000;
    margin-top: 1px;
  }

  .weight-item {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    white-space: nowrap;
    font-size: 13px;
  }

  .line {
    display: inline-block;
    border-bottom: 1px dotted #000000;
    text-align: center;
    min-height: 14px;
  }

  .line.dot {
    padding: 0 4px;
  }

  .oven-no {
    min-width: 130px;
  }

  .date {
    min-width: 150px;
  }

  .time {
    min-width: 100px;
  }

  .long {
    min-width: 230px;
  }

  .cause {
    width: 860px;
    min-width: 860px;
  }

  .fws-cause {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  /* ---------------- temperature graph ---------------- */

  .fws-graph {
    display: block;
    width: 1074px;
    height: 466px;
    margin: 2px auto 0;
    shape-rendering: crispEdges;
  }

  .fws-svg-label,
  .fws-svg-band {
    font-size: 11.5px;
    fill: #000000;
    font-weight: 700;
    font-family: "TH Sarabun New", "Sarabun", "Noto Sans Thai", sans-serif;
  }

  .fws-svg-day {
    font-size: 10.5px;
    fill: #000000;
    font-weight: 700;
    font-family: "TH Sarabun New", "Sarabun", "Noto Sans Thai", sans-serif;
  }

  .fws-svg-time {
    font-size: 9px;
    fill: #000000;
    font-weight: 600;
    font-family: "TH Sarabun New", "Sarabun", "Noto Sans Thai", sans-serif;
  }

  .fws-svg-temp {
    font-size: 10.5px;
    fill: #000000;
    font-weight: 700;
    font-family: "TH Sarabun New", "Sarabun", "Noto Sans Thai", sans-serif;
  }

  /* ---------------- footer notes ---------------- */

  .fws-notes {
    width: 1040px;
    margin: 5px auto 0;
    font-size: 11.5px;
  }

  .fws-notes p {
    margin: 0 0 4px;
  }

  .fws-evaluate {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 20px;
    align-items: start;
  }

  .fws-evaluate-left {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 10px 16px;
  }

  .fws-evaluate-left > span:first-child {
    font-weight: 700;
  }

  .fws-evaluate label {
    display: inline-flex;
    align-items: flex-start;
    gap: 4px;
    font-size: 10.5px;
    max-width: 260px;
  }

  .fws-evaluate label i {
    margin-top: 2px;
  }

  .fws-color-note p {
    margin: 0 0 4px;
    font-weight: 700;
  }

  .fws-sign {
    position: absolute;
    left: 300px;
    right: 150px;
    bottom: 26px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 130px;
    font-size: 13px;
  }

  .fws-sign p {
    margin: 0;
    white-space: nowrap;
  }

  .fws-sign span {
    display: inline-block;
    width: 220px;
    border-bottom: 1px dotted #000000;
  }

  .fws-bottom-left,
  .fws-bottom-right {
    position: absolute;
    bottom: 5px;
    font-size: 8px;
  }

  .fws-bottom-left {
    left: 8px;
  }

  .fws-bottom-right {
    right: 8px;
  }

  .report-page-shell {
    overflow-x: auto;
  }
`;
