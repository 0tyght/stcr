import JSZip from "jszip";
import { Download, FileArchive, FileDown, Lock, RefreshCw, Unlock } from "lucide-react";
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

import { useAppData } from "../app/providers";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { getCurrentCompany, type CompanyConfig } from "../config/companies";
import { apiClient } from "../services/apiClient";
import {
  createLandscapePdfBlobFromSvg,
  downloadBlob,
} from "../services/pdfExport";
import type { Oven, SensorKey, TimeSeriesPoint } from "../types";
import { clampCycleStart, getHistoricalCycleRange, REPORT_CYCLE_MS } from "../utils/reportCycle";
import { allSensorKeys } from "../utils/sensors";

type ReportMode = "current" | "history";
type HistoricalDownloadMode = "single" | "range";
type SvgTextAnchor = "start" | "middle" | "end";

type SaveFileHandleLike = {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
  }>;
};

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SaveFileHandleLike>;
};

type RubberType =
  | "latex"
  | "yellow"
  | "black"
  | "angka"
  | "uss97"
  | "uss96"
  | "uss94"
  | "";
type SmokingPeriodStatus = "under" | "over" | "notReached" | "";
type TemperatureControlStatus = "underControl" | "outOfControl" | "";

type ReportFormState = {
  rubberType: RubberType;
  smokingPeriodStatus: SmokingPeriodStatus;
  temperatureControlStatus: TemperatureControlStatus;
  reason: string;
  inputNetWeight: string;
  outputNetWeight: string;
  documentNo: string;
  targetTemperature: number;
  showTargetLine: boolean;
};

const defaultReportForm: ReportFormState = {
  rubberType: "",
  smokingPeriodStatus: "",
  temperatureControlStatus: "",
  reason: "",
  inputNetWeight: "",
  outputNetWeight: "",
  documentNo: "F-WS-05 Rev.11",
  targetTemperature: 45,
  showTargetLine: false,
};

type RubberOption = {
  value: Exclude<RubberType, "">;
  label: string;
  description?: string;
};

const grRubberOptions: RubberOption[] = [
  { value: "latex", label: "น้ำยาง" },
  { value: "yellow", label: "ยางเหลือง" },
  { value: "black", label: "ยางดำ" },
  { value: "angka", label: "ยางอังคา" },
];

const ttnRubberOptions: RubberOption[] = [
  { value: "uss97", label: "USS ≥ 97%" },
  { value: "uss96", label: "USS ≥ 96%", description: "แต่ < 97%" },
  { value: "uss94", label: "USS ≥ 94%", description: "แต่ < 96% (ควบคุมพิเศษ)" },
];

function getRubberOptions(company: CompanyConfig): RubberOption[] {
  return company.id === "ttn" ? ttnRubberOptions : grRubberOptions;
}

