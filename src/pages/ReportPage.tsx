import JSZip from "jszip";
import { Download, FileArchive, FileDown, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
        <FwsReportSheet
          refElement={reportRef}
          oven={oven}
          cycle={selectedCycle}
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
  cycle,
  cycleRange,
  slots,
}: {
  refElement: React.RefObject<HTMLDivElement | null>;
  oven: Oven;
  cycle: number;
  cycleRange: { start: Date; end: Date };
  slots: ReportSlot[];
}) {
  const upper = oven.limits.chamberTemp.upper;
  const lower = oven.limits.chamberTemp.lower;

  return (
    <div className="fws-sheet" ref={refElement}>
      <style>{fwsStyles}</style>

      <header className="fws-header">
        <div className="fws-logo-cell">
          <div className="fws-logo-mark">
            <span>ยาง</span>
          </div>
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

      <section className="fws-meta">
        <div className="fws-meta-left">
          <p>
            เตา No. <span className="line short">{oven.number}</span>
          </p>

          <div className="rubber-row">
            <span>ชนิดยาง</span>

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
          </div>
        </div>

        <div className="fws-meta-mid">
          <p>
            เข้าเตาวันที่ <span className="line">{formatReportDate(cycleRange.start)}</span>
            ออกเตาวันที่ <span className="line">{formatReportDate(cycleRange.end)}</span>
          </p>

          <p>
            ปริมาณน้ำหนักยางเข้าเตา (Net Weight) :
            <span className="line long" />
            (ก.ก.)
          </p>

          <p>
            ปริมาณน้ำหนักยางออกเตา (Net Weight) :
            <span className="line long" />
            (ก.ก.)
          </p>
        </div>

        <div className="fws-meta-right">
          <p>
            เวลาปิดเตา (ติดไฟ) <span className="line medium">{formatReportTime(cycleRange.end)}</span>{" "}
            น.
          </p>

          <p>
            รอบการอบ/ปี <span className="line short">{cycle}</span>
          </p>
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
          <div>
            ประเมินวันรมควัน
            <label>
              <i />
              อยู่ในเกณฑ์
            </label>
            <label>
              <i />
              เกินเกณฑ์
            </label>
            <label>
              <i />
              ไม่ถึงเกณฑ์
            </label>
          </div>

          <div className="fws-color-note">
            <p>สีน้ำเงิน = อุณหภูมิที่ต้องการ : หัวหน้างาน</p>
            <p>สีแดง = อุณหภูมิจริง : พนักงานคุมเตา</p>
          </div>
        </div>

        <p>
          สาเหตุ
          <span className="line cause" />
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
      <div className="fws-bottom-right">Effective Date : 1 Dec 2025</div>
    </div>
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
  const height = 444;
  const left = 58;
  const topDay = 0;
  const dayHeight = 28;
  const timeHeight = 68;
  const tempLabelHeight = 23;
  const chartTop = topDay + dayHeight + timeHeight + tempLabelHeight;
  const chartHeight = 288;
  const conditionHeight = 28;
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
      aria-label="กราฟรายงานการตรวจสอบอุณหภูมิเตา"
    >
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" stroke="#000000" />

      <line x1={left} y1="0" x2={left} y2={height} stroke="#000000" strokeWidth="1" />
      <line x1="0" y1={dayHeight} x2={width} y2={dayHeight} stroke="#000000" />
      <line
        x1="0"
        y1={dayHeight + timeHeight}
        x2={width}
        y2={dayHeight + timeHeight}
        stroke="#000000"
      />
      <line x1="0" y1={chartTop} x2={width} y2={chartTop} stroke="#000000" />
      <line
        x1="0"
        y1={chartTop + chartHeight}
        x2={width}
        y2={chartTop + chartHeight}
        stroke="#000000"
      />

      <text x="22" y="19" className="fws-svg-label">
        วัน
      </text>

      <text x="19" y={dayHeight + 38} className="fws-svg-label">
        เวลา
      </text>

      <text x="12" y={dayHeight + timeHeight + 16} className="fws-svg-label">
        อุณหภูมิ
      </text>

      <text x="10" y={chartTop + chartHeight + 18} className="fws-svg-label">
        สภาพยาง
      </text>

      {Array.from({ length: reportDayCount }).map((_, dayIndex) => {
        const x = left + dayIndex * timeSlots.length * cellWidth;
        const w = timeSlots.length * cellWidth;

        return (
          <g key={`day-${dayIndex}`}>
            <rect x={x} y={topDay} width={w} height={dayHeight} fill="#ffffff" stroke="#000000" />
            <text x={x + w / 2} y="18" textAnchor="middle" className="fws-svg-day">
              ({dayIndex + 1})
            </text>
          </g>
        );
      })}

      {slots.map((slot) => {
        const x = left + slot.index * cellWidth;
        const isDayStart = slot.index % timeSlots.length === 0;

        return (
          <g key={`time-${slot.index}`}>
            <line
              x1={x}
              y1={0}
              x2={x}
              y2={height}
              stroke="#000000"
              strokeWidth={isDayStart ? 1.8 : 0.65}
            />

            <text
              x={x + cellWidth / 2 + 2}
              y={dayHeight + timeHeight - 5}
              transform={`rotate(-90 ${x + cellWidth / 2 + 2} ${dayHeight + timeHeight - 5})`}
              textAnchor="start"
              className="fws-svg-time"
            >
              {slot.timeLabel}
            </text>
          </g>
        );
      })}

      <line
        x1={width - 2}
        y1={0}
        x2={width - 2}
        y2={height}
        stroke="#000000"
        strokeWidth="1.2"
      />

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
              x2={width}
              y2={y}
              stroke="#000000"
              strokeWidth={isMajor ? 1.8 : isFive ? 1.05 : 0.45}
            />

            {isFive ? (
              <text x={left - 8} y={y + 3.5} textAnchor="end" className="fws-svg-temp">
                {temp}
              </text>
            ) : null}
          </g>
        );
      })}

      <text x="18" y={tempToY(50) + 4} className="fws-svg-band">
        รมควัน
      </text>

      <text x="24" y={tempToY(35) + 4} className="fws-svg-band">
        อุ่น
      </text>

      <line x1="0" y1={tempToY(60)} x2="28" y2={tempToY(60)} stroke="#000000" strokeWidth="1.4" />
      <line x1="0" y1={tempToY(40)} x2="28" y2={tempToY(40)} stroke="#000000" strokeWidth="1.4" />

      <line
        x1={left}
        y1={tempToY(upper)}
        x2={width}
        y2={tempToY(upper)}
        stroke="#0f4c81"
        strokeWidth="1"
        strokeDasharray="4 4"
        opacity="0.75"
      />

      <line
        x1={left}
        y1={tempToY(lower)}
        x2={width}
        y2={tempToY(lower)}
        stroke="#0f4c81"
        strokeWidth="1"
        strokeDasharray="4 4"
        opacity="0.75"
      />

      {targetPath ? (
        <path d={targetPath} fill="none" stroke="#0f4c81" strokeWidth="1.8" opacity="0.9" />
      ) : null}

      {actualPath ? (
        <path d={actualPath} fill="none" stroke="#d62027" strokeWidth="2.1" opacity="0.95" />
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

const fwsStyles = `
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
    font-family: "TH Sarabun New", "Sarabun", "Tahoma", sans-serif;
    font-size: 12px;
    line-height: 1.18;
  }

  .fws-header {
    display: grid;
    grid-template-columns: 178px 1fr 210px;
    height: 78px;
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
    font-size: 11px;
  }

  .fws-doc-cell strong,
  .fws-doc-cell b {
    display: block;
  }

  .fws-logo-cell {
    display: grid;
    place-items: center;
  }

  .fws-logo-mark {
    width: 92px;
    height: 46px;
    border-radius: 15px;
    display: grid;
    place-items: center;
    color: #c06b00;
    font-weight: 900;
    font-size: 24px;
    letter-spacing: 8px;
    background: linear-gradient(135deg, #ffb132, #ffe06b 48%, #f08a00);
    border: 1px solid rgba(0, 0, 0, 0.5);
  }

  .fws-logo-mark span {
    transform: translateX(4px);
  }

  .fws-title-cell {
    display: grid;
    place-items: center;
  }

  .fws-title-cell h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
  }

  .fws-meta {
    display: grid;
    grid-template-columns: 290px 520px 1fr;
    height: 86px;
    border-bottom: 1px solid #000000;
  }

  .fws-meta > div {
    padding: 8px 12px 6px;
  }

  .fws-meta p {
    margin: 0 0 7px;
    white-space: nowrap;
  }

  .line {
    display: inline-block;
    min-width: 118px;
    border-bottom: 1px dotted #000000;
    text-align: center;
    padding: 0 4px;
    min-height: 13px;
  }

  .line.short {
    min-width: 55px;
  }

  .line.medium {
    min-width: 130px;
  }

  .line.long {
    min-width: 230px;
  }

  .line.cause {
    width: 780px;
    min-width: 780px;
  }

  .rubber-row {
    display: grid;
    grid-template-columns: 50px 78px 78px 1fr;
    align-items: start;
    gap: 8px;
    font-size: 10px;
  }

  .rubber-row label {
    display: grid;
    justify-items: center;
    gap: 4px;
    text-align: center;
  }

  .rubber-row i,
  .fws-evaluate i {
    display: inline-block;
    width: 13px;
    height: 13px;
    border: 1px solid #000000;
    vertical-align: middle;
    margin: 0 4px;
  }

  .fws-graph {
    display: block;
    width: 1074px;
    height: 444px;
    margin: 0 auto;
  }

  .fws-svg-label,
  .fws-svg-band {
    font-size: 11px;
    fill: #000000;
    font-weight: 700;
  }

  .fws-svg-day {
    font-size: 10px;
    fill: #000000;
    font-weight: 700;
  }

  .fws-svg-time {
    font-size: 8px;
    fill: #000000;
    font-weight: 600;
  }

  .fws-svg-temp {
    font-size: 10px;
    fill: #000000;
    font-weight: 700;
  }

  .fws-notes {
    width: 1030px;
    margin: 4px auto 0;
    font-size: 11px;
  }

  .fws-notes p {
    margin: 0 0 4px;
  }

  .fws-evaluate {
    display: grid;
    grid-template-columns: 1fr 330px;
    gap: 20px;
    align-items: start;
  }

  .fws-evaluate label {
    margin-left: 12px;
  }

  .fws-color-note p {
    margin: 0 0 4px;
    font-weight: 700;
  }

  .fws-sign {
    position: absolute;
    left: 295px;
    right: 145px;
    bottom: 28px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 130px;
    font-size: 12px;
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