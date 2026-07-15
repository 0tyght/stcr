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
import type { Oven, ReportCycleMeta, SensorKey, TimeSeriesPoint } from "../types";
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
  firewoodWeight: string;
  documentNo: string;
  effectiveDate: string;
  targetTemperature: number;
  showTargetLine: boolean;
  showHumidityLine: boolean;
};

const defaultReportForm: ReportFormState = {
  rubberType: "",
  smokingPeriodStatus: "",
  temperatureControlStatus: "",
  reason: "",
  inputNetWeight: "",
  outputNetWeight: "",
  firewoodWeight: "",
  documentNo: "F-WS-05 Rev.11",
  effectiveDate: "1-ธ.ค.-68",
  targetTemperature: 45,
  showTargetLine: false,
  showHumidityLine: false,
};

type ReportTemplateConfig = {
  timeSlots: string[];
  intervalHours: number;
  dayCount: number;
  graphMin: number;
  graphMax: number;
  guideTemperatures: number[];
  smokingLower: number;
  smokingUpper: number;
  defaultDocumentNo: string;
  defaultEffectiveDate: string;
  showFirewoodWeight: boolean;
  doubleDayBoundaries: boolean;
};

const defaultReportTemplate: ReportTemplateConfig = {
  timeSlots: ["08.00", "11.00", "14.00", "17.00", "20.00", "23.00", "02.00", "05.00"],
  intervalHours: 3,
  dayCount: 10,
  graphMin: 30,
  graphMax: 65,
  guideTemperatures: [40, 60],
  smokingLower: 40,
  smokingUpper: 60,
  defaultDocumentNo: "F-WS-05 Rev.11",
  defaultEffectiveDate: "1-ธ.ค.-68",
  showFirewoodWeight: false,
  doubleDayBoundaries: false,
};

const grReportTemplate: ReportTemplateConfig = {
  ...defaultReportTemplate,
  timeSlots: ["08.00", "12.00", "16.00", "20.00", "24.00", "04.00"],
  intervalHours: 4,
  graphMin: 30,
  graphMax: 62,
  guideTemperatures: [30, 35, 55],
  smokingLower: 35,
  smokingUpper: 55,
  defaultDocumentNo: "F01-05-05 R07",
  defaultEffectiveDate: "22/06/67",
  showFirewoodWeight: true,
  doubleDayBoundaries: true,
};

function getReportTemplate(company: CompanyConfig): ReportTemplateConfig {
  return company.id === "gr" ? grReportTemplate : defaultReportTemplate;
}

function getReportFormDefaults(company: CompanyConfig): ReportFormState {
  const template = getReportTemplate(company);
  const documentTemplate = company.id === "gr" ? grReportTemplate : template;
  return {
    ...defaultReportForm,
    documentNo: documentTemplate.defaultDocumentNo,
    effectiveDate: documentTemplate.defaultEffectiveDate,
  };
}

function resolveDocumentMeta(
  company: CompanyConfig,
  saved: SavedReportDocumentMeta | null,
): SavedReportDocumentMeta | null {
  if (!saved) return null;

  if (company.id === "gr" && saved.documentNo === defaultReportTemplate.defaultDocumentNo) {
    return {
      documentNo: grReportTemplate.defaultDocumentNo,
      effectiveDate: grReportTemplate.defaultEffectiveDate,
    };
  }

  return saved;
}

type SavedReportDocumentMeta = Pick<ReportFormState, "documentNo" | "effectiveDate">;

function reportCycleMetaFromForm(form: ReportFormState): ReportCycleMeta {
  const optionalNumber = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  return {
    rubberType: form.rubberType || null,
    smokingPeriodStatus: form.smokingPeriodStatus || null,
    temperatureControlStatus: form.temperatureControlStatus || null,
    reason: form.reason.trim() || null,
    inputNetWeightKg: optionalNumber(form.inputNetWeight),
    outputNetWeightKg: optionalNumber(form.outputNetWeight),
    firewoodWeightKg: optionalNumber(form.firewoodWeight),
  };
}

function reportFormFromCycleMeta(meta: ReportCycleMeta): Partial<ReportFormState> {
  const optionalText = (value: number | null): string => value == null ? "" : String(value);
  return {
    rubberType: (meta.rubberType || "") as RubberType,
    smokingPeriodStatus: meta.smokingPeriodStatus || "",
    temperatureControlStatus: meta.temperatureControlStatus || "",
    reason: meta.reason || "",
    inputNetWeight: optionalText(meta.inputNetWeightKg),
    outputNetWeight: optionalText(meta.outputNetWeightKg),
    firewoodWeight: optionalText(meta.firewoodWeightKg),
  };
}

function resolveReportCycleRange(
  fallback: { start: Date; end: Date },
  meta: ReportCycleMeta | null,
  mode: ReportMode,
): { start: Date; end: Date } {
  const metaStart = meta?.reportStartedAt ? new Date(meta.reportStartedAt) : null;
  const metaEnd = meta?.stoppedAt ? new Date(meta.stoppedAt) : null;
  const start = metaStart && Number.isFinite(metaStart.getTime()) ? metaStart : fallback.start;
  const endCandidate = mode === "current" && !metaEnd ? new Date() : metaEnd ?? fallback.end;
  const end = Number.isFinite(endCandidate.getTime()) && endCandidate > start
    ? endCandidate
    : fallback.end;

  return { start, end };
}

function normalizeDocumentMetaValue(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

function reportDocumentStorageKey(companyId: string): string {
  return `stcr-report-document-meta:v2:${companyId}`;
}

function readSavedReportDocumentMeta(companyId: string): SavedReportDocumentMeta | null {
  if (typeof window === "undefined") return null;

  try {
    const saved = window.localStorage.getItem(reportDocumentStorageKey(companyId));
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Partial<SavedReportDocumentMeta>;
    if (typeof parsed.documentNo !== "string" || typeof parsed.effectiveDate !== "string") {
      return null;
    }
    return {
      documentNo: normalizeDocumentMetaValue(parsed.documentNo, 80),
      effectiveDate: normalizeDocumentMetaValue(parsed.effectiveDate, 40),
    };
  } catch {
    return null;
  }
}

function saveReportDocumentMeta(companyId: string, form: ReportFormState): void {
  window.localStorage.setItem(
    reportDocumentStorageKey(companyId),
    JSON.stringify({
      documentNo: normalizeDocumentMetaValue(form.documentNo, 80),
      effectiveDate: normalizeDocumentMetaValue(form.effectiveDate, 40),
    } satisfies SavedReportDocumentMeta),
  );
}

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

function getSmokingPeriodOptions(company: CompanyConfig) {
  return company.id === "gr"
    ? smokingPeriodOptions.filter((option) => option.value !== "notReached")
    : smokingPeriodOptions;
}

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
  temperature: number | null;
  humidity: number | null;
  target: number;
};

const reportSensors: SensorKey[] = ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"];

