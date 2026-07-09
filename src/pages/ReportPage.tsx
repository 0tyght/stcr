import JSZip from "jszip";
import { Download, FileArchive, FileDown, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Link, useSearchParams } from "react-router-dom";

import grLogo from "../assets/gr-logo.png";
import ttnLogo from "../assets/ttn-logo.png";

import { useAppData } from "../app/providers";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { apiClient } from "../services/apiClient";
import {
  createLandscapePdfBlobFromSvg,
  downloadBlob,
  downloadSvgAsLandscapePdf,
} from "../services/pdfExport";
import { downloadCsv } from "../services/reportExport";
import type { Oven, SensorKey, TimeSeriesPoint } from "../types";
import { clampCycleStart, REPORT_CYCLE_MS } from "../utils/reportCycle";
import { allSensorKeys } from "../utils/sensors";

type ReportMode = "current" | "history";
type HistoricalDownloadMode = "single" | "range";
type SvgTextAnchor = "start" | "middle" | "end";

type ReportCompany = "gr" | "ttn";

function getReportCompany(): ReportCompany {
  if (typeof window === "undefined") return "gr";

  const account = (window.localStorage.getItem("stcr-account") ?? "").toLowerCase();
  return account.startsWith("ttn") ? "ttn" : "gr";
}

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

const svgWidth = 1123;
const svgHeight = 794;

export function ReportPage() {
  const { ovens } = useAppData();
  const [searchParams] = useSearchParams();

  const company = useMemo<ReportCompany>(() => getReportCompany(), []);

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

  const reportRef = useRef<SVGSVGElement | null>(null);

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
  }, [mode, oven, requestedCycle]);

  const cycleRange = useMemo(() => {
    if (!oven || selectedCycle == null) return null;
    return getCycleRange(oven, mode, selectedCycle);
  }, [mode, oven, selectedCycle]);

  const loadReport = useCallback(async () => {
    if (!oven || !cycleRange || selectedCycle == null) return;

    setLoadingReport(true);

    try {
      const nextPoints = await apiClient.getHistory({
        ovenId: oven.id,
        preset: "custom",
        startAt: cycleRange.start.toISOString(),
        endAt: cycleRange.end.toISOString(),
        cycleNumber: selectedCycle,
        sensors: allSensorKeys,
      });

      setPoints(nextPoints);
    } finally {
      setLoadingReport(false);
    }
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

      await waitForRender(300);

      if (!reportRef.current) {
        throw new Error("ไม่สามารถสร้าง PDF ได้");
      }

      const filename = `F-WS-05_OVEN${oven.number}_Cycle${safeCycle}_${formatFileDate(
        range.start,
      )}_to_${formatFileDate(range.end)}.pdf`;

      const blob = await createLandscapePdfBlobFromSvg(reportRef.current);

      return { blob, filename };
    },
    [mode, oven],
  );

  const downloadSelectedPdf = useCallback(async () => {
    if (!oven || selectedCycle == null) return;

    setDownloadingPdf(true);
    setDownloadMessage("กำลังสร้าง PDF แบบ vector...");

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
      await waitForRender(300);

      if (!reportRef.current) return;

      await downloadSvgAsLandscapePdf(
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

        await waitForRender(120);
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
    }, 500);
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

      <section className="report-page-shell" style={{ overflowX: "auto" }}>
        <FwsSvgReport
          refElement={reportRef}
          oven={oven}
          cycle={selectedCycle}
          cycleRange={cycleRange}
          slots={reportSlots}
          company={company}
        />
      </section>
    </>
  );
}

