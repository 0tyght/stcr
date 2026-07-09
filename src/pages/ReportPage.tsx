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
type RubberType = "latex" | "yellow" | "black" | "angka" | "";
type SmokingPeriodStatus = "under" | "over" | "";
type TemperatureControlStatus = "underControl" | "outOfControl" | "";

type ReportFormState = {
  rubberType: RubberType;
  smokingPeriodStatus: SmokingPeriodStatus;
  temperatureControlStatus: TemperatureControlStatus;
  reason: string;
  reporter: string;
  productionHead: string;
  targetTemperature: number;
  showTargetLine: boolean;
};

const defaultReportForm: ReportFormState = {
  rubberType: "",
  smokingPeriodStatus: "",
  temperatureControlStatus: "",
  reason: "",
  reporter: "",
  productionHead: "",
  targetTemperature: 45,
  showTargetLine: false,
};

const rubberOptions: Array<{ value: Exclude<RubberType, "">; label: string }> = [
  { value: "latex", label: "น้ำยาง" },
  { value: "yellow", label: "ยางเหลือง" },
  { value: "black", label: "ยางดำ" },
  { value: "angka", label: "ยางอังคา" },
];

const smokingPeriodOptions: Array<{
  value: Exclude<SmokingPeriodStatus, "">;
  label: string;
  description: string;
}> = [
  { value: "under", label: "อยู่ในเกณฑ์", description: "Under period" },
  {
    value: "over",
    label: "เกินเกณฑ์ (เกณฑ์การรมควัน = ความชื้นยาง บวกลบ 1 วัน)",
    description: "Over period (+/- 1 day)",
  },
];

const temperatureControlOptions: Array<{
  value: Exclude<TemperatureControlStatus, "">;
  label: string;
  description: string;
}> = [
  { value: "underControl", label: "อยู่ในค่าควบคุม", description: "Under Control" },
  { value: "outOfControl", label: "ไม่อยู่ในค่าควบคุม", description: "Out of Control" },
];

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
  const [reportForm, setReportForm] = useState<ReportFormState>(defaultReportForm);

  const reportRef = useRef<SVGSVGElement | null>(null);

  const cycleOptions = useMemo(() => {
    if (!oven) return [];

    const latest = Math.max(oven.cycleCount || 1, 1);
    return Array.from({ length: latest }, (_, index) => latest - index);
  }, [oven]);

  useEffect(() => {
    if (!oven) return;

    setReportForm((current) => ({
      ...current,
      targetTemperature: Math.round(
        (oven.limits.chamberTemp.upper + oven.limits.chamberTemp.lower) / 2,
      ),
    }));
  }, [oven?.id]);

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
  }, [mode, oven?.id, requestedCycle]);

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

      <ReportFormControls form={reportForm} onChange={setReportForm} />

      <section className="report-page-shell" style={{ overflowX: "auto" }}>
        <FwsSvgReport
          refElement={reportRef}
          oven={oven}
          cycle={selectedCycle}
          cycleRange={cycleRange}
          slots={reportSlots}
          company={company}
          form={reportForm}
        />
      </section>
    </>
  );
}