const humidityGraphMax = 100;

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
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const [cycleMeta, setCycleMeta] = useState<ReportCycleMeta | null>(null);
  const [reportForm, setReportForm] = useState<ReportFormState>(() => ({
    ...getReportFormDefaults(company),
    ...resolveDocumentMeta(company, readSavedReportDocumentMeta(company.id)),
  }));

  const reportRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let active = true;

    void apiClient
      .getReportDocumentMeta()
      .then((saved) => {
        if (!active || !saved.documentNo || !saved.effectiveDate) return;
        const resolved = resolveDocumentMeta(company, saved);
        if (!resolved) return;
        setReportForm((current) => ({ ...current, ...resolved }));
        saveReportDocumentMeta(company.id, { ...getReportFormDefaults(company), ...resolved });
      })
      .catch(() => {
        // Local storage remains the offline fallback during public testing.
      });

    return () => {
      active = false;
    };
  }, [company.id]);

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
    const safeCycle = clampReportCycleNumber(cycle, oven, mode);

    setSelectedCycle(safeCycle);
    setRangeFromCycle(safeCycle);
    setRangeToCycle(safeCycle);
    setHistoricalDownloadMode("single");
  }, [mode, oven?.id, requestedCycle]);

  useEffect(() => {
    if (!oven || selectedCycle == null) return;
    let active = true;
    setCycleMeta(null);
    setReportForm((current) => ({
      ...current,
      rubberType: "",
      smokingPeriodStatus: "",
      temperatureControlStatus: "",
      reason: "",
      inputNetWeight: "",
      outputNetWeight: "",
      firewoodWeight: "",
    }));

    void apiClient
      .getReportCycleMeta(oven.id, selectedCycle)
      .then((meta) => {
        if (active) {
          setCycleMeta(meta);
          setReportForm((current) => ({ ...current, ...reportFormFromCycleMeta(meta) }));
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [oven?.id, selectedCycle]);

  const cycleRange = useMemo(() => {
    if (!oven || selectedCycle == null) return null;
    return resolveReportCycleRange(getCycleRange(oven, mode, selectedCycle), cycleMeta, mode);
  }, [cycleMeta, mode, oven, selectedCycle]);

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
      template: getReportTemplate(company),
    });
  }, [company, cycleRange, oven, points]);

  const renderCycleAndCreatePdfBlob = useCallback(
    async (cycle: number): Promise<{ blob: Blob; filename: string }> => {
      if (!oven || !reportRef.current) {
        throw new Error("ยังไม่พบข้อมูลเตาหรือพื้นที่รายงาน");
      }

      const safeCycle = clampReportCycleNumber(cycle, oven, mode);
      const nextMeta = await apiClient.getReportCycleMeta(oven.id, safeCycle);
      const range = resolveReportCycleRange(
        getCycleRange(oven, mode, safeCycle),
        nextMeta,
        mode,
      );

      setSelectedCycle(safeCycle);
      setCycleMeta(nextMeta);
      setReportForm((current) => ({ ...current, ...reportFormFromCycleMeta(nextMeta) }));

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
    async (chooseLocation = false) => {
      if (!oven || selectedCycle == null) return;

      const safeCycle = clampReportCycleNumber(selectedCycle, oven, mode);
      const range = cycleRange ?? getCycleRange(oven, mode, safeCycle);
      const filename = createPdfFilename(company, safeCycle, range.start);

      const fileHandle = chooseLocation
        ? await requestSaveFile(filename, "PDF document", "application/pdf", ".pdf")
        : undefined;

      if (fileHandle === null) return;

      setDownloadingPdf(true);
      setDownloadMessage("กำลังสร้าง PDF...");

      try {
        setSelectedCycle(safeCycle);

        await apiClient.saveReportCycleMeta(
          oven.id,
          safeCycle,
          reportCycleMetaFromForm(reportForm),
        );

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
    [company, cycleRange, mode, oven, reportForm, selectedCycle],
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
        description="แบบฟอร์ม F-WS-05 รายงานการตรวจสอบอุณหภูมิเตา"
        actions={
          <Link className="button" to={`/ovens/${oven.id}`}>
            กลับหน้าเตา
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
        onCycleChange={(cycle) => {
          setSelectedCycle(cycle);
          setRangeFromCycle(cycle);
          setRangeToCycle(cycle);
        }}
      />

      <section className="panel report-filter report-cycle-toolbar">
        <div className="report-download-summary">
          <strong>ไฟล์รายงานและพรีวิว</strong>
          <span>
            {oven.name} · รอบ {selectedCycle} · {formatReportDateTime(cycleRange.start)} ถึง {formatReportDateTime(cycleRange.end)}
          </span>
        </div>

        {mode === "current" ? (
          <div className="report-primary-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => void downloadSelectedPdf()}
              disabled={downloadingPdf || loadingReport}
            >
              <FileDown size={17} />
              {downloadingPdf ? "กำลังโหลด..." : "ดาวน์โหลด PDF"}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => void downloadCurrentCsv()}
              disabled={loadingReport || !points.length || downloadingPdf}
            >
              <Download size={17} />
              ส่งออก CSV
            </button>
            <button
              className="button button-dark"
              type="button"
              onClick={() => void loadReport()}
              disabled={loadingReport || downloadingPdf}
            >
              <RefreshCw size={17} />
              โหลดข้อมูลใหม่
            </button>
            <button
              className="button"
              type="button"
              aria-expanded={previewExpanded}
              onClick={() => setPreviewExpanded((current) => !current)}
            >
              {previewExpanded ? "ซ่อนพรีวิว" : "แสดงพรีวิว"}
            </button>
          </div>
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
                  PDF รอบเดียว
                </button>

                <button
                  className={`tab ${historicalDownloadMode === "range" ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setHistoricalDownloadMode("range")}
                  disabled={downloadingPdf}
                >
                  ZIP หลายรอบ
                </button>
              </div>

              {historicalDownloadMode === "range" ? (
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
              ) : null}

              {historicalDownloadMode === "single" ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => void downloadSelectedPdf()}
                  disabled={downloadingPdf || loadingReport}
                >
                  <FileDown size={17} />
                  {downloadingPdf ? "กำลังโหลด..." : `ดาวน์โหลด PDF รอบ ${selectedCycle}`}
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
                className="button"
                type="button"
                onClick={() => void downloadCurrentCsv()}
                disabled={loadingReport || !points.length || downloadingPdf}
              >
                <Download size={17} />
                ส่งออก CSV
              </button>

              <button
                className="button button-dark report-preview-refresh"
                type="button"
                onClick={() => void loadReport()}
                disabled={loadingReport || downloadingPdf}
              >
                <RefreshCw size={17} />
                โหลดพรีวิวใหม่
              </button>

              <button
                className="button"
                type="button"
                aria-expanded={previewExpanded}
                onClick={() => setPreviewExpanded((current) => !current)}
              >
                {previewExpanded ? "ซ่อนพรีวิว" : "แสดงพรีวิว"}
              </button>
            </div>

            {downloadMessage ? (
              <p className="report-history-note is-active">
                {downloadMessage}
              </p>
            ) : historicalDownloadMode === "single" ? (
              <p className="report-history-note report-filename-preview">
                ชื่อไฟล์: <strong>{createPdfFilename(company, selectedCycle, cycleRange.start)}</strong>
              </p>
            ) : (
              <p className="report-history-note">
                เลือกช่วงรอบที่ต้องการ ระบบจะรวม PDF เป็น ZIP โดยแยก 1 ไฟล์ต่อ 1 รอบ
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

      <section
        className="report-page-shell"
        aria-label="พรีวิวรายงาน PDF"
        hidden={!previewExpanded}
      >
        <FwsSvgReport
          refElement={reportRef}
          oven={oven}
          cycle={selectedCycle}
          cycleRange={cycleRange}
          cycleMeta={cycleMeta}
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
  const [documentSaveMessage, setDocumentSaveMessage] = useState("");
  const rubberOptions = getRubberOptions(company);
  const visibleSmokingPeriodOptions = getSmokingPeriodOptions(company);
  const template = getReportTemplate(company);
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
          <strong>ข้อมูลเพิ่มเติมสำหรับฟอร์ม</strong>
          <span>เลือกเฉพาะข้อมูลที่ต้องการแสดงในเอกสาร ช่องทั้งหมดไม่บังคับกรอก</span>
        </div>

        <button
          className="button report-clear-button"
          type="button"
          onClick={() => {
            if (!window.confirm("ต้องการล้างข้อมูลในฟอร์มทั้งหมดหรือไม่?")) return;
            onChange({
              ...getReportFormDefaults(company),
              documentNo: form.documentNo,
              effectiveDate: form.effectiveDate,
              targetTemperature: form.targetTemperature,
              showTargetLine: false,
              showHumidityLine: false,
            });
          }}
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
                  type="radio"
                  name="report-rubber-type"
                  checked={form.rubberType === option.value}
                  onChange={() => update("rubberType", option.value)}
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
            {visibleSmokingPeriodOptions.map((option) => (
              <label key={option.value} className="report-choice report-choice--option">
                <input
                  type="radio"
                  name="report-smoking-period"
                  checked={form.smokingPeriodStatus === option.value}
                  onChange={() => update("smokingPeriodStatus", option.value)}
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
                  type="radio"
                  name="report-temperature-status"
                  checked={form.temperatureControlStatus === option.value}
                  onChange={() => update("temperatureControlStatus", option.value)}
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
          <legend>ข้อมูลที่แสดงในกราฟ</legend>

          <div className="report-target-row">
            <label className="report-target-toggle">
              <input
                type="checkbox"
                checked={form.showHumidityLine}
                onChange={(event) => update("showHumidityLine", event.target.checked)}
              />

              <span>
                <strong>แสดงค่าความชื้น</strong>
                <small>ค่าเริ่มต้นปิด และใช้ช่วงตัวเลขเดียวกับอุณหภูมิ</small>
              </span>
            </label>

            <label className="report-target-toggle">
              <input
                type="checkbox"
                checked={form.showTargetLine}
                onChange={(event) => update("showTargetLine", event.target.checked)}
              />

              <span>
                <strong>แสดงค่าเป้าหมาย</strong>
                <small>เปิดเมื่อต้องการแสดงเกณฑ์อุณหภูมิในรายงาน</small>
              </span>
            </label>

            <label className="field compact-field report-target-value">
              <span>ค่าเป้าหมาย (°C)</span>
              <input
                type="number"
                min={template.graphMin}
                max={template.graphMax}
                step={1}
                value={form.showTargetLine ? form.targetTemperature : ""}
                disabled={!form.showTargetLine}
                placeholder="เปิดค่าเป้าหมายก่อน"
                onChange={(event) => update("targetTemperature", Number(event.target.value))}
              />
            </label>
          </div>
        </fieldset>
      </div>

      <div className="report-form-details">
        <section className="report-detail-card report-cycle-detail-card">
          <div className="report-detail-card__heading">
            <strong>รายละเอียดรอบอบ</strong>
            <span>บันทึกสาเหตุ น้ำหนักสุทธิของยาง และน้ำหนักไม้ฟืน</span>
          </div>

          <div className="report-cycle-fields">
            <label className="field compact-field report-form-field report-form-field--reason">
              <span>สาเหตุ</span>
              <input
                value={form.reason}
                onChange={(event) => update("reason", event.target.value)}
                placeholder="ระบุสาเหตุถ้ามี"
              />
            </label>

            <label className="field compact-field report-form-field">
              <span>น้ำหนักยางเข้าเตา (Net Weight)</span>
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
              <span>น้ำหนักยางออกเตา (Net Weight)</span>
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

            {template.showFirewoodWeight ? (
              <label className="field compact-field report-form-field">
                <span>น้ำหนักไม้ฟืน</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={form.firewoodWeight}
                  onChange={(event) => update("firewoodWeight", event.target.value)}
                  placeholder="กิโลกรัม"
                />
              </label>
            ) : null}
          </div>
        </section>

        <section className="report-detail-card report-document-card">
          <div className="report-detail-card__heading">
            <strong>ข้อมูลเอกสาร</strong>
            <span>ปลดล็อกเมื่อต้องการแก้ไข แล้วกดบันทึกเพื่อล็อกค่า</span>
          </div>

          <div className="report-document-field">
            <label className="field compact-field report-form-field">
              <span>Document No.</span>
              <input
                value={form.documentNo}
                maxLength={80}
                readOnly={documentNoLocked}
                aria-readonly={documentNoLocked}
                onChange={(event) => update("documentNo", event.target.value)}
              />
            </label>

            <label className="field compact-field report-form-field">
              <span>เริ่มใช้วันที่</span>
              <input
                value={form.effectiveDate}
                maxLength={40}
                readOnly={documentNoLocked}
                aria-readonly={documentNoLocked}
                onChange={(event) => update("effectiveDate", event.target.value)}
                placeholder="เช่น 1-ธ.ค.-68"
              />
            </label>

            <button
              className={`button report-document-lock ${documentNoLocked ? "is-locked" : ""}`}
              type="button"
              aria-pressed={!documentNoLocked}
              title={documentNoLocked ? "ปลดล็อกเพื่อแก้ไขข้อมูลเอกสาร" : "บันทึกและล็อกข้อมูลเอกสาร"}
              onClick={async () => {
                if (documentNoLocked) {
                  setDocumentNoLocked(false);
                  return;
                }

                saveReportDocumentMeta(company.id, form);
                try {
                  const saved = await apiClient.saveReportDocumentMeta({
                    documentNo: normalizeDocumentMetaValue(form.documentNo, 80),
                    effectiveDate: normalizeDocumentMetaValue(form.effectiveDate, 40),
                  });
                  saveReportDocumentMeta(company.id, { ...form, ...saved });
                  onChange({ ...form, ...saved });
                  setDocumentNoLocked(true);
                  setDocumentSaveMessage("บันทึกข้อมูลเอกสารลงฐานข้อมูลแล้ว");
                } catch (error) {
                  setDocumentNoLocked(false);
                  setDocumentSaveMessage(
                    error instanceof Error
                      ? `บันทึกข้อมูลเอกสารไม่สำเร็จ: ${error.message}`
                      : "บันทึกข้อมูลเอกสารไม่สำเร็จ",
                  );
                }
              }}
            >
              {documentNoLocked ? <Lock size={16} /> : <Unlock size={16} />}
              {documentNoLocked ? "ปลดล็อก" : "บันทึกและล็อก"}
            </button>
          </div>
          {documentSaveMessage ? (
            <span className="report-document-save-message" role="status">
              {documentSaveMessage}
            </span>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function FwsSvgReport({
  refElement,
  oven,
  cycle,
  cycleRange,
  cycleMeta,
  slots,
  company,
  form,
}: {
  refElement: RefObject<SVGSVGElement | null>;
  oven: Oven;
  cycle: number;
  cycleRange: { start: Date; end: Date };
  cycleMeta: ReportCycleMeta | null;
  slots: ReportSlot[];
  company: CompanyConfig;
  form: ReportFormState;
}) {
  const upper = oven.limits.chamberTemp.upper;
  const lower = oven.limits.chamberTemp.lower;
  const template = getReportTemplate(company);

  const mainX = 25;
  const mainY = 15;
  const mainW = 1073;
  const mainH = 748;

  const headerH = 75;
  const metaY = headerH;
  const metaH = 78;
  const graphY = metaY + metaH;
  const graphH = 445;
  const noteY = graphY + graphH + 8;

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
        <rect
          x="0"
          y="0"
          width={mainW}
          height={mainH}
          fill="#ffffff"
          stroke="#000000"
          strokeWidth="1"
        />

        <FwsSvgHeader width={mainW} height={headerH} company={company} form={form} />

        <FwsSvgMeta
          y={metaY}
          width={mainW}
          height={metaH}
          oven={oven}
          cycle={cycle}
          cycleRange={cycleRange}
          cycleMeta={cycleMeta}
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
          template={template}
        />

        <FwsSvgNotes y={noteY} form={form} template={template} company={company} />
      </g>

      <SvgText x={8} y={779} size={8}>
        {form.documentNo} รายงานการตรวจสอบอุณหภูมิเตา
      </SvgText>

      <SvgText x={1096} y={779} size={8} anchor="end">
        Effective Date : {form.effectiveDate}
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
  const isGr = company.id === "gr";
  const logoW = isGr ? 158 : 174;
  const docW = isGr ? 180 : 205;
  const titleW = width - logoW - docW;
  const docX = logoW + titleW;
  const docSplitY = 48;
  const effectiveLabelW = isGr ? 82 : 92;
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
      <line x1={docX} y1={docSplitY} x2={width} y2={docSplitY} stroke="#000000" />
      <line x1={docX + effectiveLabelW} y1={docSplitY} x2={docX + effectiveLabelW} y2={height} stroke="#000000" />

      <image
        href={company.report.logo}
        x={logoBox.x}
        y={logoBox.y}
        width={logoBox.width}
        height={logoBox.height}
        preserveAspectRatio="xMidYMid meet"
        clipPath="url(#report-logo-frame-clip)"
      />

      <SvgText x={logoW + titleW / 2} y={31} size={isGr ? 15.8 : 15} weight={800} anchor="middle">
        รายงานการตรวจสอบอุณหภูมิเตา
      </SvgText>
      <SvgText x={logoW + titleW / 2} y={51} size={isGr ? 11.2 : 11.5} weight={700} anchor="middle">
        Smoking Temperature Control Report
      </SvgText>

      <SvgText x={docX + docW / 2} y={18} size={10} weight={800} anchor="middle">
        Document No.
      </SvgText>
      <SvgText x={docX + docW / 2} y={40} size={11} weight={800} anchor="middle">
        {form.documentNo}
      </SvgText>
      <SvgText x={docX + effectiveLabelW / 2} y={66} size={isGr ? 9.8 : 10.5} weight={800} anchor="middle">
        เริ่มใช้วันที่
      </SvgText>
      <SvgText x={docX + effectiveLabelW + (docW - effectiveLabelW) / 2} y={66} size={11} weight={800} anchor="middle">
        {form.effectiveDate}
      </SvgText>
    </g>
  );
}

function GrSvgHeader({
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
  const documentMatch = form.documentNo.match(/^(.*?)\s+(R\d+)$/i);
  const documentCode = documentMatch?.[1] || form.documentNo;
  const revision = documentMatch?.[2] || "R07";
  const logoW = 174;
  const docW = 205;
  const titleW = width - logoW - docW;
  const docX = logoW + titleW;

  return (
    <g>
      <defs>
        <clipPath id="gr-report-logo-frame-clip">
          <rect x="1" y="1" width={logoW - 2} height={height - 2} />
        </clipPath>
      </defs>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" stroke="#000000" strokeWidth="0.9" />
      <line x1={logoW} y1="0" x2={logoW} y2={height} stroke="#000000" strokeWidth="0.9" />
      <line x1={docX} y1="0" x2={docX} y2={height} stroke="#000000" strokeWidth="0.9" />
      <line x1={docX} y1={height / 2} x2={width} y2={height / 2} stroke="#000000" strokeWidth="0.8" />
      <image
        href={company.report.logo}
        x={34}
        y={4}
        width={106}
        height={67}
        preserveAspectRatio="xMidYMid meet"
        clipPath="url(#gr-report-logo-frame-clip)"
      />
      <SvgText x={logoW + titleW / 2} y={31} size={16} weight={800} anchor="middle">
        รายงานเช็คอุณหภูมิเตา
      </SvgText>
      <SvgText x={logoW + titleW / 2} y={52} size={12.2} weight={700} anchor="middle">
        Smoking Temperature Control Report
      </SvgText>

      <SvgText x={docX + docW / 2} y={24} size={11} weight={800} anchor="middle">
        {documentCode}
      </SvgText>
      <SvgText x={docX + docW / 2} y={61} size={10.5} weight={800} anchor="middle">
        {revision} เริ่มใช้ {form.effectiveDate}
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
  cycleMeta,
  company,
  form,
}: {
  y: number;
  width: number;
  height: number;
  oven: Oven;
  cycle: number;
  cycleRange: { start: Date; end: Date };
  cycleMeta: ReportCycleMeta | null;
  company: CompanyConfig;
  form: ReportFormState;
}) {
  if (company.id === "gr") {
    return (
      <GrSvgMeta
        y={y}
        width={width}
        height={height}
        oven={oven}
        cycle={cycle}
        cycleRange={cycleRange}
        cycleMeta={cycleMeta}
        form={form}
      />
    );
  }

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

function GrSvgMeta({
  y,
  width,
  height,
  oven,
  cycle,
  cycleRange,
  cycleMeta,
  form,
}: {
  y: number;
  width: number;
  height: number;
  oven: Oven;
  cycle: number;
  cycleRange: { start: Date; end: Date };
  cycleMeta: ReportCycleMeta | null;
  form: ReportFormState;
}) {
  const firedAt = new Date(cycleMeta?.firedAt || oven.firedAt || cycleRange.start);

  return (
    <g transform={`translate(0 ${y})`}>
      <rect x="0" y="0" width={width} height={height} fill="#ffffff" stroke="#000000" strokeWidth="0.8" />
      <SvgText x={14} y={14} size={10.2} weight={700}>เตา No.</SvgText>
      <DottedLine x={51} y={14} width={78} />
      <SvgText x={90} y={12} size={10.2} weight={800} anchor="middle">{oven.number}</SvgText>
      <SvgText x={14} y={25} size={7.2}>Smoking chamber#</SvgText>

      <SvgText x={14} y={43} size={10} weight={700}>ชนิดยาง</SvgText>
      <SvgText x={14} y={54} size={7.2}>Type of rubber</SvgText>
      {grRubberOptions.map((item, index) => {
        const x = 82 + index * 58;
        return (
          <g key={item.value}>
            <FwsCheckbox x={x} y={29} size={11} checked={form.rubberType === item.value} />
            <SvgText x={x + 5.5} y={68} size={7.5} anchor="middle">{item.label}</SvgText>
          </g>
        );
      })}

      <SvgText x={315} y={14} size={9.6} weight={700}>เข้าเตาวันที่</SvgText>
      <DottedLine x={367} y={14} width={105} />
      <SvgText x={419} y={12} size={9.5} weight={700} anchor="middle">{formatReportDate(cycleRange.start)}</SvgText>
      <SvgText x={315} y={25} size={7.2}>Date In</SvgText>
      <SvgText x={487} y={14} size={9.6} weight={700}>ออกเตาวันที่</SvgText>
      <DottedLine x={541} y={14} width={105} />
      <SvgText x={593} y={12} size={9.5} weight={700} anchor="middle">{formatReportDate(cycleRange.end)}</SvgText>
      <SvgText x={487} y={25} size={7.2}>Date Out</SvgText>

      <SvgText x={315} y={39} size={9.4} weight={700}>ปริมาณน้ำหนักยางเข้าเตา (ก.ก.) :</SvgText>
      <DottedLine x={458} y={39} width={188} />
      {form.inputNetWeight ? <SvgText x={552} y={36} size={9.3} weight={700} anchor="middle">{form.inputNetWeight}</SvgText> : null}
      <SvgText x={315} y={49} size={7.2}>Weight in</SvgText>
      <SvgText x={315} y={62} size={9.4} weight={700}>ปริมาณน้ำหนักยางออกเตา (ก.ก.) :</SvgText>
      <DottedLine x={458} y={62} width={188} />
      {form.outputNetWeight ? <SvgText x={552} y={59} size={9.3} weight={700} anchor="middle">{form.outputNetWeight}</SvgText> : null}
      <SvgText x={315} y={72} size={7.2}>Weight out</SvgText>

      <SvgText x={740} y={14} size={9.5} weight={700}>เวลาเริ่มใส่ยางเข้าเตา</SvgText>
      <DottedLine x={871} y={14} width={84} />
      <SvgText x={913} y={12} size={9.5} weight={700} anchor="middle">{formatReportTime(cycleRange.start)}</SvgText>
      <SvgText x={962} y={14} size={9.2}>น.</SvgText>
      <SvgText x={740} y={25} size={7.2}>Time In</SvgText>
      <SvgText x={740} y={39} size={9.5} weight={700}>เวลาปิดเตา (ติดไฟ)</SvgText>
      <DottedLine x={858} y={39} width={97} />
      <SvgText x={906} y={36} size={9.5} weight={700} anchor="middle">{formatReportTime(firedAt)}</SvgText>
      <SvgText x={962} y={39} size={9.2}>น.</SvgText>
      <SvgText x={740} y={49} size={7.2}>Put out the fire time</SvgText>
      <SvgText x={740} y={65} size={9.6} weight={700}>อบรอบที่</SvgText>
      <DottedLine x={817} y={65} width={72} />
      <SvgText x={853} y={62} size={10} weight={800} anchor="middle">{cycle}</SvgText>
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
  template,
}: {
  y: number;
  width: number;
  height: number;
  slots: ReportSlot[];
  upper: number;
  lower: number;
  form: ReportFormState;
  template: ReportTemplateConfig;
}) {
  const showFirewoodRow = template.showFirewoodWeight;
  const doubleDayBoundaries = template.doubleDayBoundaries;
  const left = showFirewoodRow ? 78 : 58;
  const dayH = 29;

  const timeH = showFirewoodRow ? 27 : 38;
  const tickRowH = showFirewoodRow ? 0 : 13;
  const tempHeaderH = showFirewoodRow ? 0 : 26;

  const chartTop = dayH + timeH + tickRowH + tempHeaderH;
  const graphTopGap = showFirewoodRow ? 20 : 0;
  const plotTop = chartTop + graphTopGap;
  const firewoodRowH = showFirewoodRow ? 38 : 0;
  const smokedConditionRowH = showFirewoodRow ? 26 : 36;
  const footerRowsH = firewoodRowH + smokedConditionRowH;
  const chartH = height - plotTop - footerRowsH;
  const chartBottom = plotTop + chartH;
  const firewoodRowBottom = showFirewoodRow ? chartBottom + firewoodRowH : chartBottom;
  const chartW = width - left;
  const chartRight = width;
  const reportSlotCount = slots.length;
  const slotsPerDay = template.timeSlots.length;
  const cellW = chartW / reportSlotCount;

  const graphMin = template.graphMin;
  const showHumidity = !showFirewoodRow && form.showHumidityLine;
  const graphMax = showHumidity ? humidityGraphMax : template.graphMax;

  const valueToY = (value: number) => {
    const clamped = Math.max(graphMin, Math.min(graphMax, value));
    return plotTop + ((graphMax - clamped) / (graphMax - graphMin)) * chartH;
  };

  const tempToY = valueToY;
  const humidityToY = valueToY;

  const slotToX = (index: number) => left + (index + 0.5) * cellW;

  const temperaturePath = buildLinePath(
    slots
      .filter((slot) => slot.temperature !== null)
      .map((slot) => ({
        x: slotToX(slot.index),
        y: tempToY(slot.temperature ?? graphMin),
      })),
  );

  const humidityPath = showHumidity
    ? buildLinePath(
        slots
          .filter((slot) => slot.humidity !== null)
          .map((slot) => ({
            x: slotToX(slot.index),
            y: humidityToY(slot.humidity ?? graphMin),
          })),
      )
    : "";

  const temperatureLabels = slots.filter((slot) => slot.temperature !== null);
  const humidityLabels = showHumidity
    ? slots.filter((slot) => slot.humidity !== null)
    : [];

  function getLabelPosition(
    slot: ReportSlot,
    value: number,
    readValue: (item: ReportSlot) => number | null,
    preferAbove: boolean,
    toY: (nextValue: number) => number = tempToY,
  ) {
    const pointY = toY(value);
    const previousValue = readValue(slots[Math.max(0, slot.index - 1)] ?? slot);
    const nextValue = readValue(slots[Math.min(slots.length - 1, slot.index + 1)] ?? slot);
    const isLocalHigh =
      previousValue !== null && nextValue !== null && value >= previousValue && value >= nextValue;
    const isLocalLow =
      previousValue !== null && nextValue !== null && value <= previousValue && value <= nextValue;

    let placeAbove = preferAbove;
    if (pointY - plotTop < 24) placeAbove = false;
    else if (chartBottom - pointY < 24) placeAbove = true;
    else if (isLocalHigh) placeAbove = true;
    else if (isLocalLow) placeAbove = false;
    else placeAbove = slot.index % 2 === 0 ? preferAbove : !preferAbove;

    return {
      x: slotToX(slot.index),
      pointY,
      labelY: pointY + (placeAbove ? -3.2 : 3.2),
      textAnchor: placeAbove ? "start" : "end",
    } as const;
  }

  const targetPath = !showFirewoodRow && form.showTargetLine
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
      {tickRowH > 0 ? (
        <line
          x1="0"
          y1={dayH + timeH + tickRowH}
          x2={width}
          y2={dayH + timeH + tickRowH}
          stroke="#000000"
          strokeWidth="0.8"
        />
      ) : null}
      {!showFirewoodRow ? (
        <line x1="0" y1={chartTop} x2={width} y2={chartTop} stroke="#000000" strokeWidth="0.9" />
      ) : null}
      <line x1="0" y1={chartBottom} x2={width} y2={chartBottom} stroke="#000000" strokeWidth="0.8" />
      {showFirewoodRow ? (
        <line x1="0" y1={firewoodRowBottom} x2={width} y2={firewoodRowBottom} stroke="#000000" strokeWidth="0.8" />
      ) : null}

      <SvgText x={22} y={19} size={11} weight={700} anchor="middle">
        วัน
      </SvgText>
      <SvgText x={22} y={dayH + timeH / 2 + 4} size={11} weight={700} anchor="middle">
        เวลา
      </SvgText>
      <SvgText
        x={28}
        y={showFirewoodRow ? chartTop + 8 : dayH + timeH + tickRowH + tempHeaderH / 2 + 4}
        size={showFirewoodRow ? 8.2 : 10.5}
        weight={700}
        anchor="middle"
      >
        อุณหภูมิ
      </SvgText>
      {showFirewoodRow ? (
        <SvgText x={28} y={chartTop + 17} size={6.7} anchor="middle">
          Temperature
        </SvgText>
      ) : null}
      {showFirewoodRow ? (
        <>
          <SvgText x={30} y={chartBottom + 17} size={8.2} weight={700} anchor="middle">ไม้ฟืน (ก.ก.)</SvgText>
          <SvgText x={30} y={chartBottom + 29} size={6.8} anchor="middle">Firewood</SvgText>
          <SvgText x={30} y={firewoodRowBottom + 12} size={8.2} weight={700} anchor="middle">สภาพยาง</SvgText>
          <SvgText x={30} y={firewoodRowBottom + 22} size={6.8} anchor="middle">Smoked condition</SvgText>
        </>
      ) : (
        <SvgText x={30} y={chartBottom + 15} size={10.5} weight={700} anchor="middle">สภาพยาง</SvgText>
      )}

      {Array.from({ length: template.dayCount }).map((_, dayIndex) => {
        const x = left + dayIndex * slotsPerDay * cellW;
        const w = slotsPerDay * cellW;

        return (
          <g key={`day-${dayIndex}`}>
            {!doubleDayBoundaries ? (
              <line x1={x} y1="0" x2={x} y2={height} stroke="#000000" strokeWidth="1.0" />
            ) : null}
            <SvgText x={x + w / 2} y={19} size={10} weight={700} anchor="middle">
              ({dayIndex + 1})
            </SvgText>
          </g>
        );
      })}
      <line x1={width - 0.5} y1="0" x2={width - 0.5} y2={height} stroke="#000000" strokeWidth="0.9" />

      {slots.map((slot) => {
        const x = left + slot.index * cellW;
        const isDayStart = slot.index % slotsPerDay === 0;

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
              strokeWidth="0.34"
              strokeDasharray="1 1.5"
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
        .filter((slot) => slot.index % slotsPerDay === 0)
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

      {Array.from({ length: graphMax - graphMin + 1 }).map((_, index) => {
        const temp = graphMax - index;
        const lineY = tempToY(temp);
        const isFive = temp % 5 === 0;
        const isGuide = template.guideTemperatures.includes(temp);
        const showLabel = isFive || isGuide;

        return (
          <g key={`temp-${temp}`}>
            <line
              x1={showFirewoodRow ? left - 10 : left}
              y1={lineY}
              x2={chartRight}
              y2={lineY}
              stroke="#000000"
              strokeWidth={isGuide ? (showFirewoodRow ? 1.8 : 1.05) : isFive ? 0.62 : 0.3}
              strokeDasharray={isGuide || isFive ? undefined : "1 1.5"}
            />

            {showLabel ? (
              <SvgText
                x={showFirewoodRow ? left - 14 : left - 7}
                y={temp === graphMax ? lineY + 9.5 : temp === graphMin ? lineY - 2.5 : lineY + 3.2}
                size={9.5}
                weight={isGuide ? 800 : 700}
                anchor="end"
              >
                {temp}
              </SvgText>
            ) : null}
          </g>
        );
      })}

      {!showFirewoodRow ? (() => {
        const bx = 20;
        const by = (tempToY(template.smokingUpper) + tempToY(template.smokingLower)) / 2;
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
      })() : null}

      {!showFirewoodRow ? (() => {
        const bx = 24;
        const by = (tempToY(template.smokingLower) + tempToY(template.graphMin)) / 2;
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
      })() : null}

      {!showFirewoodRow ? (
        <>
          <line x1="0" y1={tempToY(template.smokingUpper)} x2="28" y2={tempToY(template.smokingUpper)} stroke="#000000" strokeWidth="0.8" />
          <line x1="0" y1={tempToY(template.smokingLower)} x2="28" y2={tempToY(template.smokingLower)} stroke="#000000" strokeWidth="0.8" />
        </>
      ) : null}

      <g
        data-control-upper-y={tempToY(upper).toFixed(2)}
        data-control-lower-y={tempToY(lower).toFixed(2)}
      />

      <g aria-label="คำอธิบายสีกราฟ">
        {!showFirewoodRow ? <>
        <rect x={left + 4} y={chartTop + 4} width={form.showHumidityLine ? 154 : 82} height="16" rx="3" fill="#ffffff" opacity="0.9" />
        <line x1={left + 10} y1={chartTop + 12} x2={left + 28} y2={chartTop + 12} stroke="#d62027" strokeWidth="2" />
        <circle cx={left + 19} cy={chartTop + 12} r="1.5" fill="#d62027" />
        <SvgText x={left + 33} y={chartTop + 15} size={7.5} weight={700}>
          อุณหภูมิ °C
        </SvgText>
        {form.showHumidityLine ? (
          <>
            <line x1={left + 91} y1={chartTop + 12} x2={left + 109} y2={chartTop + 12} stroke="#f59e0b" strokeWidth="2" />
            <circle cx={left + 100} cy={chartTop + 12} r="1.5" fill="#f59e0b" />
            <SvgText x={left + 114} y={chartTop + 15} size={7.5} weight={700}>
              ความชื้น %
            </SvgText>
          </>
        ) : null}
        </> : null}
      </g>

      {doubleDayBoundaries
        ? Array.from({ length: template.dayCount - 1 }, (_, index) => {
            const dayBoundary = index + 1;
            const x = left + dayBoundary * slotsPerDay * cellW;
            const gap = 2.4;

            return (
              <g key={`double-day-boundary-${dayBoundary}`} aria-hidden="true">
                <rect
                  x={x - gap / 2}
                  y="0"
                  width={gap}
                  height={height}
                  fill="#ffffff"
                />
                <line
                  x1={x - gap / 2}
                  y1="0"
                  x2={x - gap / 2}
                  y2={height}
                  stroke="#000000"
                  strokeWidth="0.75"
                />
                <line
                  x1={x + gap / 2}
                  y1="0"
                  x2={x + gap / 2}
                  y2={height}
                  stroke="#000000"
                  strokeWidth="0.75"
                />
              </g>
            );
          })
        : null}

      {targetPath ? (
        <path d={targetPath} fill="none" stroke="#0f4c81" strokeWidth="1.35" opacity="0.9" />
      ) : null}

      {temperaturePath && !showFirewoodRow ? (
        <path d={temperaturePath} fill="none" stroke="#d62027" strokeWidth="1.55" opacity="0.96" />
      ) : null}

      {humidityPath ? (
        <path d={humidityPath} fill="none" stroke="#f59e0b" strokeWidth="1.55" opacity="0.96" />
      ) : null}

      {!showFirewoodRow
        ? slots
            .filter((slot) => slot.temperature !== null)
            .map((slot) => (
              <circle
                key={`temperature-${slot.index}`}
                cx={slotToX(slot.index)}
                cy={tempToY(slot.temperature ?? graphMin)}
                r="1.25"
                fill="#d62027"
              />
            ))
        : null}

      {showHumidity
        ? slots
            .filter((slot) => slot.humidity !== null)
            .map((slot) => (
              <circle
                key={`humidity-${slot.index}`}
                cx={slotToX(slot.index)}
                cy={humidityToY(slot.humidity ?? graphMin)}
                r="1.25"
                fill="#f59e0b"
              />
            ))
        : null}

      {showFirewoodRow && form.firewoodWeight ? (
        <SvgText x={left + cellW / 2} y={chartBottom + 23} size={8.2} weight={700} anchor="middle">
          {form.firewoodWeight}
        </SvgText>
      ) : null}

      {temperatureLabels.map((slot) => {
        const value = slot.temperature ?? graphMin;
        const { x, labelY, textAnchor } = getLabelPosition(
          slot,
          value,
          (item) => item.temperature,
          true,
        );
        return (
          <text
            key={`temperature-label-${slot.index}`}
            x={x}
            y={labelY}
            transform={`rotate(-90 ${x} ${labelY})`}
            textAnchor={textAnchor}
            fontFamily="Sarabun"
            fontSize={showFirewoodRow ? 5.3 : 5.8}
            fontWeight="bold"
            fill="#a31218"
            stroke="#ffffff"
            strokeWidth={showFirewoodRow ? 1.45 : 1.8}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {value.toFixed(1)}
          </text>
        );
      })}

      {humidityLabels.map((slot) => {
        const value = slot.humidity ?? graphMin;
        const { x, labelY, textAnchor } = getLabelPosition(
          slot,
          value,
          (item) => item.humidity,
          false,
          humidityToY,
        );
        return (
          <text
            key={`humidity-label-${slot.index}`}
            x={x}
            y={labelY}
            transform={`rotate(-90 ${x} ${labelY})`}
            textAnchor={textAnchor}
            fontFamily="Sarabun"
            fontSize="5.8"
            fontWeight="bold"
            fill="#b45309"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {value.toFixed(1)}
          </text>
        );
      })}

      {showFirewoodRow && temperaturePath ? (
        <path d={temperaturePath} fill="none" stroke="#d62027" strokeWidth="1.75" opacity="0.98" />
      ) : null}

      {showFirewoodRow
        ? slots
            .filter((slot) => slot.temperature !== null)
            .map((slot) => (
              <circle
                key={`temperature-top-${slot.index}`}
                cx={slotToX(slot.index)}
                cy={tempToY(slot.temperature ?? graphMin)}
                r="1.1"
                fill="#d62027"
              />
            ))
        : null}

    </g>
  );
}

function FwsSvgNotes({
  y,
  form,
  template,
  company,
}: {
  y: number;
  form: ReportFormState;
  template: ReportTemplateConfig;
  company: CompanyConfig;
}) {
  if (company.id === "gr") {
    return <GrSvgNotes y={y} form={form} />;
  }

  if (template.showFirewoodWeight) {
    return <GrSvgNotes y={y} form={form} />;
  }

  return (
    <g transform={`translate(0 ${y})`}>
      {template.showFirewoodWeight ? (
        <>
          <SvgText x={58} y={0} size={8.8} weight={800}>
            น้ำหนักไม้ฟืน
          </SvgText>
          <DottedLine x={132} y={0} width={145} />
          {form.firewoodWeight ? (
            <SvgText x={204} y={-3} size={9} weight={800} anchor="middle">
              {form.firewoodWeight}
            </SvgText>
          ) : null}
          <SvgText x={284} y={0} size={8.8} weight={700}>
            กก.
          </SvgText>
        </>
      ) : null}

      <g transform={`translate(0 ${template.showFirewoodWeight ? 14 : 0})`}>
        <SvgText x={58} y={0} size={7.4} weight={700}>
          * ✕ ไม่สุก (ปากกาสีน้ำเงิน) / ✓ สุก (ปากกาสีแดง)   Ø ยางสุกแล้วยังไม่ออกเตา (อุ่นใช้ปากกาสีแดง) / เกณฑ์ประเมินวันรมยาง ต้องใช้ระยะเวลาการรมควันตามที่ WI กำหนด (WI-WS-06)
        </SvgText>

        <SvgText x={58} y={16} size={7.3} weight={700}>
          ** ควบคุมอุณหภูมิ: [รมควัน] {template.smokingLower} - {template.smokingUpper}°C, [อุ่นยาง] {template.graphMin}-{template.smokingLower}°C   (ประเมินอุณหภูมิวันที่ 3 หลังปิดเตา 2 วัน/ เกณฑ์การรมควัน ความชื้นยาง บวกลบ 1 วัน)
        </SvgText>

      {/* ประเมินวันรมควัน: 3 ตัวเลือกตามแบบฟอร์มต้นฉบับ (WI-WS-06) */}
      <SvgText x={58} y={40} size={8.8} weight={700}>
        ประเมินวันรมควัน
      </SvgText>

      <FwsCheckbox x={178} y={30} size={10} checked={form.smokingPeriodStatus === "under"} />

      <SvgText x={193} y={40} size={8.5} weight={700}>
        อยู่ในเกณฑ์
      </SvgText>

      <FwsCheckbox x={270} y={30} size={10} checked={form.smokingPeriodStatus === "over"} />

      <SvgText x={285} y={40} size={8} weight={700}>
        เกินเกณฑ์ (เกณฑ์รมควัน = ระยะเวลาการรมควันเกินที่ WI กำหนด (WI-WS-06))
      </SvgText>

      <FwsCheckbox x={270} y={46} size={10} checked={form.smokingPeriodStatus === "notReached"} />

      <SvgText x={285} y={56} size={8} weight={700}>
        ไม่ถึงเกณฑ์ (เกณฑ์รมควัน = ระยะเวลาการรมควันไม่ถึงเกณฑ์ที่ WI กำหนด (WI-WS-06))
      </SvgText>

      {/* ประเมินอุณหภูมิ: จัดให้อยู่แถวเดียว */}
      <SvgText x={58} y={74} size={8.8} weight={700}>
        อุณหภูมิ
      </SvgText>

      <FwsCheckbox
        x={178}
        y={64}
        size={10}
        checked={form.temperatureControlStatus === "underControl"}
      />

      <SvgText x={193} y={74} size={8.5} weight={700}>
        อยู่ในค่าควบคุม / Under Control
      </SvgText>

      <FwsCheckbox
        x={405}
        y={64}
        size={10}
        checked={form.temperatureControlStatus === "outOfControl"}
      />

      <SvgText x={420} y={74} size={8.5} weight={700}>
        ไม่อยู่ในค่าควบคุม / Out of Control
      </SvgText>

      {/* คำอธิบายสี */}
      <SvgText x={760} y={40} size={8.4} weight={800}>
        สีน้ำเงิน = อุณหภูมิที่ต้องการ : หัวหน้างาน
      </SvgText>

      <SvgText x={760} y={74} size={8.4} weight={800}>
        สีแดง = อุณหภูมิจริง : พนักงานคุมเตา
      </SvgText>

      {/* สาเหตุ */}
      <SvgText x={350} y={94} size={9.2} weight={700}>
        สาเหตุ
      </SvgText>

      <DottedLine x={390} y={94} width={430} />

      {form.reason ? (
        <SvgText x={400} y={91} size={8.4}>
          {form.reason}
        </SvgText>
      ) : null}

      {/* ลายเซ็นอยู่ภายในกรอบ */}
      <SvgText x={290} y={116} size={9.4} weight={700}>
        ผู้รายงาน
      </SvgText>

      <DottedLine x={345} y={116} width={210} />

      <SvgText x={650} y={116} size={9.4} weight={700}>
        หัวหน้าฝ่ายผลิต
      </SvgText>

      <DottedLine x={740} y={116} width={245} />
      </g>
    </g>
  );
}

function GrSvgNotes({ y, form }: { y: number; form: ReportFormState }) {
  const smokingOver = form.smokingPeriodStatus === "over";

  return (
    <g transform={`translate(0 ${y})`} aria-label="ส่วนท้ายรายงาน GR">
      <g display="none">
      <SvgText x={58} y={0} size={8.4} weight={800}>
        น้ำหนักไม้ฟืน
      </SvgText>
      <DottedLine x={126} y={0} width={130} />
      {form.firewoodWeight ? (
        <SvgText x={191} y={-3} size={8.6} weight={800} anchor="middle">
          {form.firewoodWeight}
        </SvgText>
      ) : null}
      <SvgText x={264} y={0} size={8.4} weight={700}>
        กก.
      </SvgText>

      </g>
      <g transform="translate(0 -9)">
      <SvgText x={58} y={17} size={8.1} weight={700}>
        * สภาพลูกยาง
      </SvgText>
      <path
        d="M 135 8 L 143 18 M 143 8 L 135 18"
        fill="none"
        stroke="#000000"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <SvgText x={151} y={17} size={8.1}>ไม่สุก</SvgText>
      <path
        d="M 205 13 L 209 17 L 216 8"
        fill="none"
        stroke="#000000"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <SvgText x={221} y={17} size={8.1}>สุก</SvgText>
      <circle cx={271} cy={13} r={7} fill="none" stroke="#000000" strokeWidth={0.9} />
      <path
        d="M 266 13 L 270 17 L 277 8"
        fill="none"
        stroke="#000000"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <SvgText x={284} y={17} size={8.1}>
        ยางสุกแล้ว ยังไม่ออกเตา (อุ่น) / เกณฑ์การประเมินวันรมยาง ต้องใช้ระยะการรมควันไม่เกิน 5 วัน ยกเว้นยางที่สุกแล้ว
      </SvgText>

      <SvgText x={58} y={27} size={6.8}>Smoked condition</SvgText>
      <SvgText x={138} y={27} size={6.8}>Undone</SvgText>
      <SvgText x={205} y={27} size={6.8}>Done</SvgText>
      <SvgText x={271} y={27} size={6.8}>Done, but still have to be kept in the smoking room</SvgText>

      <SvgText x={58} y={42} size={8.1} weight={700}>
        ** อุณหภูมิเตา ตั้งแต่วันที่ 3 จนถึงวันที่ยางสุก ห้ามใส่อุณหภูมิต่ำกว่า 40 องศา และห้ามเกิน 55 องศา
      </SvgText>
      <SvgText x={58} y={52} size={6.8}>
        After the 3rd day of smoking, control the temperature between 40 - 55°C.
      </SvgText>

      <SvgText x={58} y={70} size={8.2} weight={700}>ประเมินวันรมควัน</SvgText>
      <SvgText x={58} y={79} size={6.8}>Smoking period</SvgText>
      <FwsCheckbox x={166} y={60} size={10} checked={form.smokingPeriodStatus === "under"} />
      <SvgText x={181} y={70} size={8.1}>อยู่ในเกณฑ์</SvgText>
      <SvgText x={181} y={79} size={6.8}>Under period</SvgText>
      <FwsCheckbox x={262} y={60} size={10} checked={smokingOver} />
      <SvgText x={277} y={70} size={8.1}>
        เกินเกณฑ์ (เกณฑ์การรมควัน = ความชื้นยาง บวกลบ 1 วัน)
      </SvgText>
      <SvgText x={277} y={79} size={6.8}>Over period (+/- 1 day)</SvgText>

      <SvgText x={58} y={96} size={8.2} weight={700}>อุณหภูมิ</SvgText>
      <SvgText x={58} y={105} size={6.8}>Temperature</SvgText>
      <FwsCheckbox x={166} y={86} size={10} checked={form.temperatureControlStatus === "underControl"} />
      <SvgText x={181} y={96} size={8.1}>อยู่ในค่าควบคุม</SvgText>
      <SvgText x={181} y={105} size={6.8}>Under Control</SvgText>
      <FwsCheckbox x={307} y={86} size={10} checked={form.temperatureControlStatus === "outOfControl"} />
      <SvgText x={322} y={96} size={8.1}>ไม่อยู่ในค่าควบคุม</SvgText>
      <SvgText x={322} y={105} size={6.8}>Out of Control</SvgText>

      <SvgText x={58} y={119} size={8.2} weight={700}>สาเหตุอุณหภูมิเกิน เพราะ</SvgText>
      <DottedLine x={178} y={119} width={850} />
      {form.reason ? <SvgText x={184} y={116} size={7.8}>{form.reason}</SvgText> : null}
      <SvgText x={58} y={128} size={6.8}>Reason for over heating</SvgText>

      <SvgText x={420} y={139} size={8.6} weight={700}>ผู้รายงาน</SvgText>
      <DottedLine x={468} y={139} width={185} />
      <SvgText x={710} y={139} size={8.6} weight={700}>ผู้อนุมัติ</SvgText>
      <DottedLine x={750} y={139} width={185} />
      </g>
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
  template,
}: {
  points: TimeSeriesPoint[];
  start: Date;
  upper: number;
  lower: number;
  template: ReportTemplateConfig;
}): ReportSlot[] {
  const target = Math.round((upper + lower) / 2);
  const indexedTemperaturePoints = points
    .map((point) => ({
      time: new Date(point.timestamp).getTime(),
      value: point.chamberTemp,
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
  const indexedHumidityPoints = points
    .map((point) => ({
      time: new Date(point.timestamp).getTime(),
      value: point.humidity,
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));

  // Anchor each company schedule at 08:00 local time so printed labels and
  // sampled data always refer to the same timestamp when a cycle starts mid-day.
  const firstSlot = new Date(start);
  firstSlot.setHours(8, 0, 0, 0);
  const reportSlotCount = template.dayCount * template.timeSlots.length;

  return Array.from({ length: reportSlotCount }, (_, index) => {
    const date = new Date(firstSlot.getTime() + index * template.intervalHours * 60 * 60 * 1000);
    const closestTemperature = findClosestPoint(indexedTemperaturePoints, date.getTime());
    const closestHumidity = findClosestPoint(indexedHumidityPoints, date.getTime());

    return {
      index,
      dayIndex: Math.floor(index / template.timeSlots.length),
      timeLabel: template.timeSlots[index % template.timeSlots.length],
      date,
      // Plot the exact same one-decimal value that is printed beside the point.
      temperature: closestTemperature ? roundReportValue(closestTemperature.value) : null,
      humidity: closestHumidity ? roundReportValue(closestHumidity.value) : null,
      target,
    };
  });
}

function roundReportValue(value: number): number {
  return Math.round(value * 10) / 10;
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

function clampReportCycleNumber(cycle: number, oven: Oven, mode: ReportMode): number {
  const safeCycle = clampCycleNumber(cycle, oven);
  if (mode === "current") return safeCycle;
  return Math.min(safeCycle, getDefaultHistoricalCycle(oven));
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
  // Windows reserves the ASCII slash for paths. The fraction slash keeps the requested
  // DD/MM/YYYY appearance while remaining a valid downloaded filename on every platform.
  const date = `${String(start.getDate()).padStart(2, "0")}⁄${String(
    start.getMonth() + 1,
  ).padStart(2, "0")}⁄${start.getFullYear()}`;
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
  .view-root:has(.report-page) {
    overflow-x: hidden;
  }

  .report-page {
    display: grid;
    gap: 14px;
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
  }

  .report-page .report-cycle-toolbar,
  .report-page .report-selection-toolbar,
  .report-page .report-form-controls,
  .report-page .report-page-shell {
    border: 1px solid color-mix(in srgb, var(--company-primary) 18%, var(--line));
    border-radius: 14px;
    background: var(--surface);
    box-shadow: 0 6px 20px rgba(15, 23, 42, 0.07);
  }

  .report-page .report-cycle-toolbar {
    margin: 0;
    padding: 14px 16px;
    border-left: 4px solid var(--company-primary);
    align-items: center;
    gap: 18px;
  }

  .report-page .report-selection-toolbar {
    display: grid;
    grid-template-columns: minmax(190px, 0.78fr) repeat(3, minmax(160px, 1fr));
    gap: 12px;
    align-items: end;
    margin: 0;
    padding: 14px 16px;
    border-left: 4px solid var(--company-primary);
  }

  .report-selection-toolbar__heading {
    display: grid;
    align-self: center;
    gap: 3px;
    padding-right: 16px;
    border-right: 1px solid var(--line);
  }

  .report-selection-toolbar__heading strong {
    color: var(--ink-strong);
    font-size: 15px;
  }

  .report-selection-toolbar__heading span {
    color: var(--muted);
    font-size: 11px;
  }

  .report-page .report-cycle-toolbar > div:first-child {
    display: grid;
    gap: 2px;
  }

  .report-download-summary {
    flex: 0 1 430px;
    min-width: 260px;
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
    flex: 1 1 680px;
    width: auto;
    min-width: 0;
  }

  .report-history-controls {
    display: flex;
    align-items: end;
    gap: 8px;
    width: 100%;
    min-width: 0;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .report-primary-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
  }

  .report-history-tabs {
    display: inline-flex;
    flex: 0 0 auto;
    gap: 6px;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: color-mix(in srgb, var(--company-primary) 4%, var(--surface-soft));
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
    text-align: right;
  }

  .report-filename-preview strong {
    color: var(--ink-strong);
    font-weight: 800;
  }

  .report-history-note.is-active {
    color: var(--ink-strong);
    font-weight: 750;
  }

  .report-page .report-form-controls {
    margin: 0;
    padding: 16px;
    border-left: 4px solid var(--company-primary);
    background: color-mix(in srgb, var(--company-primary) 2.5%, var(--surface));
  }

  .report-form-controls__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }

  .report-form-controls__heading {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .report-form-controls__heading strong {
    color: var(--ink-strong);
    font-size: 15px;
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
    border-color: color-mix(in srgb, #b42318 45%, var(--line));
    color: #9f1c13;
    background: color-mix(in srgb, #fff1f0 72%, var(--surface));
  }

  .report-form-controls__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    align-items: stretch;
  }

  .report-form-group {
    min-width: 0;
    align-self: stretch;
    margin: 0;
    padding: 12px 12px 13px;
    border: 1px solid color-mix(in srgb, var(--company-primary) 20%, var(--line));
    border-top: 2px solid color-mix(in srgb, var(--company-primary) 48%, var(--line));
    border-radius: 12px;
    background: var(--surface);
  }

  .report-form-group legend {
    padding: 0 7px;
    color: var(--ink-strong);
    border-radius: 6px;
    background: var(--surface);
    font-size: 12.5px;
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
    grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
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
    min-height: 42px;
    padding: 8px 10px;
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
    min-height: 52px;
    padding: 9px 10px;
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
    font-size: 12px;
    line-height: 1.3;
  }

  .report-choice__content small {
    color: var(--muted);
    font-size: 10.5px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .report-choice--chip:has(input:checked),
  .report-choice--option:has(input:checked),
  .report-target-toggle:has(input:checked) {
    border-color: color-mix(in srgb, var(--company-primary) 65%, var(--line));
    background: color-mix(in srgb, var(--company-primary) 10%, var(--surface));
    box-shadow:
      inset 3px 0 0 var(--company-primary),
      0 0 0 1px color-mix(in srgb, var(--company-primary) 16%, transparent);
  }

  .report-form-group--target {
    min-width: 0;
    overflow: hidden;
  }

  .report-target-row {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) minmax(170px, 1.1fr) minmax(105px, 120px);
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
    min-height: 52px;
    padding: 9px 10px;
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
    font-size: 12px;
    line-height: 1.3;
  }

  .report-target-toggle small {
    color: var(--muted);
    font-size: 10.5px;
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

  .report-form-details {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(390px, 1fr);
    gap: 12px;
    margin-top: 12px;
  }

  .report-detail-card {
    min-width: 0;
    padding: 12px;
    border: 1px solid color-mix(in srgb, var(--company-primary) 24%, var(--line));
    border-radius: 12px;
    background: var(--surface);
    box-shadow: inset 0 3px 0 color-mix(in srgb, var(--company-primary) 26%, transparent);
  }

  .report-detail-card__heading {
    display: grid;
    gap: 1px;
    margin-bottom: 9px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }

  .report-detail-card__heading strong {
    color: var(--ink-strong);
    font-size: 13px;
    line-height: 1.35;
  }

  .report-detail-card__heading span {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.35;
  }

  .report-cycle-fields {
    display: grid;
    grid-template-columns: minmax(210px, 1.25fr) repeat(3, minmax(135px, 0.8fr));
    gap: 9px;
    align-items: end;
  }

  .report-form-field {
    min-width: 0;
  }

  .report-document-field {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr) auto;
    gap: 8px;
    align-items: end;
    min-width: 0;
  }

  .report-page .report-document-lock {
    min-width: 108px;
    white-space: nowrap;
  }

  .report-page .report-document-lock.is-locked {
    border-color: color-mix(in srgb, var(--company-primary) 55%, var(--line));
    background: color-mix(in srgb, var(--company-primary) 10%, var(--surface));
  }

  .report-document-save-message {
    display: block;
    margin-top: 7px;
    color: var(--muted);
    font-size: 11px;
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

  .report-page input:not([type="checkbox"]):not([type="radio"]),
  .report-page select {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    min-height: 38px;
    padding: 7px 10px;
    border-color: var(--line);
    border-radius: 8px;
    font-size: 12px;
  }

  .report-page input:not([type="checkbox"]):not([type="radio"]):focus,
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
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
    overflow-y: visible;
    padding: 14px;
    border-left: 4px solid var(--company-primary);
  }

  .report-page .report-page-shell .fws-svg-report {
    display: block;
    width: 100% !important;
    max-width: min(1123px, 100%) !important;
    height: auto !important;
    margin-inline: auto;
  }

  @media (max-width: 1180px) {
    .report-download-summary,
    .report-history-panel {
      flex-basis: 100%;
    }

    .report-history-controls {
      flex-wrap: wrap;
      justify-content: flex-start;
    }

    .report-history-note {
      text-align: left;
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

    .report-form-details {
      grid-template-columns: 1fr;
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
    .report-cycle-fields,
    .report-document-field {
      grid-template-columns: 1fr;
    }

    .report-page .report-document-lock {
      width: 100%;
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