const smokingPeriodOptions: Array<{
  value: Exclude<SmokingPeriodStatus, "">;
  label: string;
  description: string;
}> = [
  { value: "under", label: "อยู่ในเกณฑ์", description: "" },
  {
    value: "over",
    label: "เกินเกณฑ์",
    description: "เกณฑ์รมควัน = ระยะเวลาการรมควันเกินที่ WI กำหนด (WI-WS-06)",
  },
  {
    value: "notReached",
    label: "ไม่ถึงเกณฑ์",
    description: "เกณฑ์รมควัน = ระยะเวลาการรมควันไม่ถึงเกณฑ์ที่ WI กำหนด (WI-WS-06)",
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

async function requestSaveFile(
  filename: string,
  description: string,
  mimeType: string,
  extension: string,
): Promise<SaveFileHandleLike | null | undefined> {
  const picker = (window as SavePickerWindow).showSaveFilePicker;

  if (!picker) return undefined;

  try {
    return await picker.call(window, {
      suggestedName: filename,
      types: [
        {
          description,
          accept: { [mimeType]: [extension] },
        },
      ],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

async function saveBlob(
  blob: Blob,
  filename: string,
  handle: SaveFileHandleLike | null | undefined,
): Promise<boolean> {
  if (handle === null) return false;

  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  downloadBlob(blob, filename);
  return true;
}

function createCsvBlob(points: TimeSeriesPoint[], sensors: SensorKey[]): Blob {
  const header = ["timestamp", ...sensors];
  const rows = points.map((point) => [
    point.timestamp,
    ...sensors.map((sensor) => point[sensor]),
  ]);
  const csv = [header, ...rows].map((row) => row.join(",")).join("\n");

  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}

export function ReportPage() {
  const { ovens } = useAppData();
  const [searchParams, setSearchParams] = useSearchParams();

  const company = useMemo(() => getCurrentCompany(), []);

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
  const [reportError, setReportError] = useState("");
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [autoDownloaded, setAutoDownloaded] = useState(false);
  const [reportForm, setReportForm] = useState<ReportFormState>(defaultReportForm);

  const reportRef = useRef<SVGSVGElement | null>(null);

  const cycleOptions = useMemo(() => {
    if (!oven) return [];

    const latest = mode === "current"
      ? Math.max(oven.cycleCount || 1, 1)
      : getDefaultHistoricalCycle(oven);
    const availableCycleCount = mode === "current" ? 1 : latest;
    return Array.from({ length: availableCycleCount }, (_, index) => latest - index);
  }, [mode, oven]);

  const updateReportLocation = useCallback(
    ({ nextOvenId, nextMode }: { nextOvenId?: string; nextMode?: ReportMode }) => {
      const next = new URLSearchParams(searchParams);
      if (nextOvenId) next.set("ovenId", nextOvenId);
      if (nextMode) next.set("mode", nextMode);
      next.delete("cycle");
      next.delete("auto");
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

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

    if (mode === "current" && !oven.reportStartedAt) {
      setPoints([]);
      setReportError("รอบปัจจุบันยังอยู่ในช่วงจุดไฟและยังไม่เริ่มบันทึกรายงาน");
      return;
    }

    setLoadingReport(true);
    setReportError("");

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
      if (!nextPoints.length) {
        setReportError("ไม่พบข้อมูลที่บันทึกไว้สำหรับรอบอบนี้");
      }
    } catch (error) {
      setPoints([]);
      setReportError(error instanceof Error ? error.message : "โหลดข้อมูลรายงานไม่สำเร็จ");
    } finally {
      setLoadingReport(false);
    }
  }, [cycleRange, mode, oven, selectedCycle]);

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

      const filename = createPdfFilename(company, safeCycle, range.start);

      const blob = await createLandscapePdfBlobFromSvg(reportRef.current);

      return { blob, filename };
    },
    [company, mode, oven],
  );

  const downloadSelectedPdf = useCallback(
    async (chooseLocation = true) => {
      if (!oven || selectedCycle == null) return;

      const safeCycle = clampCycleNumber(selectedCycle, oven);
      const range = getCycleRange(oven, mode, safeCycle);
      const filename = createPdfFilename(company, safeCycle, range.start);

      const fileHandle = chooseLocation
        ? await requestSaveFile(filename, "PDF document", "application/pdf", ".pdf")
        : undefined;

      if (fileHandle === null) return;

      setDownloadingPdf(true);
      setDownloadMessage("กำลังสร้าง PDF...");

      try {
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

        const blob = await createLandscapePdfBlobFromSvg(reportRef.current);
        await saveBlob(blob, filename, fileHandle);
      } finally {
        setDownloadMessage("");
        setDownloadingPdf(false);
      }
    },
    [company, mode, oven, selectedCycle],
  );

  const downloadHistoricalRangeZip = useCallback(async () => {
    if (!oven || rangeFromCycle == null || rangeToCycle == null) return;

    const cycles = getCycleRangeList(rangeFromCycle, rangeToCycle, oven);
    if (!cycles.length) return;

    const high = Math.max(rangeFromCycle, rangeToCycle);
    const low = Math.min(rangeFromCycle, rangeToCycle);
    const filename = `${company.shortName}-รอบที่-${high}-ถึง-${low}.zip`;
    const fileHandle = await requestSaveFile(
      filename,
      "ZIP archive",
      "application/zip",
      ".zip",
    );

    if (fileHandle === null) return;

    setDownloadingPdf(true);

    try {
      const zip = new JSZip();
      const folder = zip.folder(`${company.shortName}-เตา-${oven.number}`) ?? zip;

      for (const [index, cycle] of cycles.entries()) {
        setDownloadMessage(`กำลังสร้างไฟล์ ${index + 1}/${cycles.length} · รอบ ${cycle}`);

        const { blob, filename: pdfFilename } = await renderCycleAndCreatePdfBlob(cycle);
        folder.file(pdfFilename, blob);

        await waitForRender(120);
      }

      setDownloadMessage("กำลังรวมไฟล์เป็น ZIP...");

      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      await saveBlob(zipBlob, filename, fileHandle);
    } finally {
      setDownloadMessage("");
      setDownloadingPdf(false);
    }
  }, [company, oven, rangeFromCycle, rangeToCycle, renderCycleAndCreatePdfBlob]);

  const downloadCurrentCsv = useCallback(async () => {
    if (!oven || selectedCycle == null || !points.length) return;

    const filename = `F-WS-05-${oven.name}-cycle-${selectedCycle}.csv`;
    const fileHandle = await requestSaveFile(
      filename,
      "CSV document",
      "text/csv",
      ".csv",
    );

    if (fileHandle === null) return;

    const blob = createCsvBlob(points, reportSensors);
    await saveBlob(blob, filename, fileHandle);
  }, [oven, points, selectedCycle]);

  useEffect(() => {
    if (!autoPdf || autoDownloaded || loadingReport || !points.length || !oven) return;

    setAutoDownloaded(true);

    window.setTimeout(() => {
      void downloadSelectedPdf(false);
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

  if (mode === "current" && !oven.reportStartedAt) {
    return (
      <main className={`report-page report-page--${company.id}`}>
        <style>{reportPageStyles}</style>
        <PageHeader
          title="รายงานรอบปัจจุบัน"
          description={`${oven.name} · รอบ ${oven.cycleCount}`}
          actions={
            <Link className="button" to={`/ovens/${oven.id}`}>
              กลับหน้ารายละเอียดเตา
            </Link>
          }
        />
        <ReportSelectionToolbar
          ovens={ovens}
          oven={oven}
          mode={mode}
          selectedCycle={selectedCycle}
          cycleOptions={cycleOptions}
          disabled={loadingReport || downloadingPdf}
          onOvenChange={(nextOvenId) => updateReportLocation({ nextOvenId })}
          onModeChange={(nextMode) => updateReportLocation({ nextMode })}
          onCycleChange={setSelectedCycle}
        />
        <EmptyState
          title="ยังไม่เริ่มบันทึกรอบรายงาน"
          description="เตากำลังอยู่ในช่วงจุดไฟหรืออุ่นระบบ กราฟเรียลไทม์ยังดูได้ตามปกติ และรายงานจะพร้อมเมื่ออุณหภูมิห้องอบถึงช่วงที่กำหนด"
        />
      </main>
    );
  }

  const rangeCycles =
    rangeFromCycle != null && rangeToCycle != null
      ? getCycleRangeList(rangeFromCycle, rangeToCycle, oven)
      : [];

  return (
    <main className={`report-page report-page--${company.id}`}>
      <style>{reportPageStyles}</style>

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
              onClick={() => void downloadCurrentCsv()}
              disabled={loadingReport || !points.length || downloadingPdf}
            >
              <Download size={17} />
              ส่งออก CSV
            </button>
          </>
        }
      />

      <ReportSelectionToolbar
        ovens={ovens}
        oven={oven}
        mode={mode}
        selectedCycle={selectedCycle}
        cycleOptions={cycleOptions}
        disabled={loadingReport || downloadingPdf}
        onOvenChange={(nextOvenId) => updateReportLocation({ nextOvenId })}
        onModeChange={(nextMode) => updateReportLocation({ nextMode })}
        onCycleChange={(cycle) => {
          setSelectedCycle(cycle);
          setRangeFromCycle(cycle);
          setRangeToCycle(cycle);
        }}
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
          <div className="report-history-panel">
            <div className="report-history-controls">
              <div className="report-history-tabs">
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

              {historicalDownloadMode === "single" ? (
                <label className="field compact-field report-cycle-field">
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
              ) : (
                <>
                  <label className="field compact-field report-cycle-field">
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

                  <label className="field compact-field report-cycle-field">
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
                </>
              )}

              {historicalDownloadMode === "single" ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => void downloadSelectedPdf()}
                  disabled={downloadingPdf || loadingReport}
                >
                  <FileDown size={17} />
                  {downloadingPdf ? "กำลังโหลด..." : "ดาวน์โหลดรอบนี้"}
                </button>
              ) : (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => void downloadHistoricalRangeZip()}
                  disabled={downloadingPdf || loadingReport || !rangeCycles.length}
                >
                  <FileArchive size={17} />
                  {downloadingPdf ? "กำลังรวม ZIP..." : `ดาวน์โหลด ZIP (${rangeCycles.length} รอบ)`}
                </button>
              )}

              <button
                className="button button-dark report-preview-refresh"
                type="button"
                onClick={() => void loadReport()}
                disabled={loadingReport || downloadingPdf}
              >
                <RefreshCw size={17} />
                โหลดพรีวิวใหม่
              </button>
            </div>

            {downloadMessage ? (
              <p className="report-history-note is-active">
                {downloadMessage}
              </p>
            ) : (
              <p className="report-history-note">
                โหมดหลายรอบจะรวม PDF เป็น ZIP โดยแยก 1 ไฟล์ต่อ 1 รอบ
              </p>
            )}
          </div>
        )}
      </section>

      {reportError ? (
        <section className="panel" role="status">
          <EmptyState title="ยังไม่มีข้อมูลรายงาน" description={reportError} />
        </section>
      ) : null}

      <ReportFormControls
        form={reportForm}
        company={company}
        onChange={setReportForm}
      />

      <section className="report-page-shell">
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
    </main>
  );
}

function ReportSelectionToolbar({
  ovens,
  oven,
  mode,
  selectedCycle,
  cycleOptions,
  disabled,
  onOvenChange,
  onModeChange,
  onCycleChange,
}: {
  ovens: Oven[];
  oven: Oven;
  mode: ReportMode;
  selectedCycle: number | null;
  cycleOptions: number[];
  disabled: boolean;
  onOvenChange: (ovenId: string) => void;
  onModeChange: (mode: ReportMode) => void;
  onCycleChange: (cycle: number) => void;
}) {
  return (
    <section className="panel report-selection-toolbar" aria-label="เลือกข้อมูลรายงาน">
      <div className="report-selection-toolbar__heading">
        <strong>เลือกรายงานที่ต้องการ</strong>
        <span>เลือกเตาและรอบได้จากหน้านี้โดยตรง</span>
      </div>

      <label className="field compact-field">
        <span>เตา</span>
        <select
          value={oven.id}
          disabled={disabled}
          onChange={(event) => onOvenChange(event.target.value)}
        >
          {ovens.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field compact-field">
        <span>ประเภทรอบ</span>
        <select
          value={mode}
          disabled={disabled}
          onChange={(event) => onModeChange(event.target.value as ReportMode)}
        >
          <option value="current">รอบปัจจุบัน</option>
          <option value="history">รอบย้อนหลัง</option>
        </select>
      </label>

      <label className="field compact-field">
        <span>รอบที่</span>
        <select
          value={selectedCycle ?? ""}
          disabled={disabled || !cycleOptions.length}
          onChange={(event) => onCycleChange(Number(event.target.value))}
        >
          {cycleOptions.map((cycle) => (
            <option key={cycle} value={cycle}>
              รอบ {cycle}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function ReportFormControls({
  form,
  company,
  onChange,
}: {
  form: ReportFormState;
  company: CompanyConfig;
  onChange: (next: ReportFormState) => void;
}) {
  const [documentNoLocked, setDocumentNoLocked] = useState(true);
  const rubberOptions = getRubberOptions(company);
  function update<Key extends keyof ReportFormState>(key: Key, value: ReportFormState[Key]) {
    onChange({
      ...form,
      [key]: value,
    });
  }

  return (
    <section className="panel report-form-controls">
      <div className="report-form-controls__header">
        <div className="report-form-controls__heading">
          <strong>ข้อมูลเพิ่มเติมสำหรับฟอร์ม F-WS-05</strong>
          <span>เลือกเฉพาะข้อมูลที่ต้องการแสดงในเอกสาร ช่องทั้งหมดไม่บังคับกรอก</span>
        </div>

        <button
          className="button report-clear-button"
          type="button"
          onClick={() =>
            onChange({
              ...defaultReportForm,
              documentNo: form.documentNo,
              targetTemperature: form.targetTemperature,
              showTargetLine: false,
            })
          }
        >
          ล้างข้อมูล
        </button>
      </div>

      <div className="report-form-controls__grid">
        <fieldset className="report-form-group report-form-group--rubber">
          <legend>ชนิดยาง <span>/ Type of rubber</span></legend>

          <div className="report-choice-row report-choice-row--rubber">
            {rubberOptions.map((option) => (
              <label key={option.value} className="report-choice report-choice--chip">
                <input
                  type="checkbox"
                  checked={form.rubberType === option.value}
                  onChange={() =>
                    update("rubberType", form.rubberType === option.value ? "" : option.value)
                  }
                />
                <span className="report-choice__content">
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="report-form-group report-form-group--smoking">
          <legend>ประเมินวันรมควัน <span>/ Smoking period</span></legend>

          <div className="report-choice-list">
            {smokingPeriodOptions.map((option) => (
              <label key={option.value} className="report-choice report-choice--option">
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

                <span className="report-choice__content">
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="report-form-group report-form-group--temperature">
          <legend>อุณหภูมิ <span>/ Temperature</span></legend>

          <div className="report-choice-row report-choice-row--temperature">
            {temperatureControlOptions.map((option) => (
              <label key={option.value} className="report-choice report-choice--option">
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

                <span className="report-choice__content">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="report-form-group report-form-group--target">
          <legend>อุณหภูมิที่ต้องการ</legend>

          <div className="report-target-row">
            <label className="report-target-toggle">
              <input
                type="checkbox"
                checked={form.showTargetLine}
                onChange={(event) => update("showTargetLine", event.target.checked)}
              />

              <span>
                <strong>แสดงเส้นสีน้ำเงินในกราฟ</strong>
                <small>เปิดใช้เมื่อต้องการระบุค่าเป้าหมายในเอกสาร</small>
              </span>
            </label>

            <label className="field compact-field report-target-value">
              <span>ค่าเป้าหมาย (°C)</span>
              <input
                type="number"
                min={graphMinTemp}
                max={graphMaxTemp}
                step={1}
                value={form.targetTemperature}
                disabled={!form.showTargetLine}
                onChange={(event) => update("targetTemperature", Number(event.target.value))}
              />
            </label>
          </div>
        </fieldset>
      </div>

      <div className="report-form-fields">
        <label className="field compact-field report-form-field report-form-field--reason">
          <span>สาเหตุ</span>
          <input
            value={form.reason}
            onChange={(event) => update("reason", event.target.value)}
            placeholder="ระบุสาเหตุถ้ามี"
          />
        </label>

        <label className="field compact-field report-form-field">
          <span>ปริมาณน้ำหนักยางเข้าเตา (Net Weight)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={form.inputNetWeight}
            onChange={(event) => update("inputNetWeight", event.target.value)}
            placeholder="กิโลกรัม"
          />
        </label>

        <label className="field compact-field report-form-field">
          <span>ปริมาณน้ำหนักยางออกเตา (Net Weight)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={form.outputNetWeight}
            onChange={(event) => update("outputNetWeight", event.target.value)}
            placeholder="กิโลกรัม"
          />
        </label>

        <div className="report-document-field">
          <label className="field compact-field report-form-field">
            <span>Document No.</span>
            <input
              value={form.documentNo}
              readOnly={documentNoLocked}
              aria-readonly={documentNoLocked}
              onChange={(event) => update("documentNo", event.target.value)}
            />
          </label>

          <button
            className={`button report-document-lock ${documentNoLocked ? "is-locked" : ""}`}
            type="button"
            aria-pressed={!documentNoLocked}
            title={documentNoLocked ? "ปลดล็อกเพื่อแก้ไข Document No." : "ล็อก Document No."}
            onClick={() => setDocumentNoLocked((locked) => !locked)}
          >
            {documentNoLocked ? <Lock size={16} /> : <Unlock size={16} />}
            {documentNoLocked ? "ล็อกอยู่" : "กำลังแก้ไข"}
          </button>
        </div>
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
  company: CompanyConfig;
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

        <FwsSvgHeader width={mainW} height={headerH} company={company} form={form} />

        <FwsSvgMeta
          y={metaY}
          width={mainW}
          height={metaH}
          oven={oven}
          cycle={cycle}
          cycleRange={cycleRange}
          company={company}
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
        {form.documentNo} รายงานการตรวจสอบอุณหภูมิเตา
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
  form,
}: {
  width: number;
  height: number;
  company: CompanyConfig;
  form: ReportFormState;
}) {
  const logoW = 174;
  const docW = 205;
  const titleW = width - logoW - docW;
  const docX = logoW + titleW;
  const logoBox = company.report.logoBox;

  return (
    <g>
      <defs>
        <clipPath id="report-logo-frame-clip">
          <rect x="1" y="1" width={logoW - 2} height={height - 2} />
        </clipPath>
      </defs>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" stroke="#000000" />
      <line x1={logoW} y1="0" x2={logoW} y2={height} stroke="#000000" />
      <line x1={docX} y1="0" x2={docX} y2={height} stroke="#000000" />
      <line x1={docX} y1={height / 2} x2={width} y2={height / 2} stroke="#000000" />
      <line x1={docX + 92} y1={height / 2} x2={docX + 92} y2={height} stroke="#000000" />

      <image
        href={company.report.logo}
        x={logoBox.x}
        y={logoBox.y}
        width={logoBox.width}
        height={logoBox.height}
        preserveAspectRatio="xMidYMid meet"
        clipPath="url(#report-logo-frame-clip)"
      />

      <SvgText x={logoW + titleW / 2} y={43} size={16} weight={800} anchor="middle">
        รายงานการตรวจสอบอุณหภูมิเตา
      </SvgText>

      <SvgText x={docX + docW / 2} y={17} size={10} weight={800} anchor="middle">
        Document No.
      </SvgText>
      <SvgText x={docX + docW / 2} y={34} size={11} weight={800} anchor="middle">
        {form.documentNo}
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
  company,
  form,
}: {
  y: number;
  width: number;
  height: number;
  oven: Oven;
  cycle: number;
  cycleRange: { start: Date; end: Date };
  company: CompanyConfig;
  form: ReportFormState;
}) {
  const rubberOptions = getRubberOptions(company);

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

      {company.id === "ttn"
        ? rubberOptions.map((item, index) => {
            const x = 90 + index * 78;

            return (
              <g key={item.value}>
                <FwsCheckbox x={x} y={27} checked={form.rubberType === item.value} />
                <SvgText x={x + 6.5} y={53} size={7.8} anchor="middle">
                  {item.label}
                </SvgText>
                {item.description ? (
                  <SvgText x={x + 6.5} y={66} size={7.1} anchor="middle">
                    {item.description}
                  </SvgText>
                ) : null}
              </g>
            );
          })
        : rubberOptions.map((item, index) => {
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
      {form.inputNetWeight ? (
        <SvgText x={685} y={40} size={10.5} weight={700} anchor="middle">
          {form.inputNetWeight}
        </SvgText>
      ) : null}
      <SvgText x={805} y={43} size={11} weight={700}>
        (ก.ก.)
      </SvgText>

      <SvgText x={335} y={66} size={11} weight={700}>
        ปริมาณน้ำหนักยางออกเตา (Net Weight) :
      </SvgText>
      <DottedLine x={570} y={66} width={230} />
      {form.outputNetWeight ? (
        <SvgText x={685} y={63} size={10.5} weight={700} anchor="middle">
          {form.outputNetWeight}
        </SvgText>
      ) : null}
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

  // ลดเฉพาะความสูงช่องเวลา แต่คงแถวว่างระหว่าง "เวลา" กับ "อุณหภูมิ"
  const timeH = 38;
  const tickRowH = 13;
  const tempHeaderH = 26;

  // เพิ่มพื้นที่กราฟจากส่วนของช่องเวลาที่ลดลง
  // โดยคงตำแหน่งส่วนล่างของตารางไว้เท่าเดิม
  const chartTop = dayH + timeH + tickRowH + tempHeaderH;
  const chartH = 303;
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
      <line
        x1="0"
        y1={dayH + timeH + tickRowH}
        x2={width}
        y2={dayH + timeH + tickRowH}
        stroke="#000000"
        strokeWidth="0.8"
      />
      <line x1="0" y1={chartTop} x2={width} y2={chartTop} stroke="#000000" strokeWidth="0.9" />
      <line x1="0" y1={chartBottom} x2={width} y2={chartBottom} stroke="#000000" strokeWidth="0.8" />

      <SvgText x={22} y={19} size={11} weight={700} anchor="middle">
        วัน
      </SvgText>
      <SvgText x={22} y={dayH + timeH / 2 + 4} size={11} weight={700} anchor="middle">
        เวลา
      </SvgText>
      <SvgText x={28} y={dayH + timeH + tickRowH + tempHeaderH / 2 + 4} size={10.5} weight={700} anchor="middle">
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
              y={dayH + timeH - 4}
              transform={`rotate(-90 ${x + cellW / 2 + 2} ${dayH + timeH - 4})`}
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
              y={dayH + timeH - 4}
              transform={`rotate(-90 ${x + cellW / 2 + 2} ${dayH + timeH - 4})`}
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
              <SvgText
                x={left - 7}
                y={temp === graphMaxTemp ? lineY + 9.5 : temp === graphMinTemp ? lineY - 2.5 : lineY + 3.2}
                size={9.5}
                weight={700}
                anchor="end"
              >
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

      {(() => {
        const bx = 20;
        const by = (tempToY(60) + tempToY(40)) / 2;
        return (
          <text
            x={bx}
            y={by}
            transform={`rotate(-90 ${bx} ${by})`}
            textAnchor="middle"
            fontFamily="Sarabun"
            fontSize="10"
            fontWeight="bold"
            fill="#000000"
          >
            รมควัน
          </text>
        );
      })()}

      {(() => {
        const bx = 24;
        const by = (tempToY(40) + tempToY(30)) / 2;
        return (
          <text
            x={bx}
            y={by}
            transform={`rotate(-90 ${bx} ${by})`}
            textAnchor="middle"
            fontFamily="Sarabun"
            fontSize="10"
            fontWeight="bold"
            fill="#000000"
          >
            อุ่น
          </text>
        );
      })()}

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
      {/* หมายเหตุด้านบน: ใช้เพียง 2 บรรทัด และไม่มีเส้นแบ่งคอลัมน์ */}
      <SvgText x={58} y={0} size={8.1} weight={700}>
        * ✕ ไม่สุก (ปากกาสีน้ำเงิน) / ✓ สุก (ปากกาสีแดง)   Ø ยางสุกแล้วยังไม่ออกเตา (อุ่นใช้ปากกาสีแดง)
      </SvgText>

      <SvgText x={58} y={14} size={8.1} weight={700}>
        ** ควบคุมอุณหภูมิ: [รมควัน] 40 - 60°C, [อุ่นยาง] 35 - 40°C
      </SvgText>

      {/* ข้อความด้านขวา */}
      <SvgText x={590} y={0} size={7.6}>
        After the 3rd day of smoking, control the temperature between 40 - 55 °C.
      </SvgText>

      <SvgText x={590} y={14} size={7.0}>
        (ประเมินอุณหภูมิวันที่ 3 หลังปิดเตา 2 วัน / เกณฑ์การรมควัน = ความชื้นยาง บวกลบ 1 วัน)
      </SvgText>

      {/* ประเมินวันรมควัน: 3 ตัวเลือกตามแบบฟอร์มต้นฉบับ (WI-WS-06) */}
      <SvgText x={58} y={32} size={8.8} weight={700}>
        ประเมินวันรมควัน
      </SvgText>

      <FwsCheckbox x={178} y={22} size={10} checked={form.smokingPeriodStatus === "under"} />

      <SvgText x={193} y={32} size={8.5} weight={700}>
        อยู่ในเกณฑ์
      </SvgText>

      <FwsCheckbox x={270} y={22} size={10} checked={form.smokingPeriodStatus === "over"} />

      <SvgText x={285} y={32} size={8} weight={700}>
        เกินเกณฑ์ (เกณฑ์รมควัน = ระยะเวลาการรมควันเกินที่ WI กำหนด (WI-WS-06))
      </SvgText>

      <FwsCheckbox x={270} y={36} size={10} checked={form.smokingPeriodStatus === "notReached"} />

      <SvgText x={285} y={46} size={8} weight={700}>
        ไม่ถึงเกณฑ์ (เกณฑ์รมควัน = ระยะเวลาการรมควันไม่ถึงเกณฑ์ที่ WI กำหนด (WI-WS-06))
      </SvgText>

      {/* ประเมินอุณหภูมิ: จัดให้อยู่แถวเดียว */}
      <SvgText x={58} y={62} size={8.8} weight={700}>
        อุณหภูมิ
      </SvgText>

      <FwsCheckbox
        x={178}
        y={52}
        size={10}
        checked={form.temperatureControlStatus === "underControl"}
      />

      <SvgText x={193} y={62} size={8.5} weight={700}>
        อยู่ในค่าควบคุม / Under Control
      </SvgText>

      <FwsCheckbox
        x={405}
        y={52}
        size={10}
        checked={form.temperatureControlStatus === "outOfControl"}
      />

      <SvgText x={420} y={62} size={8.5} weight={700}>
        ไม่อยู่ในค่าควบคุม / Out of Control
      </SvgText>

      {/* คำอธิบายสี */}
      <SvgText x={760} y={32} size={8.4} weight={800}>
        สีน้ำเงิน = อุณหภูมิที่ต้องการ : หัวหน้างาน
      </SvgText>

      <SvgText x={760} y={62} size={8.4} weight={800}>
        สีแดง = อุณหภูมิจริง : พนักงานคุมเตา
      </SvgText>

      {/* สาเหตุ */}
      <SvgText x={350} y={80} size={9.2} weight={700}>
        สาเหตุ
      </SvgText>

      <DottedLine x={390} y={80} width={430} />

      {form.reason ? (
        <SvgText x={400} y={77} size={8.4}>
          {form.reason}
        </SvgText>
      ) : null}

      {/* ลายเซ็นอยู่ภายในกรอบ */}
      <SvgText x={290} y={100} size={9.4} weight={700}>
        ผู้รายงาน
      </SvgText>

      <DottedLine x={345} y={100} width={210} />

      <SvgText x={650} y={100} size={9.4} weight={700}>
        หัวหน้าฝ่ายผลิต
      </SvgText>

      <DottedLine x={740} y={100} width={245} />
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

  return getHistoricalCycleRange(oven, cycleNumber);
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
  const buddhistShortYear = String(value.getFullYear() + 543).slice(-2);
  return `${String(value.getDate()).padStart(2, "0")}-${String(value.getMonth() + 1).padStart(
    2,
    "0",
  )}-${buddhistShortYear}`;
}

function createPdfFilename(company: CompanyConfig, cycle: number, start: Date): string {
  const date = `${String(start.getDate()).padStart(2, "0")}-${String(
    start.getMonth() + 1,
  ).padStart(2, "0")}-${start.getFullYear()}`;
  return `${company.shortName}-${cycle}-${date}.pdf`;
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

const reportPageStyles = `
  .report-page {
    display: grid;
    gap: 12px;
    min-width: 0;
  }

  .report-page .report-cycle-toolbar,
  .report-page .report-selection-toolbar,
  .report-page .report-form-controls,
  .report-page .report-page-shell {
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
  }

  .report-page .report-cycle-toolbar {
    margin: 0;
    padding: 11px 14px;
    border-top: 3px solid var(--company-primary);
  }

  .report-page .report-selection-toolbar {
    display: grid;
    grid-template-columns: minmax(210px, 1fr) repeat(3, minmax(150px, 0.7fr));
    gap: 10px;
    align-items: end;
    margin: 0;
    padding: 11px 14px;
    border-top: 3px solid var(--company-primary);
  }

  .report-selection-toolbar__heading {
    display: grid;
    align-self: center;
    gap: 2px;
  }

  .report-selection-toolbar__heading strong {
    color: var(--ink-strong);
    font-size: 14px;
  }

  .report-selection-toolbar__heading span {
    color: var(--muted);
    font-size: 11.5px;
  }

  .report-page .report-cycle-toolbar > div:first-child {
    display: grid;
    gap: 2px;
  }

  .report-page .report-cycle-toolbar strong {
    color: var(--ink-strong);
    font-size: 14px;
  }

  .report-page .report-cycle-toolbar span {
    color: var(--muted);
    font-size: 12px;
  }

  .report-history-panel {
    display: grid;
    gap: 6px;
    width: 100%;
  }

  .report-history-controls {
    display: flex;
    align-items: end;
    gap: 8px;
    width: 100%;
    min-width: 0;
  }

  .report-history-tabs {
    display: inline-flex;
    flex: 0 0 auto;
    gap: 6px;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface-soft);
  }

  .report-cycle-field {
    flex: 0 0 150px;
    width: 150px;
  }

  .report-preview-refresh {
    margin-left: auto;
    flex: 0 0 auto;
  }

  .report-history-note {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }

  .report-history-note.is-active {
    color: var(--ink-strong);
    font-weight: 750;
  }

  .report-page .report-form-controls {
    margin: 0;
    padding: 12px;
    border-top: 3px solid var(--company-primary);
  }

  .report-form-controls__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }

  .report-form-controls__heading {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .report-form-controls__heading strong {
    color: var(--ink-strong);
    font-size: 14px;
    line-height: 1.35;
  }

  .report-form-controls__heading span {
    color: var(--muted);
    font-size: 11.5px;
    line-height: 1.4;
  }

  .report-page .report-clear-button {
    min-height: 32px;
    padding: 6px 10px;
    flex: 0 0 auto;
  }

  .report-form-controls__grid {
    display: grid;
    grid-template-columns: minmax(250px, 0.82fr) minmax(460px, 1.6fr);
    gap: 10px;
    align-items: start;
  }

  .report-form-group {
    min-width: 0;
    align-self: start;
    margin: 0;
    padding: 9px 10px 10px;
    border: 1px solid color-mix(in srgb, var(--company-primary) 22%, var(--line));
    border-radius: 10px;
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--company-primary) 5%, var(--surface)) 0%,
        var(--surface-soft) 100%
      );
  }

  .report-form-group legend {
    padding: 0 5px;
    color: var(--ink-strong);
    font-size: 12px;
    font-weight: 800;
    line-height: 1.2;
  }

  .report-form-group legend span {
    color: var(--muted);
    font-weight: 600;
  }

  .report-choice-row {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 7px;
  }

  .report-choice-row--rubber {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .report-choice-row--temperature {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .report-choice-list {
    display: grid;
    grid-template-columns: 0.72fr 1.14fr 1.14fr;
    gap: 7px;
    align-items: stretch;
  }

  .report-choice {
    min-width: 0;
    color: var(--ink-strong);
    cursor: pointer;
  }

  .report-choice input,
  .report-target-toggle input {
    width: 14px;
    height: 14px;
    min-height: 0 !important;
    margin: 1px 0 0;
    flex: 0 0 auto;
    accent-color: var(--company-accent);
  }

  .report-choice--chip {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 34px;
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .report-choice--option {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    min-height: 46px;
    padding: 7px 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
  }

  .report-choice__content {
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  .report-choice__content strong {
    color: var(--ink-strong);
    font-size: 11.5px;
    line-height: 1.3;
  }

  .report-choice__content small {
    color: var(--muted);
    font-size: 9.5px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .report-choice--chip:has(input:checked),
  .report-choice--option:has(input:checked),
  .report-target-toggle:has(input:checked) {
    border-color: color-mix(in srgb, var(--company-primary) 65%, var(--line));
    background: color-mix(in srgb, var(--company-primary) 10%, var(--surface));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--company-primary) 16%, transparent);
  }

  .report-form-group--target {
    min-width: 0;
    overflow: hidden;
  }

  .report-target-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(118px, 138px);
    gap: 9px;
    min-width: 0;
    max-width: 100%;
    align-items: stretch;
  }

  .report-target-toggle {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
    min-height: 46px;
    padding: 7px 9px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink-strong);
    cursor: pointer;
  }

  .report-target-toggle > span {
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  .report-target-toggle strong {
    font-size: 11.5px;
    line-height: 1.3;
  }

  .report-target-toggle small {
    color: var(--muted);
    font-size: 9.5px;
    line-height: 1.3;
  }

  .report-target-value {
    display: grid;
    grid-template-rows: auto 34px;
    align-self: stretch;
    min-width: 0;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }

  .report-target-value > span {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .report-target-value input {
    display: block;
    width: 100% !important;
    min-width: 0 !important;
    max-width: 100% !important;
    box-sizing: border-box;
  }

  .report-target-value input:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    background: var(--surface-soft);
  }

  .report-form-fields {
    display: grid;
    grid-template-columns: minmax(230px, 1.2fr) repeat(3, minmax(175px, 0.8fr));
    gap: 10px;
    margin-top: 10px;
  }

  .report-form-field {
    min-width: 0;
  }

  .report-document-field {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
    align-items: end;
    min-width: 0;
  }

  .report-page .report-document-lock {
    min-width: 88px;
    white-space: nowrap;
  }

  .report-page .report-document-lock.is-locked {
    border-color: color-mix(in srgb, var(--company-primary) 55%, var(--line));
    background: color-mix(in srgb, var(--company-primary) 10%, var(--surface));
  }

  .report-page input[readonly] {
    cursor: not-allowed;
    background: var(--surface-soft);
    color: var(--muted);
  }

  .report-page .field > span {
    margin-bottom: 4px;
    color: var(--ink-strong);
    font-size: 11px;
    font-weight: 700;
  }

  .report-page .field {
    min-width: 0;
    max-width: 100%;
  }

  .report-page input:not([type="checkbox"]),
  .report-page select {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    min-height: 34px;
    padding: 6px 9px;
    border-color: var(--line);
    border-radius: 8px;
    font-size: 12px;
  }

  .report-page input:not([type="checkbox"]):focus,
  .report-page select:focus {
    border-color: var(--company-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--company-primary) 14%, transparent);
    outline: none;
  }

  .report-page .button {
    min-height: 34px;
    padding: 7px 11px;
    font-size: 12px;
  }

  .report-page .report-page-shell {
    overflow: auto;
    padding: 10px;
    border-top: 3px solid var(--company-primary);
  }

  .report-page .report-page-shell .fws-svg-report {
    display: block;
    width: min(100%, 1123px) !important;
    max-width: 1123px !important;
    height: auto !important;
    margin-inline: auto;
  }

  @media (max-width: 1180px) {
    .report-history-controls {
      flex-wrap: wrap;
    }

    .report-page .report-selection-toolbar {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .report-selection-toolbar__heading {
      grid-column: 1 / -1;
    }

    .report-form-controls__grid {
      grid-template-columns: 1fr;
    }

    .report-form-fields {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .report-choice-list {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 820px) {
    .report-history-tabs {
      width: 100%;
    }

    .report-history-tabs .tab {
      flex: 1 1 0;
    }

    .report-cycle-field {
      flex: 1 1 140px;
      width: auto;
    }

    .report-preview-refresh {
      margin-left: 0;
    }

    .report-form-controls__header {
      align-items: flex-start;
    }

    .report-choice-list,
    .report-choice-row--temperature,
    .report-page .report-selection-toolbar,
    .report-form-fields {
      grid-template-columns: 1fr;
    }

    .report-choice-row--rubber {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .report-target-row {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 560px) {
    .report-form-controls__header {
      flex-direction: column;
    }

    .report-page .report-clear-button {
      width: 100%;
    }
  }
`;

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
`;