function ReportFormControls({
  form,
  onChange,
}: {
  form: ReportFormState;
  onChange: (next: ReportFormState) => void;
}) {
  function update<Key extends keyof ReportFormState>(key: Key, value: ReportFormState[Key]) {
    onChange({
      ...form,
      [key]: value,
    });
  }

  return (
    <section className="panel report-form-controls">
      <div className="report-form-controls__header">
        <div>
          <strong>ข้อมูลเพิ่มเติมสำหรับฟอร์ม F-WS-05</strong>
          <span>เลือก/กรอกข้อมูลก่อนดาวน์โหลด PDF ช่องเหล่านี้ไม่บังคับเลือก และกดตัวเดิมซ้ำเพื่อล้างค่าได้</span>
        </div>

        <button
          className="button"
          type="button"
          onClick={() =>
            onChange({
              ...defaultReportForm,
              targetTemperature: form.targetTemperature,
              showTargetLine: false,
            })
          }
        >
          ล้างข้อมูลที่เลือก
        </button>
      </div>

      <div className="report-form-controls__grid">
        <fieldset>
          <legend>ชนิดยาง / Type of rubber</legend>
          <div className="report-choice-row">
            {rubberOptions.map((option) => (
              <label key={option.value} className="report-choice">
                <input
                  type="checkbox"
                  checked={form.rubberType === option.value}
                  onChange={() =>
                    update("rubberType", form.rubberType === option.value ? "" : option.value)
                  }
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>ประเมินวันรมควัน / Smoking period</legend>
          <div className="report-choice-row">
            {smokingPeriodOptions.map((option) => (
              <label key={option.value} className="report-choice">
                <input
                  type="checkbox"
                  checked={form.smokingPeriodStatus === option.value}
                  onChange={() =>
                    update(
                      "smokingPeriodStatus",
                      form.smokingPeriodStatus === option.value ? "" : option.value,
                    )
                  }
                />
                <span>
                  {option.label}
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>อุณหภูมิ / Temperature</legend>
          <div className="report-choice-row">
            {temperatureControlOptions.map((option) => (
              <label key={option.value} className="report-choice">
                <input
                  type="checkbox"
                  checked={form.temperatureControlStatus === option.value}
                  onChange={() =>
                    update(
                      "temperatureControlStatus",
                      form.temperatureControlStatus === option.value ? "" : option.value,
                    )
                  }
                />
                <span>
                  {option.label}
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>อุณหภูมิที่ต้องการ</legend>
          <div className="report-target-row">
            <label className="report-choice">
              <input
                type="checkbox"
                checked={form.showTargetLine}
                onChange={(event) => update("showTargetLine", event.target.checked)}
              />
              <span>แสดงเส้นสีน้ำเงินในกราฟ</span>
            </label>

            <label className="field compact-field">
              <span>ค่าเป้าหมาย (°C)</span>
              <input
                type="number"
                min={graphMinTemp}
                max={graphMaxTemp}
                step={1}
                value={form.targetTemperature}
                onChange={(event) => update("targetTemperature", Number(event.target.value))}
              />
            </label>
          </div>
        </fieldset>

        <label className="field compact-field">
          <span>สาเหตุ</span>
          <input
            value={form.reason}
            onChange={(event) => update("reason", event.target.value)}
            placeholder="ระบุสาเหตุถ้ามี"
          />
        </label>

        <label className="field compact-field">
          <span>ผู้รายงาน</span>
          <input
            value={form.reporter}
            onChange={(event) => update("reporter", event.target.value)}
            placeholder="ชื่อผู้รายงาน"
          />
        </label>

        <label className="field compact-field">
          <span>หัวหน้าฝ่ายผลิต</span>
          <input
            value={form.productionHead}
            onChange={(event) => update("productionHead", event.target.value)}
            placeholder="ชื่อหัวหน้าฝ่ายผลิต"
          />
        </label>
      </div>
    </section>
  );
}

function FwsSvgReport({
  refElement,
  oven,
  cycle,
  cycleRange,
  slots,
  company,
  form,
}: {
  refElement: RefObject<SVGSVGElement | null>;
  oven: Oven;
  cycle: number;
  cycleRange: { start: Date; end: Date };
  slots: ReportSlot[];
  company: ReportCompany;
  form: ReportFormState;
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
          form={form}
        />

        <FwsSvgTemperatureGrid
          y={graphY}
          width={mainW}
          height={graphH}
          slots={slots}
          upper={upper}
          lower={lower}
          form={form}
        />

        <FwsSvgNotes y={noteY} form={form} />
      </g>

      <SvgText x={8} y={779} size={8}>
        F-WS-05 รายงานการตรวจสอบอุณหภูมิเตา Rev.11
      </SvgText>

      <SvgText x={1096} y={779} size={8} anchor="end">
        Effectived Date : 1 Dec 2025
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
  const logoHref = company === "ttn" ? ttnLogo : grLogo;

  return (
    <g>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" stroke="#000000" />
      <line x1={logoW} y1="0" x2={logoW} y2={height} stroke="#000000" />
      <line x1={docX} y1="0" x2={docX} y2={height} stroke="#000000" />
      <line x1={docX} y1={height / 2} x2={width} y2={height / 2} stroke="#000000" />
      <line x1={docX + 92} y1={height / 2} x2={docX + 92} y2={height} stroke="#000000" />

      <image
        href={logoHref}
        x={company === "ttn" ? 52 : 42}
        y={company === "ttn" ? 7 : 6}
        width={company === "ttn" ? 70 : 90}
        height={company === "ttn" ? 62 : 62}
        preserveAspectRatio="xMidYMid meet"
      />

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
  form,
}: {
  y: number;
  width: number;
  height: number;
  oven: Oven;
  cycle: number;
  cycleRange: { start: Date; end: Date };
  form: ReportFormState;
}) {
  return (
    <g transform={`translate(0 ${y})`}>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" stroke="#000000" strokeWidth="0.75" />

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
      <SvgText x={14} y={54} size={8.6}>
        Type of rubber
      </SvgText>

      {rubberOptions.map((item, index) => {
        const x = 88 + index * 50;

        return (
          <g key={item.value}>
            <FwsCheckbox x={x} y={30} checked={form.rubberType === item.value} />
            <SvgText x={x + 6.5} y={62} size={8.7} anchor="middle">
              {item.label}
            </SvgText>
          </g>
        );
      })}

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
  form,
}: {
  y: number;
  width: number;
  height: number;
  slots: ReportSlot[];
  upper: number;
  lower: number;
  form: ReportFormState;
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

  const targetPath = form.showTargetLine
    ? buildLinePath(
        slots.map((slot) => ({
          x: slotToX(slot.index),
          y: tempToY(form.targetTemperature),
        })),
      )
    : "";

  return (
    <g transform={`translate(0 ${y})`}>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" stroke="#000000" strokeWidth="0.8" />

      <line x1={left} y1="0" x2={left} y2={height} stroke="#000000" strokeWidth="0.9" />
      <line x1="0" y1={dayH} x2={width} y2={dayH} stroke="#000000" strokeWidth="0.8" />
      <line x1="0" y1={dayH + timeH} x2={width} y2={dayH + timeH} stroke="#000000" strokeWidth="0.8" />
      <line x1="0" y1={chartTop} x2={width} y2={chartTop} stroke="#000000" strokeWidth="0.9" />
      <line x1="0" y1={chartBottom} x2={width} y2={chartBottom} stroke="#000000" strokeWidth="0.8" />

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
            <line x1={x} y1="0" x2={x} y2={height} stroke="#000000" strokeWidth="1.0" />
            <SvgText x={x + w / 2} y={19} size={10} weight={700} anchor="middle">
              ({dayIndex + 1})
            </SvgText>
          </g>
        );
      })}
      <line x1={width - 0.5} y1="0" x2={width - 0.5} y2={height} stroke="#000000" strokeWidth="0.9" />

      {slots.map((slot) => {
        const x = left + slot.index * cellW;
        const isDayStart = slot.index % timeSlots.length === 0;

        if (isDayStart) {
          return null;
        }

        return (
          <g key={`slot-${slot.index}`}>
            <line
              x1={x}
              y1={dayH}
              x2={x}
              y2={height}
              stroke="#000000"
              strokeWidth="0.38"
            />

            <text
              x={x + cellW / 2 + 2}
              y={dayH + timeH - 5}
              transform={`rotate(-90 ${x + cellW / 2 + 2} ${dayH + timeH - 5})`}
              textAnchor="start"
              fontFamily="Sarabun"
              fontSize="8"
              fontWeight="normal"
              fill="#000000"
            >
              {slot.timeLabel}
            </text>
          </g>
        );
      })}

      {slots
        .filter((slot) => slot.index % timeSlots.length === 0)
        .map((slot) => {
          const x = left + slot.index * cellW;

          return (
            <text
              key={`time-start-${slot.index}`}
              x={x + cellW / 2 + 2}
              y={dayH + timeH - 5}
              transform={`rotate(-90 ${x + cellW / 2 + 2} ${dayH + timeH - 5})`}
              textAnchor="start"
              fontFamily="Sarabun"
              fontSize="8"
              fontWeight="normal"
              fill="#000000"
            >
              {slot.timeLabel}
            </text>
          );
        })}

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
              strokeWidth={isMajor ? 0.9 : isFive ? 0.58 : 0.26}
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
            strokeWidth={index % timeSlots.length === 0 ? 0.85 : 0.26}
          />
        );
      })}

      <SvgText x={22} y={tempToY(50) + 4} size={10} weight={700} anchor="middle">
        รมควัน
      </SvgText>
      <SvgText x={28} y={tempToY(35) + 4} size={10} weight={700} anchor="middle">
        อุ่น
      </SvgText>

      <line x1="0" y1={tempToY(60)} x2="28" y2={tempToY(60)} stroke="#000000" strokeWidth="0.8" />
      <line x1="0" y1={tempToY(40)} x2="28" y2={tempToY(40)} stroke="#000000" strokeWidth="0.8" />

      <g
        data-control-upper-y={tempToY(upper).toFixed(2)}
        data-control-lower-y={tempToY(lower).toFixed(2)}
      />

      {targetPath ? (
        <path d={targetPath} fill="none" stroke="#0f4c81" strokeWidth="1.35" opacity="0.9" />
      ) : null}

      {actualPath ? (
        <path d={actualPath} fill="none" stroke="#d62027" strokeWidth="1.45" opacity="0.96" />
      ) : null}

      {slots
        .filter((slot) => slot.actual !== null)
        .map((slot) => (
          <circle
            key={`actual-${slot.index}`}
            cx={slotToX(slot.index)}
            cy={tempToY(slot.actual ?? graphMinTemp)}
            r="1.25"
            fill="#d62027"
          />
        ))}
    </g>
  );
}

function FwsSvgNotes({ y, form }: { y: number; form: ReportFormState }) {
  return (
    <g transform={`translate(0 ${y})`}>
      <SvgText x={58} y={0} size={8.3} weight={700}>
        * ✕ ไม่สุก (ปากกาสีน้ำเงิน)  ✓ สุก (ปากกาสีแดง)  Ø ยางสุกแล้วยังไม่ออกเตา (อุ่นใช้ปากกาสีแดง)
      </SvgText>

      <SvgText x={58} y={12} size={8.3} weight={700}>
        ** ควบคุมอุณหภูมิ: [รมควัน] 40 - 60°C, [อุ่นยาง] 35-40°C
      </SvgText>

      <SvgText x={58} y={25} size={8.1}>
        After the 3rd day of smoking, control the temperature between 40 - 55 °C.
      </SvgText>

      <SvgText x={58} y={38} size={8.0}>
        (ประเมินอุณหภูมิวันที่ 3 หลังปิดเตา 2 วัน / เกณฑ์การรมควัน = ความชื้นยาง บวกลบ 1 วัน)
      </SvgText>

      <SvgText x={58} y={59} size={8.8} weight={700}>
        ประเมินวันรมควัน
      </SvgText>
      <SvgText x={58} y={71} size={7.8}>
        Smoking period
      </SvgText>

      <FwsCheckbox x={178} y={49} size={10} checked={form.smokingPeriodStatus === "under"} />
      <SvgText x={193} y={59} size={8.8} weight={700}>
        อยู่ในเกณฑ์
      </SvgText>
      <SvgText x={193} y={71} size={7.8}>
        Under period
      </SvgText>

      <FwsCheckbox x={315} y={49} size={10} checked={form.smokingPeriodStatus === "over"} />
      <SvgText x={330} y={59} size={8.4}>
        เกินเกณฑ์ (เกณฑ์การรมควัน = ความชื้นยาง บวกลบ 1 วัน)
      </SvgText>
      <SvgText x={330} y={71} size={7.8}>
        Over period (+/- 1 day)
      </SvgText>

      <SvgText x={58} y={91} size={8.8} weight={700}>
        อุณหภูมิ
      </SvgText>
      <SvgText x={58} y={103} size={7.8}>
        Temperature
      </SvgText>

      <FwsCheckbox x={178} y={81} size={10} checked={form.temperatureControlStatus === "underControl"} />
      <SvgText x={193} y={91} size={8.8} weight={700}>
        อยู่ในค่าควบคุม
      </SvgText>
      <SvgText x={193} y={103} size={7.8}>
        Under Control
      </SvgText>

      <FwsCheckbox x={315} y={81} size={10} checked={form.temperatureControlStatus === "outOfControl"} />
      <SvgText x={330} y={91} size={8.8} weight={700}>
        ไม่อยู่ในค่าควบคุม
      </SvgText>
      <SvgText x={330} y={103} size={7.8}>
        Out of Control
      </SvgText>

      <SvgText x={760} y={59} size={8.8} weight={800}>
        สีน้ำเงิน = อุณหภูมิที่ต้องการ : หัวหน้างาน
      </SvgText>
      <SvgText x={760} y={82} size={8.8} weight={800}>
        สีแดง = อุณหภูมิจริง : พนักงานคุมเตา
      </SvgText>

      <SvgText x={350} y={116} size={9.4} weight={700}>
        สาเหตุ
      </SvgText>
      <DottedLine x={390} y={116} width={430} />
      {form.reason ? (
        <SvgText x={400} y={113} size={8.4}>
          {form.reason}
        </SvgText>
      ) : null}

      <SvgText x={290} y={131} size={9.6} weight={700}>
        ผู้รายงาน
      </SvgText>
      <DottedLine x={345} y={131} width={210} />
      {form.reporter ? (
        <SvgText x={355} y={128} size={8.4}>
          {form.reporter}
        </SvgText>
      ) : null}

      <SvgText x={650} y={131} size={9.6} weight={700}>
        หัวหน้าฝ่ายผลิต
      </SvgText>
      <DottedLine x={740} y={131} width={245} />
      {form.productionHead ? (
        <SvgText x={750} y={128} size={8.4}>
          {form.productionHead}
        </SvgText>
      ) : null}
    </g>
  );
}

function FwsCheckbox({
  x,
  y,
  size = 13,
  checked = false,
}: {
  x: number;
  y: number;
  size?: number;
  checked?: boolean;
}) {
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} fill="#ffffff" stroke="#000000" strokeWidth="0.9" />
      {checked ? (
        <path
          d={`M ${x + size * 0.18} ${y + size * 0.58} L ${x + size * 0.42} ${y + size * 0.82} L ${x + size * 0.86} ${y + size * 0.18}`}
          fill="none"
          stroke="#000000"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </g>
  );
}

function DottedLine({ x, y, width }: { x: number; y: number; width: number }) {
  return (
    <line
      x1={x}
      y1={y}
      x2={x + width}
      y2={y}
      stroke="#000000"
      strokeWidth="0.65"
      strokeDasharray="1.4 2.0"
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
    shape-rendering: geometricPrecision;
    text-rendering: optimizeLegibility;
  }

  .report-page-shell {
    overflow-x: auto;
  }

  .report-form-controls {
    margin-bottom: 18px;
  }

  .report-form-controls__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 14px;
  }

  .report-form-controls__header strong {
    display: block;
    margin-bottom: 4px;
  }

  .report-form-controls__header span {
    color: var(--muted);
    font-size: 13px;
  }

  .report-form-controls__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .report-form-controls fieldset {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 12px;
    margin: 0;
    background: var(--surface-soft);
  }

  .report-form-controls legend {
    padding: 0 6px;
    font-size: 13px;
    font-weight: 800;
    color: var(--ink-strong);
  }

  .report-choice-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
  }

  .report-choice {
    display: inline-flex;
    align-items: flex-start;
    gap: 7px;
    font-size: 13px;
    color: var(--ink-strong);
  }

  .report-choice input {
    margin-top: 2px;
  }

  .report-choice small {
    display: block;
    margin-top: 2px;
    color: var(--muted);
    font-size: 11px;
  }

  .report-target-row {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) 140px;
    gap: 12px;
    align-items: end;
  }

  @media (max-width: 980px) {
    .report-form-controls__grid {
      grid-template-columns: 1fr;
    }
  }
`;