function FwsSvgReport({
  refElement,
  oven,
  cycle,
  cycleRange,
  slots,
  company,
}: {
  refElement: RefObject<SVGSVGElement | null>;
  oven: Oven;
  cycle: number;
  cycleRange: { start: Date; end: Date };
  slots: ReportSlot[];
  company: ReportCompany;
}) {
  const upper = oven.limits.chamberTemp.upper;
  const lower = oven.limits.chamberTemp.lower;

  const mainX = 25;
  const mainY = 15;
  const mainW = 1073;
  const mainH = 730;

  const headerH = 75;
  const metaY = headerH;
  const metaH = 78;
  const graphY = metaY + metaH;
  const graphH = 445;
  const noteY = graphY + graphH + 9;

  return (
    <svg
      ref={refElement}
      className="fws-svg-report"
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      width={svgWidth}
      height={svgHeight}
      role="img"
      aria-label="F-WS-05 รายงานการตรวจสอบอุณหภูมิเตา"
      xmlns="http://www.w3.org/2000/svg"
    >
      <style>{fwsSvgStyles}</style>

      <rect x="0" y="0" width={svgWidth} height={svgHeight} fill="#ffffff" />

      <g transform={`translate(${mainX} ${mainY})`}>
        <rect x="0" y="0" width={mainW} height={mainH} fill="#ffffff" stroke="#000000" strokeWidth="1" />

        <FwsSvgHeader width={mainW} height={headerH} company={company} />

        <FwsSvgMeta
          y={metaY}
          width={mainW}
          height={metaH}
          oven={oven}
          cycle={cycle}
          cycleRange={cycleRange}
        />

        <FwsSvgTemperatureGrid
          y={graphY}
          width={mainW}
          height={graphH}
          slots={slots}
          upper={upper}
          lower={lower}
        />

        <FwsSvgNotes y={noteY} />
      </g>

      <SvgText x={8} y={779} size={8}>
        F-WS-05 รายงานการตรวจสอบอุณหภูมิเตา Rev.11
      </SvgText>

      <SvgText x={1096} y={779} size={8} anchor="end">
        Effective Date : 1 Dec 2025
      </SvgText>
    </svg>
  );
}

function FwsSvgHeader({
  width,
  height,
  company,
}: {
  width: number;
  height: number;
  company: ReportCompany;
}) {
  const logoW = 174;
  const docW = 205;
  const titleW = width - logoW - docW;
  const docX = logoW + titleW;

  return (
    <g>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" stroke="#000000" />
      <line x1={logoW} y1="0" x2={logoW} y2={height} stroke="#000000" />
      <line x1={docX} y1="0" x2={docX} y2={height} stroke="#000000" />
      <line x1={docX} y1={height / 2} x2={width} y2={height / 2} stroke="#000000" />
      <line x1={docX + 92} y1={height / 2} x2={docX + 92} y2={height} stroke="#000000" />

      <g transform="translate(12 5)">
        <CompanyReportLogo company={company} />
      </g>

      <SvgText x={logoW + titleW / 2} y={43} size={16} weight={800} anchor="middle">
        รายงานการตรวจสอบอุณหภูมิเตา
      </SvgText>

      <SvgText x={docX + docW / 2} y={17} size={10} weight={800} anchor="middle">
        Document No.
      </SvgText>
      <SvgText x={docX + docW / 2} y={34} size={11} weight={800} anchor="middle">
        F-WS-05 Rev.11
      </SvgText>

      <SvgText x={docX + 46} y={59} size={10.5} weight={800} anchor="middle">
        เริ่มใช้วันที่
      </SvgText>
      <SvgText x={docX + 148} y={59} size={11} weight={800} anchor="middle">
        1-ธ.ค.-68
      </SvgText>
    </g>
  );
}

function FwsSvgMeta({
  y,
  width,
  height,
  oven,
  cycle,
  cycleRange,
}: {
  y: number;
  width: number;
  height: number;
  oven: Oven;
  cycle: number;
  cycleRange: { start: Date; end: Date };
}) {
  const rubberItems = [
    { x: 98, label: "ยางบาง" },
    { x: 165, label: "ยางเหลือง" },
    { x: 232, label: "ยางดำ" },
    { x: 299, label: "ยางต่างๆ" },
  ];

  return (
    <g transform={`translate(0 ${y})`}>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" stroke="#000000" />

      <SvgText x={14} y={18} size={11} weight={700}>
        เตา No.
      </SvgText>
      <DottedLine x={60} y={18} width={82} />
      <SvgText x={101} y={16} size={11} weight={800} anchor="middle">
        {oven.number}
      </SvgText>

      <SvgText x={14} y={39} size={11} weight={700}>
        ชนิดยาง
      </SvgText>
      <SvgText x={14} y={53} size={8.8}>
        Type of rubber
      </SvgText>

      {rubberItems.map((item) => (
        <g key={item.label}>
          <FwsCheckbox x={item.x} y={21} />
          <line
            x1={item.x + 6.5}
            y1={34}
            x2={item.x + 1}
            y2={48}
            stroke="#000000"
            strokeWidth="0.8"
          />
          <SvgText x={item.x + 6.5} y={62} size={9.5} anchor="middle">
            {item.label}
          </SvgText>
        </g>
      ))}

      <SvgText x={335} y={18} size={11} weight={700}>
        เข้าเตาวันที่
      </SvgText>
      <DottedLine x={405} y={18} width={112} />
      <SvgText x={461} y={16} size={10.5} weight={700} anchor="middle">
        {formatReportDate(cycleRange.start)}
      </SvgText>

      <SvgText x={535} y={18} size={11} weight={700}>
        ออกเตาวันที่
      </SvgText>
      <DottedLine x={608} y={18} width={120} />
      <SvgText x={668} y={16} size={10.5} weight={700} anchor="middle">
        {formatReportDate(cycleRange.end)}
      </SvgText>

      <SvgText x={820} y={18} size={11} weight={700}>
        เวลาปิดเตา (ติดไฟ)
      </SvgText>
      <DottedLine x={920} y={18} width={110} />
      <SvgText x={975} y={16} size={10.5} weight={700} anchor="middle">
        {formatReportTime(cycleRange.end)}
      </SvgText>
      <SvgText x={1040} y={18} size={11} weight={700}>
        น.
      </SvgText>

      <SvgText x={335} y={43} size={11} weight={700}>
        ปริมาณน้ำหนักยางเข้าเตา (Net Weight) :
      </SvgText>
      <DottedLine x={570} y={43} width={230} />
      <SvgText x={805} y={43} size={11} weight={700}>
        (ก.ก.)
      </SvgText>

      <SvgText x={335} y={66} size={11} weight={700}>
        ปริมาณน้ำหนักยางออกเตา (Net Weight) :
      </SvgText>
      <DottedLine x={570} y={66} width={230} />
      <SvgText x={805} y={66} size={11} weight={700}>
        (ก.ก.)
      </SvgText>

      <SvgText x={935} y={66} size={10} weight={700}>
        รอบ
      </SvgText>
      <DottedLine x={962} y={66} width={45} />
      <SvgText x={984} y={64} size={10} weight={800} anchor="middle">
        {cycle}
      </SvgText>
    </g>
  );
}

function FwsSvgTemperatureGrid({
  y,
  width,
  height,
  slots,
  upper,
  lower,
}: {
  y: number;
  width: number;
  height: number;
  slots: ReportSlot[];
  upper: number;
  lower: number;
}) {
  const left = 58;
  const dayH = 29;
  const timeH = 67;
  const tempHeaderH = 26;
  const chartTop = dayH + timeH + tempHeaderH;
  const chartH = 287;
  const chartBottom = chartTop + chartH;
  const chartW = width - left;
  const cellW = chartW / reportSlotCount;

  const tempToY = (value: number) => {
    const clamped = Math.max(graphMinTemp, Math.min(graphMaxTemp, value));
    return chartTop + ((graphMaxTemp - clamped) / (graphMaxTemp - graphMinTemp)) * chartH;
  };

  const slotToX = (index: number) => left + (index + 0.5) * cellW;

  const actualPath = buildLinePath(
    slots
      .filter((slot) => slot.actual !== null)
      .map((slot) => ({
        x: slotToX(slot.index),
        y: tempToY(slot.actual ?? graphMinTemp),
      })),
  );

  const targetPath = buildLinePath(
    slots.map((slot) => ({
      x: slotToX(slot.index),
      y: tempToY(slot.target),
    })),
  );

  return (
    <g transform={`translate(0 ${y})`}>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" stroke="#000000" />

      <line x1={left} y1="0" x2={left} y2={height} stroke="#000000" />
      <line x1="0" y1={dayH} x2={width} y2={dayH} stroke="#000000" />
      <line x1="0" y1={dayH + timeH} x2={width} y2={dayH + timeH} stroke="#000000" />
      <line x1="0" y1={chartTop} x2={width} y2={chartTop} stroke="#000000" />
      <line x1="0" y1={chartBottom} x2={width} y2={chartBottom} stroke="#000000" />

      <SvgText x={22} y={19} size={11} weight={700} anchor="middle">
        วัน
      </SvgText>
      <SvgText x={22} y={dayH + 38} size={11} weight={700} anchor="middle">
        เวลา
      </SvgText>
      <SvgText x={28} y={dayH + timeH + 14} size={10.5} weight={700} anchor="middle">
        อุณหภูมิ
      </SvgText>
      <SvgText x={30} y={chartBottom + 18} size={10.5} weight={700} anchor="middle">
        สภาพยาง
      </SvgText>

      {Array.from({ length: reportDayCount }).map((_, dayIndex) => {
        const x = left + dayIndex * timeSlots.length * cellW;
        const w = timeSlots.length * cellW;

        return (
          <g key={`day-${dayIndex}`}>
            <rect x={x} y="0" width={w} height={dayH} fill="#ffffff" stroke="#000000" />
            <SvgText x={x + w / 2} y={19} size={10} weight={700} anchor="middle">
              ({dayIndex + 1})
            </SvgText>
          </g>
        );
      })}

      {slots.map((slot) => {
        const x = left + slot.index * cellW;
        const isDayStart = slot.index % timeSlots.length === 0;

        return (
          <g key={`slot-${slot.index}`}>
            <line
              x1={x}
              y1="0"
              x2={x}
              y2={height}
              stroke="#000000"
              strokeWidth={isDayStart ? 1.5 : 0.55}
            />

            <text
              x={x + cellW / 2 + 2}
              y={dayH + timeH - 5}
              transform={`rotate(-90 ${x + cellW / 2 + 2} ${dayH + timeH - 5})`}
              textAnchor="start"
              fontFamily="Sarabun"
              fontSize="8"
              fontWeight="bold"
              fill="#000000"
            >
              {slot.timeLabel}
            </text>
          </g>
        );
      })}

      <line x1={width - 0.5} y1="0" x2={width - 0.5} y2={height} stroke="#000000" />

      {Array.from({ length: graphMaxTemp - graphMinTemp + 1 }).map((_, index) => {
        const temp = graphMaxTemp - index;
        const lineY = tempToY(temp);
        const isFive = temp % 5 === 0;
        const isMajor = temp === 40 || temp === 60;

        return (
          <g key={`temp-${temp}`}>
            <line
              x1={left}
              y1={lineY}
              x2={width}
              y2={lineY}
              stroke="#000000"
              strokeWidth={isMajor ? 1.45 : isFive ? 0.9 : 0.38}
            />

            {isFive ? (
              <SvgText x={left - 7} y={lineY + 3.2} size={9.5} weight={700} anchor="end">
                {temp}
              </SvgText>
            ) : null}
          </g>
        );
      })}

      {Array.from({ length: reportSlotCount + 1 }).map((_, index) => {
        const x = left + index * cellW;
        return (
          <line
            key={`chart-v-${index}`}
            x1={x}
            y1={chartTop}
            x2={x}
            y2={chartBottom}
            stroke="#000000"
            strokeWidth={index % timeSlots.length === 0 ? 1.1 : 0.35}
          />
        );
      })}

      <SvgText x={22} y={tempToY(50) + 4} size={10} weight={700} anchor="middle">
        รมควัน
      </SvgText>
      <SvgText x={28} y={tempToY(35) + 4} size={10} weight={700} anchor="middle">
        อุ่น
      </SvgText>

      <line x1="0" y1={tempToY(60)} x2="28" y2={tempToY(60)} stroke="#000000" strokeWidth="1.2" />
      <line x1="0" y1={tempToY(40)} x2="28" y2={tempToY(40)} stroke="#000000" strokeWidth="1.2" />

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
        <path d={targetPath} fill="none" stroke="#0f4c81" strokeWidth="1.75" opacity="0.9" />
      ) : null}

      {actualPath ? (
        <path d={actualPath} fill="none" stroke="#d62027" strokeWidth="2.05" opacity="0.96" />
      ) : null}

      {slots
        .filter((slot) => slot.actual !== null)
        .map((slot) => (
          <circle
            key={`actual-${slot.index}`}
            cx={slotToX(slot.index)}
            cy={tempToY(slot.actual ?? graphMinTemp)}
            r="1.65"
            fill="#d62027"
          />
        ))}
    </g>
  );
}

function FwsSvgNotes({ y }: { y: number }) {
  return (
    <g transform={`translate(0 ${y})`}>
      <SvgText x={58} y={0} size={9.2} weight={700}>
        After the 3rd day of smoking, control the temperature between 40 -55 °C.
      </SvgText>

      <SvgText x={58} y={14} size={9.2} weight={700}>
        (ประเมินอุณหภูมิวันที่ 3 หลังปิดเตา 2 วัน / เกณฑ์การควบคุมอุณหภูมิ = ความชื้นยาง + 1 วัน)
      </SvgText>

      <SvgText x={58} y={36} size={10} weight={700}>
        Smoking period
      </SvgText>
      <SvgText x={220} y={36} size={10} weight={700}>
        Under period
      </SvgText>
      <SvgText x={395} y={36} size={10} weight={700}>
        Over period (+/- 1 day)
      </SvgText>

      <FwsCheckbox x={58} y={47} size={9} />
      <SvgText x={72} y={58} size={10.2} weight={700}>
        อุณหภูมิ
      </SvgText>
      <SvgText x={72} y={71} size={8.8}>
        Temperature
      </SvgText>

      <FwsCheckbox x={220} y={47} size={9} />
      <SvgText x={234} y={58} size={10.2} weight={700}>
        อุ่นในห้องควบคุม
      </SvgText>
      <SvgText x={234} y={71} size={8.8}>
        Under Control
      </SvgText>

      <FwsCheckbox x={395} y={47} size={9} />
      <SvgText x={409} y={58} size={10.2} weight={700}>
        ไม่อยู่ในห้องควบคุม
      </SvgText>
      <SvgText x={409} y={71} size={8.8}>
        Out of Control
      </SvgText>

      <SvgText x={770} y={36} size={10.2} weight={800}>
        สีน้ำเงิน = อุณหภูมิที่ต้องการ : หัวหน้างาน
      </SvgText>
      <SvgText x={770} y={58} size={10.2} weight={800}>
        สีแดง = อุณหภูมิจริง : พนักงานคุมเตา
      </SvgText>

      <SvgText x={360} y={92} size={10.5} weight={700}>
        สาเหตุ
      </SvgText>
      <DottedLine x={400} y={92} width={420} />

      <SvgText x={295} y={112} size={11} weight={700}>
        ผู้รายงาน
      </SvgText>
      <DottedLine x={350} y={112} width={210} />

      <SvgText x={660} y={112} size={11} weight={700}>
        หัวหน้าฝ่ายผลิต
      </SvgText>
      <DottedLine x={750} y={112} width={245} />
    </g>
  );
}

function CompanyReportLogo({ company }: { company: ReportCompany }) {
  const href = company === "ttn" ? ttnLogo : grLogo;

  if (company === "ttn") {
    return (
      <svg width="140" height="64" viewBox="0 0 140 64" aria-label="TTN logo">
        <image
          href={href}
          x="4"
          y="2"
          width="60"
          height="60"
          preserveAspectRatio="xMidYMid meet"
        />
      </svg>
    );
  }

  return (
    <svg width="150" height="64" viewBox="0 0 150 64" aria-label="GR logo">
      <image
        href={href}
        x="4"
        y="7"
        width="125"
        height="50"
        preserveAspectRatio="xMinYMid meet"
      />
    </svg>
  );
}

function FwsCheckbox({ x, y, size = 13 }: { x: number; y: number; size?: number }) {
  return <rect x={x} y={y} width={size} height={size} fill="#ffffff" stroke="#000000" strokeWidth="1" />;
}

function DottedLine({ x, y, width }: { x: number; y: number; width: number }) {
  return (
    <line
      x1={x}
      y1={y}
      x2={x + width}
      y2={y}
      stroke="#000000"
      strokeWidth="0.8"
      strokeDasharray="1.6 2.1"
    />
  );
}

function SvgText({
  x,
  y,
  children,
  size = 11,
  weight = 500,
  anchor = "start",
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  weight?: number;
  anchor?: SvgTextAnchor;
}) {
  return (
    <text
      x={x}
      y={y}
      fontFamily="Sarabun"
      fontSize={size}
      fontWeight={weight >= 700 ? "bold" : "normal"}
      data-weight={weight >= 700 ? "700" : "400"}
      textAnchor={anchor}
      fill="#000000"
    >
      {children}
    </text>
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

const fwsSvgStyles = `
  .fws-svg-report {
    display: block;
    width: 1123px;
    max-width: none;
    height: 794px;
    margin: 0 auto;
    background: #ffffff;
    color: #000000;
    shape-rendering: crispEdges;
    text-rendering: geometricPrecision;
  }

  .report-page-shell {
    overflow-x: auto;
  }
`;
