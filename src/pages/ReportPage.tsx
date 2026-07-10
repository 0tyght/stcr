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
type TemperatureControlStatus =
  | "underControl"
  | "outOfControl"
  | "";

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

type ReportSlot = {
  index: number;
  dayIndex: number;
  timeLabel: string;
  date: Date;
  actual: number | null;
  target: number;
};

const defaultReportForm: ReportFormState = {
  rubberType: "",
  smokingPeriodStatus: "",
  temperatureControlStatus: "",
  reason: "",
  reporter: "",
  productionHead: "",
  targetTemperature: 45,
  showTargetLine: true,
};

const rubberOptions: Array<{
  value: Exclude<RubberType, "">;
  label: string;
}> = [
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
  {
    value: "under",
    label: "อยู่ในเกณฑ์",
    description: "Under period",
  },
  {
    value: "over",
    label: "เกินเกณฑ์",
    description: "Over period (+/- 1 day)",
  },
];

const temperatureControlOptions: Array<{
  value: Exclude<TemperatureControlStatus, "">;
  label: string;
  description: string;
}> = [
  {
    value: "underControl",
    label: "อยู่ในค่าควบคุม",
    description: "Under Control",
  },
  {
    value: "outOfControl",
    label: "ไม่อยู่ในค่าควบคุม",
    description: "Out of Control",
  },
];

const reportSensors: SensorKey[] = [
  "chamberTemp",
  "humidity",
  "furnaceTemp",
  "blowerTemp",
];

const timeSlots = [
  "08.00",
  "11.00",
  "14.00",
  "17.00",
  "20.00",
  "23.00",
  "02.00",
  "05.00",
];

const reportDayCount = 10;
const reportSlotCount = reportDayCount * timeSlots.length;

const graphMinTemp = 30;
const graphMaxTemp = 65;

const svgWidth = 1123;
const svgHeight = 794;

function getReportCompany(): ReportCompany {
  if (typeof window === "undefined") {
    return "gr";
  }

  const account = (
    window.localStorage.getItem("stcr-account") ?? ""
  ).toLowerCase();

  return account.startsWith("ttn") ? "ttn" : "gr";
}

export function ReportPage() {
  const { ovens } = useAppData();
  const [searchParams] = useSearchParams();

  const company = useMemo<ReportCompany>(
    () => getReportCompany(),
    [],
  );

  const ovenId = searchParams.get("ovenId") ?? "";

  const mode: ReportMode =
    searchParams.get("mode") === "history"
      ? "history"
      : "current";

  const autoPdf = searchParams.get("auto") === "pdf";
  const requestedCycle = Number(searchParams.get("cycle"));

  const oven =
    ovens.find((item) => item.id === ovenId) ??
    ovens.find((item) => item.number === 18) ??
    ovens[0];

  const [selectedCycle, setSelectedCycle] =
    useState<number | null>(null);

  const [rangeFromCycle, setRangeFromCycle] =
    useState<number | null>(null);

  const [rangeToCycle, setRangeToCycle] =
    useState<number | null>(null);

  const [
    historicalDownloadMode,
    setHistoricalDownloadMode,
  ] = useState<HistoricalDownloadMode>("single");

  const [points, setPoints] = useState<TimeSeriesPoint[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [autoDownloaded, setAutoDownloaded] = useState(false);

  const [reportForm, setReportForm] =
    useState<ReportFormState>(defaultReportForm);

  const reportRef = useRef<SVGSVGElement | null>(null);

  const cycleOptions = useMemo(() => {
    if (!oven) {
      return [];
    }

    const latest = Math.max(oven.cycleCount || 1, 1);

    return Array.from(
      { length: latest },
      (_, index) => latest - index,
    );
  }, [oven]);

  useEffect(() => {
    if (!oven) {
      return;
    }

    setReportForm((current) => ({
      ...current,
      targetTemperature: Math.round(
        (
          oven.limits.chamberTemp.upper +
          oven.limits.chamberTemp.lower
        ) / 2,
      ),
    }));
  }, [oven?.id]);

  useEffect(() => {
    if (!oven) {
      return;
    }

    const fallbackCycle =
      mode === "current"
        ? oven.cycleCount
        : getDefaultHistoricalCycle(oven);

    const cycle =
      Number.isFinite(requestedCycle) && requestedCycle > 0
        ? requestedCycle
        : fallbackCycle;

    const safeCycle = clampCycleNumber(cycle, oven);

    setSelectedCycle(safeCycle);
    setRangeFromCycle(safeCycle);
    setRangeToCycle(safeCycle);
    setHistoricalDownloadMode("single");
  }, [mode, oven?.id, requestedCycle]);

  const cycleRange = useMemo(() => {
    if (!oven || selectedCycle == null) {
      return null;
    }

    return getCycleRange(oven, mode, selectedCycle);
  }, [mode, oven, selectedCycle]);

  const loadReport = useCallback(async () => {
    if (!oven || !cycleRange || selectedCycle == null) {
      return;
    }

    setLoadingReport(true);
    setErrorMessage("");

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
    } catch (error) {
      console.error(error);
      setPoints([]);
      setErrorMessage("ไม่สามารถโหลดข้อมูลรายงานได้");
    } finally {
      setLoadingReport(false);
    }
  }, [cycleRange, oven, selectedCycle]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const reportSlots = useMemo(() => {
    if (!oven || !cycleRange) {
      return [];
    }

    return buildReportSlots({
      points,
      start: cycleRange.start,
      upper: oven.limits.chamberTemp.upper,
      lower: oven.limits.chamberTemp.lower,
    });
  }, [cycleRange, oven, points]);

  const renderCycleAndCreatePdfBlob = useCallback(
    async (
      cycle: number,
    ): Promise<{ blob: Blob; filename: string }> => {
      if (!oven || !reportRef.current) {
        throw new Error(
          "ยังไม่พบข้อมูลเตาหรือพื้นที่รายงาน",
        );
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

      const filename =
        `F-WS-05_OVEN${oven.number}` +
        `_Cycle${safeCycle}` +
        `_${formatFileDate(range.start)}` +
        `_to_${formatFileDate(range.end)}.pdf`;

      const blob =
        await createLandscapePdfBlobFromSvg(
          reportRef.current,
        );

      return {
        blob,
        filename,
      };
    },
    [mode, oven],
  );

  const downloadSelectedPdf = useCallback(async () => {
    if (!oven || selectedCycle == null) {
      return;
    }

    setDownloadingPdf(true);
    setDownloadMessage("กำลังสร้าง PDF...");
    setErrorMessage("");

    try {
      const safeCycle = clampCycleNumber(
        selectedCycle,
        oven,
      );

      const range = getCycleRange(
        oven,
        mode,
        safeCycle,
      );

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
        throw new Error("ไม่พบพื้นที่รายงาน");
      }

      await downloadSvgAsLandscapePdf(
        reportRef.current,
        `F-WS-05_OVEN${oven.number}` +
          `_Cycle${safeCycle}` +
          `_${formatFileDate(range.start)}` +
          `_to_${formatFileDate(range.end)}.pdf`,
      );
    } catch (error) {
      console.error(error);
      setErrorMessage("ไม่สามารถสร้างไฟล์ PDF ได้");
    } finally {
      setDownloadMessage("");
      setDownloadingPdf(false);
    }
  }, [mode, oven, selectedCycle]);

  const downloadHistoricalRangeZip =
    useCallback(async () => {
      if (
        !oven ||
        rangeFromCycle == null ||
        rangeToCycle == null
      ) {
        return;
      }

      const cycles = getCycleRangeList(
        rangeFromCycle,
        rangeToCycle,
        oven,
      );

      if (!cycles.length) {
        return;
      }

      setDownloadingPdf(true);
      setErrorMessage("");

      try {
        const zip = new JSZip();

        const folder =
          zip.folder(
            `F-WS-05_OVEN${oven.number}`,
          ) ?? zip;

        for (
          let index = 0;
          index < cycles.length;
          index += 1
        ) {
          const cycle = cycles[index];

          setDownloadMessage(
            `กำลังสร้างไฟล์ ${index + 1}` +
              `/${cycles.length} · รอบ ${cycle}`,
          );

          const { blob, filename } =
            await renderCycleAndCreatePdfBlob(cycle);

          folder.file(filename, blob);

          await waitForRender(120);
        }

        setDownloadMessage(
          "กำลังรวมไฟล์เป็น ZIP...",
        );

        const zipBlob = await zip.generateAsync({
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: {
            level: 6,
          },
        });

        const high = Math.max(
          rangeFromCycle,
          rangeToCycle,
        );

        const low = Math.min(
          rangeFromCycle,
          rangeToCycle,
        );

        downloadBlob(
          zipBlob,
          `F-WS-05_OVEN${oven.number}` +
            `_Cycle${high}_to_${low}.zip`,
        );
      } catch (error) {
        console.error(error);
        setErrorMessage(
          "ไม่สามารถสร้างไฟล์ ZIP ได้",
        );
      } finally {
        setDownloadMessage("");
        setDownloadingPdf(false);
      }
    }, [
      oven,
      rangeFromCycle,
      rangeToCycle,
      renderCycleAndCreatePdfBlob,
    ]);

  useEffect(() => {
    if (
      !autoPdf ||
      autoDownloaded ||
      loadingReport ||
      !points.length ||
      !oven
    ) {
      return;
    }

    setAutoDownloaded(true);

    window.setTimeout(() => {
      void downloadSelectedPdf();
    }, 500);
  }, [
    autoDownloaded,
    autoPdf,
    downloadSelectedPdf,
    loadingReport,
    oven,
    points.length,
  ]);

  if (!oven) {
    return (
      <EmptyState
        title="ยังไม่มีข้อมูลเตา"
        description="ยังไม่มีข้อมูลเตาสำหรับสร้างรายงาน"
      />
    );
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
    rangeFromCycle != null &&
    rangeToCycle != null
      ? getCycleRangeList(
          rangeFromCycle,
          rangeToCycle,
          oven,
        )
      : [];

  return (
    <>
      <style>{reportPageStyles}</style>

      <PageHeader
        title={
          mode === "current"
            ? "รายงานรอบปัจจุบัน"
            : "ดาวน์โหลดรายงานย้อนหลัง"
        }
        description={
          `${oven.name} · รอบ ${selectedCycle}` +
          " · แบบฟอร์ม F-WS-05" +
          " รายงานการตรวจสอบอุณหภูมิเตา"
        }
        actions={
          <>
            <Link
              className="button"
              to={`/ovens/${oven.id}`}
            >
              กลับหน้าเตา
            </Link>

            {mode === "current" ? (
              <button
                className="button button-primary"
                type="button"
                onClick={() =>
                  void downloadSelectedPdf()
                }
                disabled={
                  downloadingPdf || loadingReport
                }
              >
                <FileDown size={17} />
                {downloadingPdf
                  ? "กำลังโหลด..."
                  : "ดาวน์โหลด PDF"}
              </button>
            ) : null}

            <button
              className="button"
              type="button"
              onClick={() =>
                downloadCsv(
                  `F-WS-05-${oven.name}` +
                    `-cycle-${selectedCycle}.csv`,
                  points,
                  reportSensors,
                )
              }
              disabled={
                loadingReport ||
                !points.length ||
                downloadingPdf
              }
            >
              <Download size={17} />
              ส่งออก CSV
            </button>
          </>
        }
      />

      <section className="panel report-cycle-toolbar">
        <div className="report-cycle-toolbar__summary">
          <strong>{oven.name}</strong>

          <span>
            {formatReportDateTime(cycleRange.start)}
            {" ถึง "}
            {formatReportDateTime(cycleRange.end)}
          </span>
        </div>

        {mode === "current" ? (
          <button
            className="button button-dark"
            type="button"
            onClick={() => void loadReport()}
            disabled={
              loadingReport || downloadingPdf
            }
          >
            <RefreshCw size={17} />
            โหลดรายงานใหม่
          </button>
        ) : (
          <HistoricalDownloadControls
            cycleOptions={cycleOptions}
            selectedCycle={selectedCycle}
            rangeFromCycle={rangeFromCycle}
            rangeToCycle={rangeToCycle}
            mode={historicalDownloadMode}
            downloading={downloadingPdf}
            loading={loadingReport}
            rangeCount={rangeCycles.length}
            onModeChange={setHistoricalDownloadMode}
            onSelectedCycleChange={setSelectedCycle}
            onRangeFromChange={(cycle) => {
              setRangeFromCycle(cycle);
              setSelectedCycle(cycle);
            }}
            onRangeToChange={setRangeToCycle}
            onRefresh={() => void loadReport()}
            onDownloadSingle={() =>
              void downloadSelectedPdf()
            }
            onDownloadRange={() =>
              void downloadHistoricalRangeZip()
            }
          />
        )}
      </section>

      {downloadMessage ? (
        <div className="report-message">
          {downloadMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div
          className="report-message report-message--error"
          role="alert"
        >
          {errorMessage}
        </div>
      ) : null}

      <ReportFormControls
        form={reportForm}
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
    </>
  );
}

function HistoricalDownloadControls({
  cycleOptions,
  selectedCycle,
  rangeFromCycle,
  rangeToCycle,
  mode,
  downloading,
  loading,
  rangeCount,
  onModeChange,
  onSelectedCycleChange,
  onRangeFromChange,
  onRangeToChange,
  onRefresh,
  onDownloadSingle,
  onDownloadRange,
}: {
  cycleOptions: number[];
  selectedCycle: number;
  rangeFromCycle: number | null;
  rangeToCycle: number | null;
  mode: HistoricalDownloadMode;
  downloading: boolean;
  loading: boolean;
  rangeCount: number;
  onModeChange: (
    mode: HistoricalDownloadMode,
  ) => void;
  onSelectedCycleChange: (
    cycle: number,
  ) => void;
  onRangeFromChange: (cycle: number) => void;
  onRangeToChange: (cycle: number) => void;
  onRefresh: () => void;
  onDownloadSingle: () => void;
  onDownloadRange: () => void;
}) {
  return (
    <div className="historical-download">
      <div className="historical-download__top">
        <div className="report-mode-tabs">
          <button
            className={
              `tab ${
                mode === "single"
                  ? "is-active"
                  : ""
              }`
            }
            type="button"
            onClick={() =>
              onModeChange("single")
            }
            disabled={downloading}
          >
            โหลดไฟล์เดียว
          </button>

          <button
            className={
              `tab ${
                mode === "range"
                  ? "is-active"
                  : ""
              }`
            }
            type="button"
            onClick={() =>
              onModeChange("range")
            }
            disabled={downloading}
          >
            โหลดหลายรอบเป็น ZIP
          </button>
        </div>

        <button
          className="button button-dark"
          type="button"
          onClick={onRefresh}
          disabled={loading || downloading}
        >
          <RefreshCw size={17} />
          โหลดพรีวิวใหม่
        </button>
      </div>

      {mode === "single" ? (
        <div className="historical-download__single">
          <label className="field compact-field">
            <span>เลือกรอบย้อนหลัง</span>

            <select
              value={selectedCycle}
              disabled={downloading}
              onChange={(event) =>
                onSelectedCycleChange(
                  Number(event.target.value),
                )
              }
            >
              {cycleOptions.map((cycle) => (
                <option
                  key={cycle}
                  value={cycle}
                >
                  รอบ {cycle}
                </option>
              ))}
            </select>
          </label>

          <button
            className="button button-primary"
            type="button"
            onClick={onDownloadSingle}
            disabled={downloading || loading}
          >
            <FileDown size={17} />

            {downloading
              ? "กำลังโหลด..."
              : "ดาวน์โหลดรอบนี้"}
          </button>
        </div>
      ) : (
        <div className="historical-download__range">
          <label className="field compact-field">
            <span>ตั้งแต่รอบที่</span>

            <select
              value={rangeFromCycle ?? ""}
              disabled={downloading}
              onChange={(event) =>
                onRangeFromChange(
                  Number(event.target.value),
                )
              }
            >
              {cycleOptions.map((cycle) => (
                <option
                  key={cycle}
                  value={cycle}
                >
                  รอบ {cycle}
                </option>
              ))}
            </select>
          </label>

          <label className="field compact-field">
            <span>ถึงรอบที่</span>

            <select
              value={rangeToCycle ?? ""}
              disabled={downloading}
              onChange={(event) =>
                onRangeToChange(
                  Number(event.target.value),
                )
              }
            >
              {cycleOptions.map((cycle) => (
                <option
                  key={cycle}
                  value={cycle}
                >
                  รอบ {cycle}
                </option>
              ))}
            </select>
          </label>

          <button
            className="button button-primary"
            type="button"
            onClick={onDownloadRange}
            disabled={
              downloading ||
              loading ||
              !rangeCount
            }
          >
            <FileArchive size={17} />

            {downloading
              ? "กำลังรวม ZIP..."
              : `ดาวน์โหลด ZIP (${rangeCount} รอบ)`}
          </button>
        </div>
      )}

      <p className="historical-download__hint">
        โหมดหลายรอบจะรวม PDF เป็น ZIP
        โดยแยก 1 ไฟล์ต่อ 1 รอบ
      </p>
    </div>
  );
}

function ReportFormControls({
  form,
  onChange,
}: {
  form: ReportFormState;
  onChange: (next: ReportFormState) => void;
}) {
  function update<
    Key extends keyof ReportFormState,
  >(
    key: Key,
    value: ReportFormState[Key],
  ) {
    onChange({
      ...form,
      [key]: value,
    });
  }

  return (
    <section className="panel report-form-controls">
      <div className="report-form-controls__header">
        <div>
          <strong>
            ข้อมูลเพิ่มเติมสำหรับฟอร์ม F-WS-05
          </strong>

          <span>
            เลือกหรือกรอกข้อมูลก่อนดาวน์โหลด
            PDF ช่องเหล่านี้ไม่บังคับ
            และกดตัวเลือกเดิมซ้ำเพื่อล้างค่าได้
          </span>
        </div>

        <button
          className="button"
          type="button"
          onClick={() =>
            onChange({
              ...defaultReportForm,
              targetTemperature:
                form.targetTemperature,
              showTargetLine: true,
            })
          }
        >
          ล้างข้อมูลที่เลือก
        </button>
      </div>

      <div className="report-form-controls__grid">
        <fieldset>
          <legend>
            ชนิดยาง / Type of rubber
          </legend>

          <div className="report-choice-row">
            {rubberOptions.map((option) => (
              <label
                key={option.value}
                className="report-choice"
              >
                <input
                  type="checkbox"
                  checked={
                    form.rubberType ===
                    option.value
                  }
                  onChange={() =>
                    update(
                      "rubberType",
                      form.rubberType ===
                        option.value
                        ? ""
                        : option.value,
                    )
                  }
                />

                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            ประเมินวันรมควัน /
            Smoking period
          </legend>

          <div className="report-choice-row">
            {smokingPeriodOptions.map(
              (option) => (
                <label
                  key={option.value}
                  className="report-choice"
                >
                  <input
                    type="checkbox"
                    checked={
                      form.smokingPeriodStatus ===
                      option.value
                    }
                    onChange={() =>
                      update(
                        "smokingPeriodStatus",
                        form.smokingPeriodStatus ===
                          option.value
                          ? ""
                          : option.value,
                      )
                    }
                  />

                  <span>
                    {option.label}
                    <small>
                      {option.description}
                    </small>
                  </span>
                </label>
              ),
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            อุณหภูมิ / Temperature
          </legend>

          <div className="report-choice-row">
            {temperatureControlOptions.map(
              (option) => (
                <label
                  key={option.value}
                  className="report-choice"
                >
                  <input
                    type="checkbox"
                    checked={
                      form.temperatureControlStatus ===
                      option.value
                    }
                    onChange={() =>
                      update(
                        "temperatureControlStatus",
                        form.temperatureControlStatus ===
                          option.value
                          ? ""
                          : option.value,
                      )
                    }
                  />

                  <span>
                    {option.label}
                    <small>
                      {option.description}
                    </small>
                  </span>
                </label>
              ),
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>
            อุณหภูมิที่ต้องการ
          </legend>

          <div className="report-target-row">
            <label className="report-choice">
              <input
                type="checkbox"
                checked={form.showTargetLine}
                onChange={(event) =>
                  update(
                    "showTargetLine",
                    event.target.checked,
                  )
                }
              />

              <span>
                แสดงเส้นสีน้ำเงินในกราฟ
              </span>
            </label>

            <label className="field compact-field">
              <span>ค่าเป้าหมาย (°C)</span>

              <input
                type="number"
                min={graphMinTemp}
                max={graphMaxTemp}
                step={1}
                value={form.targetTemperature}
                onChange={(event) =>
                  update(
                    "targetTemperature",
                    Number(event.target.value),
                  )
                }
              />
            </label>
          </div>
        </fieldset>

        <label className="field compact-field">
          <span>สาเหตุ</span>

          <input
            value={form.reason}
            onChange={(event) =>
              update(
                "reason",
                event.target.value,
              )
            }
            placeholder="ระบุสาเหตุถ้ามี"
          />
        </label>

        <label className="field compact-field">
          <span>ผู้รายงาน</span>

          <input
            value={form.reporter}
            onChange={(event) =>
              update(
                "reporter",
                event.target.value,
              )
            }
            placeholder="ชื่อผู้รายงาน"
          />
        </label>

        <label className="field compact-field">
          <span>หัวหน้าฝ่ายผลิต</span>

          <input
            value={form.productionHead}
            onChange={(event) =>
              update(
                "productionHead",
                event.target.value,
              )
            }
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
  cycleRange: {
    start: Date;
    end: Date;
  };
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
      aria-label={
        "F-WS-05 " +
        "รายงานการตรวจสอบอุณหภูมิเตา"
      }
      xmlns="http://www.w3.org/2000/svg"
    >
      <style>{fwsSvgStyles}</style>

      <rect
        x="0"
        y="0"
        width={svgWidth}
        height={svgHeight}
        fill="#ffffff"
      />

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

        <FwsSvgHeader
          width={mainW}
          height={headerH}
          company={company}
        />

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

        <FwsSvgNotes
          y={noteY}
          form={form}
        />
      </g>

      <SvgText
        x={8}
        y={779}
        size={8}
      >
        F-WS-05
        รายงานการตรวจสอบอุณหภูมิเตา
        Rev.11
      </SvgText>

      <SvgText
        x={1096}
        y={779}
        size={8}
        anchor="end"
      >
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

  const logoHref =
    company === "ttn"
      ? ttnLogo
      : grLogo;

  return (
    <g>
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        fill="#ffffff"
        stroke="#000000"
      />

      <line
        x1={logoW}
        y1="0"
        x2={logoW}
        y2={height}
        stroke="#000000"
      />

      <line
        x1={docX}
        y1="0"
        x2={docX}
        y2={height}
        stroke="#000000"
      />

      <line
        x1={docX}
        y1={height / 2}
        x2={width}
        y2={height / 2}
        stroke="#000000"
      />

      <line
        x1={docX + 92}
        y1={height / 2}
        x2={docX + 92}
        y2={height}
        stroke="#000000"
      />

      <image
        href={logoHref}
        x={company === "ttn" ? 52 : 42}
        y={company === "ttn" ? 7 : 6}
        width={
          company === "ttn" ? 70 : 90
        }
        height={62}
        preserveAspectRatio="xMidYMid meet"
      />

      <SvgText
        x={logoW + titleW / 2}
        y={43}
        size={16}
        weight={800}
        anchor="middle"
      >
        รายงานการตรวจสอบอุณหภูมิเตา
      </SvgText>

      <SvgText
        x={docX + docW / 2}
        y={17}
        size={10}
        weight={800}
        anchor="middle"
      >
        Document No.
      </SvgText>

      <SvgText
        x={docX + docW / 2}
        y={34}
        size={11}
        weight={800}
        anchor="middle"
      >
        F-WS-05 Rev.11
      </SvgText>

      <SvgText
        x={docX + 46}
        y={59}
        size={10.5}
        weight={800}
        anchor="middle"
      >
        เริ่มใช้วันที่
      </SvgText>

      <SvgText
        x={docX + 148}
        y={59}
        size={11}
        weight={800}
        anchor="middle"
      >
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
  cycleRange: {
    start: Date;
    end: Date;
  };
  form: ReportFormState;
}) {
  return (
    <g transform={`translate(0 ${y})`}>
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        fill="#ffffff"
        stroke="#000000"
        strokeWidth="0.75"
      />

      <SvgText
        x={14}
        y={18}
        size={11}
        weight={700}
      >
        เตา No.
      </SvgText>

      <DottedLine
        x={60}
        y={18}
        width={82}
      />

      <SvgText
        x={101}
        y={16}
        size={11}
        weight={800}
        anchor="middle"
      >
        {oven.number}
      </SvgText>

      <SvgText
        x={14}
        y={39}
        size={11}
        weight={700}
      >
        ชนิดยาง
      </SvgText>

      <SvgText
        x={14}
        y={54}
        size={8.6}
      >
        Type of rubber
      </SvgText>

      {rubberOptions.map(
        (item, index) => {
          const x = 88 + index * 50;

          return (
            <g key={item.value}>
              <FwsCheckbox
                x={x}
                y={30}
                checked={
                  form.rubberType ===
                  item.value
                }
              />

              <SvgText
                x={x + 6.5}
                y={62}
                size={8.7}
                anchor="middle"
              >
                {item.label}
              </SvgText>
            </g>
          );
        },
      )}

      <SvgText
        x={335}
        y={18}
        size={11}
        weight={700}
      >
        เข้าเตาวันที่
      </SvgText>

      <DottedLine
        x={405}
        y={18}
        width={112}
      />

      <SvgText
        x={461}
        y={16}
        size={10.5}
        weight={700}
        anchor="middle"
      >
        {formatReportDate(
          cycleRange.start,
        )}
      </SvgText>

      <SvgText
        x={535}
        y={18}
        size={11}
        weight={700}
      >
        ออกเตาวันที่
      </SvgText>

      <DottedLine
        x={608}
        y={18}
        width={120}
      />

      <SvgText
        x={668}
        y={16}
        size={10.5}
        weight={700}
        anchor="middle"
      >
        {formatReportDate(cycleRange.end)}
      </SvgText>

      <SvgText
        x={820}
        y={18}
        size={11}
        weight={700}
      >
        เวลาปิดเตา (ติดไฟ)
      </SvgText>

      <DottedLine
        x={920}
        y={18}
        width={110}
      />

      <SvgText
        x={975}
        y={16}
        size={10.5}
        weight={700}
        anchor="middle"
      >
        {formatReportTime(cycleRange.end)}
      </SvgText>

      <SvgText
        x={1040}
        y={18}
        size={11}
        weight={700}
      >
        น.
      </SvgText>

      <SvgText
        x={335}
        y={43}
        size={11}
        weight={700}
      >
        ปริมาณน้ำหนักยางเข้าเตา
        (Net Weight) :
      </SvgText>

      <DottedLine
        x={570}
        y={43}
        width={230}
      />

      <SvgText
        x={805}
        y={43}
        size={11}
        weight={700}
      >
        (ก.ก.)
      </SvgText>

      <SvgText
        x={335}
        y={66}
        size={11}
        weight={700}
      >
        ปริมาณน้ำหนักยางออกเตา
        (Net Weight) :
      </SvgText>

      <DottedLine
        x={570}
        y={66}
        width={230}
      />

      <SvgText
        x={805}
        y={66}
        size={11}
        weight={700}
      >
        (ก.ก.)
      </SvgText>

      <SvgText
        x={935}
        y={66}
        size={10}
        weight={700}
      >
        รอบ
      </SvgText>

      <DottedLine
        x={962}
        y={66}
        width={45}
      />

      <SvgText
        x={984}
        y={64}
        size={10}
        weight={800}
        anchor="middle"
      >
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

  const chartTop =
    dayH + timeH + tempHeaderH;

  const chartH = 287;
  const chartBottom = chartTop + chartH;

  const rubberTop = chartBottom;
  const rubberMid = rubberTop + 18;

  const chartW = width - left;
  const cellW = chartW / reportSlotCount;

  const tempToY = (value: number) => {
    const clamped = Math.max(
      graphMinTemp,
      Math.min(graphMaxTemp, value),
    );

    return (
      chartTop +
      (
        (graphMaxTemp - clamped) /
        (graphMaxTemp - graphMinTemp)
      ) *
        chartH
    );
  };

  const slotToX = (index: number) =>
    left + (index + 0.5) * cellW;

  const actualPath = buildLinePath(
    slots
      .filter(
        (slot) => slot.actual !== null,
      )
      .map((slot) => ({
        x: slotToX(slot.index),
        y: tempToY(
          slot.actual ?? graphMinTemp,
        ),
      })),
  );

  const targetPath = form.showTargetLine
    ? buildLinePath(
        slots.map((slot) => ({
          x: slotToX(slot.index),
          y: tempToY(
            form.targetTemperature,
          ),
        })),
      )
    : "";

  return (
    <g transform={`translate(0 ${y})`}>
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        fill="#ffffff"
        stroke="#000000"
        strokeWidth="0.75"
      />

      <line
        x1={left}
        y1="0"
        x2={left}
        y2={height}
        stroke="#000000"
        strokeWidth="0.75"
      />

      <line
        x1="0"
        y1={dayH}
        x2={width}
        y2={dayH}
        stroke="#000000"
        strokeWidth="0.5"
      />

      <line
        x1="0"
        y1={dayH + timeH}
        x2={width}
        y2={dayH + timeH}
        stroke="#000000"
        strokeWidth="0.5"
      />

      <line
        x1="0"
        y1={chartTop}
        x2={width}
        y2={chartTop}
        stroke="#000000"
        strokeWidth="0.75"
      />

      <line
        x1="0"
        y1={chartBottom}
        x2={width}
        y2={chartBottom}
        stroke="#000000"
        strokeWidth="0.75"
      />

      <line
        x1="0"
        y1={rubberMid}
        x2={width}
        y2={rubberMid}
        stroke="#000000"
        strokeWidth="0.5"
      />

      <SvgText
        x={left / 2}
        y={19}
        size={9}
        weight={700}
        anchor="middle"
      >
        วัน
      </SvgText>

      <SvgText
        x={left / 2}
        y={dayH + 36}
        size={9}
        weight={700}
        anchor="middle"
      >
        เวลา
      </SvgText>

      <SvgText
        x={left / 2}
        y={dayH + timeH + 17}
        size={8.5}
        weight={700}
        anchor="middle"
      >
        อุณหภูมิ
      </SvgText>

      <SvgText
        x={left / 2}
        y={rubberTop + 13}
        size={8.5}
        weight={700}
        anchor="middle"
      >
        สภาพยาง
      </SvgText>

      <SvgText
        x={left / 2}
        y={rubberMid + 13}
        size={8}
        weight={700}
        anchor="middle"
      >
        หมายเหตุ
      </SvgText>

      {Array.from(
        { length: reportDayCount },
        (_, dayIndex) => {
          const x =
            left +
            dayIndex *
              timeSlots.length *
              cellW;

          const dayWidth =
            timeSlots.length * cellW;

          return (
            <g key={`day-${dayIndex}`}>
              <line
                x1={x}
                y1="0"
                x2={x}
                y2={height}
                stroke="#000000"
                strokeWidth="0.8"
              />

              <SvgText
                x={x + dayWidth / 2}
                y={19}
                size={8.5}
                weight={700}
                anchor="middle"
              >
                ({dayIndex + 1})
              </SvgText>
            </g>
          );
        },
      )}

      {Array.from(
        { length: reportSlotCount + 1 },
        (_, index) => {
          const x = left + index * cellW;
          const isDayBoundary =
            index % timeSlots.length === 0;

          return (
            <line
              key={`slot-line-${index}`}
              x1={x}
              y1={
                isDayBoundary
                  ? 0
                  : dayH
              }
              x2={x}
              y2={height}
              stroke="#000000"
              strokeWidth={
                isDayBoundary
                  ? 0.8
                  : 0.25
              }
            />
          );
        },
      )}

      {slots.map((slot) => {
        const x = slotToX(slot.index);

        return (
          <SvgText
            key={`time-${slot.index}`}
            x={x}
            y={dayH + timeH - 7}
            size={6.3}
            anchor="middle"
            transform={
              `rotate(-90 ${x} ${
                dayH + timeH - 7
              })`
            }
          >
            {slot.timeLabel}
          </SvgText>
        );
      })}

      {Array.from(
        {
          length:
            graphMaxTemp -
            graphMinTemp +
            1,
        },
        (_, index) => {
          const temperature =
            graphMaxTemp - index;

          const lineY =
            tempToY(temperature);

          const isFive =
            temperature % 5 === 0;

          const isControl =
            temperature === 40 ||
            temperature === 60;

          return (
            <g
              key={`temperature-${temperature}`}
            >
              <line
                x1={left}
                y1={lineY}
                x2={width}
                y2={lineY}
                stroke={
                  isControl
                    ? "#8d8d8d"
                    : "#c7c7c7"
                }
                strokeWidth={
                  isControl
                    ? 0.75
                    : isFive
                      ? 0.45
                      : 0.2
                }
              />

              {isFive ? (
                <SvgText
                  x={left - 7}
                  y={lineY + 3}
                  size={7}
                  anchor="end"
                >
                  {temperature}
                </SvgText>
              ) : null}
            </g>
          );
        },
      )}

      <SvgText
        x={8}
        y={tempToY(60) + 3}
        size={6.5}
      >
        60
      </SvgText>

      <SvgText
        x={8}
        y={tempToY(40) + 3}
        size={6.5}
      >
        40
      </SvgText>

      <line
        x1={left}
        y1={tempToY(upper)}
        x2={width}
        y2={tempToY(upper)}
        stroke="#666666"
        strokeDasharray="4 3"
        strokeWidth="0.7"
      />

      <line
        x1={left}
        y1={tempToY(lower)}
        x2={width}
        y2={tempToY(lower)}
        stroke="#666666"
        strokeDasharray="4 3"
        strokeWidth="0.7"
      />

      <SvgText
        x={width - 4}
        y={tempToY(upper) - 3}
        size={6.5}
        anchor="end"
      >
        Upper
      </SvgText>

      <SvgText
        x={width - 4}
        y={tempToY(lower) - 3}
        size={6.5}
        anchor="end"
      >
        Lower
      </SvgText>

      {targetPath ? (
        <path
          d={targetPath}
          fill="none"
          stroke="#165dca"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}

      {actualPath ? (
        <path
          d={actualPath}
          fill="none"
          stroke="#d12b2b"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}

      {slots
        .filter(
          (slot) =>
            slot.actual !== null,
        )
        .map((slot) => (
          <circle
            key={`point-${slot.index}`}
            cx={slotToX(slot.index)}
            cy={tempToY(
              slot.actual ??
                graphMinTemp,
            )}
            r="1.5"
            fill="#ffffff"
            stroke="#d12b2b"
            strokeWidth="0.8"
          />
        ))}

      <SvgText
        x={left + 7}
        y={rubberTop + 13}
        size={7.2}
      >
        รมควัน
      </SvgText>

      <SvgText
        x={left + 7}
        y={rubberMid + 13}
        size={7.2}
      >
        อุ่น
      </SvgText>
    </g>
  );
}

function FwsSvgNotes({
  y,
  form,
}: {
  y: number;
  form: ReportFormState;
}) {
  const width = 1073;

  /*
   * พื้นที่ของ FwsSvgNotes เริ่มที่ y = 607
   * และกรอบหลักสิ้นสุดที่ y = 730
   * จึงมีพื้นที่ใช้งานประมาณ 123 px
   *
   * signatureY = 116 ทำให้ตำแหน่ง
   * ลายเซ็นอยู่ที่ y = 723 ภายในกรอบ
   */
  const rightColumnX = 535;
  const topSectionBottom = 45;

  const evaluationY = 53;
  const reasonY = 91;
  const signatureY = 116;

  return (
    <g transform={`translate(0 ${y})`}>
      <line
        x1="0"
        y1="0"
        x2={width}
        y2="0"
        stroke="#000000"
        strokeWidth="0.75"
      />

      {/* คอลัมน์ซ้ายและขวา */}
      <line
        x1={rightColumnX}
        y1="0"
        x2={rightColumnX}
        y2={topSectionBottom}
        stroke="#000000"
        strokeWidth="0.5"
      />

      {/* คอลัมน์ซ้าย: สภาพยาง */}
      <SvgText
        x={10}
        y={14}
        size={8.2}
      >
        * ✕ ไม่สุก (ปากกาสีน้ำเงิน) /
        ✓ สุก (ปากกาสีแดง)
      </SvgText>

      <SvgText
        x={10}
        y={31}
        size={8.2}
      >
        0 ยางสุกแล้วยังไม่ออกเตา
        (อุ่นใช้ปากกาสีแดง)
      </SvgText>

      {/* คอลัมน์ขวา: เกณฑ์อุณหภูมิ */}
      <SvgText
        x={rightColumnX + 10}
        y={12}
        size={8}
      >
        ** ควบคุมอุณหภูมิ:
        [รมควัน] 40 - 60°C,
        [อุ่นยาง] 35 - 40°C
      </SvgText>

      <SvgText
        x={rightColumnX + 10}
        y={27}
        size={7.8}
      >
        After the 3rd day of smoking,
        control the temperature between
        40 - 55 °C.
      </SvgText>

      <SvgText
        x={rightColumnX + 10}
        y={41}
        size={6.9}
      >
        (ประเมินอุณหภูมิวันที่ 3
        หลังปิดเตา 2 วัน /
        เกณฑ์การรมควัน =
        ความชื้นยาง บวกลบ 1 วัน)
      </SvgText>

      <line
        x1="0"
        y1={topSectionBottom}
        x2={width}
        y2={topSectionBottom}
        stroke="#000000"
        strokeWidth="0.5"
      />

      {/* ประเมินวันรมควัน */}
      <SvgText
        x={10}
        y={evaluationY + 7}
        size={8.2}
        weight={700}
      >
        ประเมินวันรมควัน
      </SvgText>

      <SvgText
        x={10}
        y={evaluationY + 19}
        size={7.1}
      >
        Smoking period
      </SvgText>

      <FwsCheckbox
        x={108}
        y={evaluationY - 3}
        checked={
          form.smokingPeriodStatus ===
          "under"
        }
      />

      <SvgText
        x={127}
        y={evaluationY + 7}
        size={8}
      >
        อยู่ในเกณฑ์
      </SvgText>

      <SvgText
        x={127}
        y={evaluationY + 19}
        size={7}
      >
        Under period
      </SvgText>

      <FwsCheckbox
        x={222}
        y={evaluationY - 3}
        checked={
          form.smokingPeriodStatus ===
          "over"
        }
      />

      <SvgText
        x={241}
        y={evaluationY + 7}
        size={8}
      >
        เกินเกณฑ์
      </SvgText>

      <SvgText
        x={241}
        y={evaluationY + 19}
        size={7}
      >
        Over period (+/- 1 day)
      </SvgText>

      {/* ประเมินอุณหภูมิ */}
      <SvgText
        x={397}
        y={evaluationY + 7}
        size={8.2}
        weight={700}
      >
        อุณหภูมิ
      </SvgText>

      <SvgText
        x={397}
        y={evaluationY + 19}
        size={7.1}
      >
        Temperature
      </SvgText>

      <FwsCheckbox
        x={463}
        y={evaluationY - 3}
        checked={
          form.temperatureControlStatus ===
          "underControl"
        }
      />

      <SvgText
        x={482}
        y={evaluationY + 7}
        size={8}
      >
        อยู่ในค่าควบคุม
      </SvgText>

      <SvgText
        x={482}
        y={evaluationY + 19}
        size={7}
      >
        Under Control
      </SvgText>

      <FwsCheckbox
        x={589}
        y={evaluationY - 3}
        checked={
          form.temperatureControlStatus ===
          "outOfControl"
        }
      />

      <SvgText
        x={608}
        y={evaluationY + 7}
        size={8}
      >
        ไม่อยู่ในค่าควบคุม
      </SvgText>

      <SvgText
        x={608}
        y={evaluationY + 19}
        size={7}
      >
        Out of Control
      </SvgText>

      {/* คำอธิบายสีเส้นกราฟ */}
      <SvgText
        x={770}
        y={evaluationY + 7}
        size={7.7}
      >
        สีน้ำเงิน =
        อุณหภูมิที่ต้องการ :
        หัวหน้างาน
      </SvgText>

      <SvgText
        x={770}
        y={evaluationY + 21}
        size={7.7}
      >
        สีแดง =
        อุณหภูมิจริง :
        พนักงานคุมเตา
      </SvgText>

      {/* สาเหตุ */}
      <SvgText
        x={10}
        y={reasonY}
        size={8.5}
        weight={700}
      >
        สาเหตุ
      </SvgText>

      <DottedLine
        x={48}
        y={reasonY}
        width={1005}
      />

      {form.reason ? (
        <SvgText
          x={550}
          y={reasonY - 2}
          size={8.3}
          anchor="middle"
        >
          {form.reason}
        </SvgText>
      ) : null}

      {/* ลายเซ็นอยู่ภายในกรอบ */}
      <SvgText
        x={10}
        y={signatureY}
        size={8.5}
        weight={700}
      >
        ผู้รายงาน
      </SvgText>

      <DottedLine
        x={61}
        y={signatureY}
        width={356}
      />

      {form.reporter ? (
        <SvgText
          x={239}
          y={signatureY - 2}
          size={8.3}
          anchor="middle"
        >
          {form.reporter}
        </SvgText>
      ) : null}

      <SvgText
        x={540}
        y={signatureY}
        size={8.5}
        weight={700}
      >
        หัวหน้าฝ่ายผลิต
      </SvgText>

      <DottedLine
        x={627}
        y={signatureY}
        width={426}
      />

      {form.productionHead ? (
        <SvgText
          x={840}
          y={signatureY - 2}
          size={8.3}
          anchor="middle"
        >
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
      <rect
        x={x}
        y={y}
        width={size}
        height={size}
        fill="#ffffff"
        stroke="#000000"
        strokeWidth="0.75"
      />

      {checked ? (
        <path
          d={
            `M ${x + 2.5} ${y + size / 2}` +
            ` L ${x + size / 2 - 0.5} ${
              y + size - 2.5
            }` +
            ` L ${x + size - 2} ${y + 2.5}`
          }
          fill="none"
          stroke="#000000"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </g>
  );
}

function DottedLine({
  x,
  y,
  width,
}: {
  x: number;
  y: number;
  width: number;
}) {
  return (
    <line
      x1={x}
      y1={y}
      x2={x + width}
      y2={y}
      stroke="#000000"
      strokeWidth="0.65"
      strokeDasharray="1.4 2.2"
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
  transform,
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  weight?: number;
  anchor?: SvgTextAnchor;
  transform?: string;
}) {
  return (
    <text
      x={x}
      y={y}
      transform={transform}
      fontFamily={
        "'Sarabun', 'TH Sarabun New'," +
        " Arial, sans-serif"
      }
      fontSize={size}
      fontWeight={weight}
      data-weight={
        weight >= 700 ? "700" : "400"
      }
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
): {
  start: Date;
  end: Date;
} {
  const now = new Date();

  if (
    mode === "current" &&
    oven.startedAt &&
    oven.status === "open"
  ) {
    const end = now;

    return {
      start: clampCycleStart(
        new Date(oven.startedAt),
        end,
      ),
      end,
    };
  }

  const latestCycle = Math.max(
    oven.cycleCount,
    1,
  );

  const cycleOffset = Math.max(
    0,
    latestCycle - cycleNumber,
  );

  const baseEnd = new Date(
    oven.stoppedAt ??
      oven.lastUpdatedAt ??
      now,
  );

  const end = new Date(
    baseEnd.getTime() -
      cycleOffset *
        (
          REPORT_CYCLE_MS +
          12 * 60 * 60 * 1000
        ),
  );

  const start = new Date(
    end.getTime() - REPORT_CYCLE_MS,
  );

  return {
    start,
    end,
  };
}

function getDefaultHistoricalCycle(
  oven: Oven,
): number {
  if (oven.status === "open") {
    return Math.max(
      1,
      oven.cycleCount - 1,
    );
  }

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
  const target = Math.round(
    (upper + lower) / 2,
  );

  const indexedPoints = points
    .map((point) => ({
      time: new Date(
        point.timestamp,
      ).getTime(),
      value: point.chamberTemp,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.time) &&
        Number.isFinite(point.value),
    );

  return Array.from(
    { length: reportSlotCount },
    (_, index) => {
      const date = new Date(
        start.getTime() +
          index * 3 * 60 * 60 * 1000,
      );

      const closest = findClosestPoint(
        indexedPoints,
        date.getTime(),
      );

      return {
        index,
        dayIndex: Math.floor(
          index / timeSlots.length,
        ),
        timeLabel:
          timeSlots[
            index % timeSlots.length
          ],
        date,
        actual: closest
          ? closest.value
          : null,
        target,
      };
    },
  );
}

function findClosestPoint(
  points: Array<{
    time: number;
    value: number;
  }>,
  targetTime: number,
): {
  time: number;
  value: number;
} | null {
  if (!points.length) {
    return null;
  }

  const maxDistance =
    90 * 60 * 1000;

  let closest = points[0];

  let distance = Math.abs(
    points[0].time - targetTime,
  );

  for (const point of points) {
    const nextDistance = Math.abs(
      point.time - targetTime,
    );

    if (nextDistance < distance) {
      closest = point;
      distance = nextDistance;
    }
  }

  return distance <= maxDistance
    ? closest
    : null;
}

function buildLinePath(
  points: Array<{
    x: number;
    y: number;
  }>,
): string {
  if (!points.length) {
    return "";
  }

  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ` +
        `${point.x.toFixed(2)} ` +
        `${point.y.toFixed(2)}`,
    )
    .join(" ");
}

function clampCycleNumber(
  cycle: number,
  oven: Oven,
): number {
  const latest = Math.max(
    oven.cycleCount,
    1,
  );

  return Math.min(
    Math.max(1, Math.round(cycle)),
    latest,
  );
}

function getCycleRangeList(
  from: number,
  to: number,
  oven: Oven,
): number[] {
  const safeFrom = clampCycleNumber(
    from,
    oven,
  );

  const safeTo = clampCycleNumber(
    to,
    oven,
  );

  const high = Math.max(
    safeFrom,
    safeTo,
  );

  const low = Math.min(
    safeFrom,
    safeTo,
  );

  return Array.from(
    { length: high - low + 1 },
    (_, index) => high - index,
  );
}

function waitForRender(
  milliseconds: number,
): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(
      resolve,
      milliseconds,
    );
  });
}

function formatReportDate(
  value: Date,
): string {
  const buddhistShortYear = String(
    value.getFullYear() + 543,
  ).slice(-2);

  return (
    `${String(value.getDate()).padStart(
      2,
      "0",
    )}-` +
    `${String(
      value.getMonth() + 1,
    ).padStart(2, "0")}-` +
    buddhistShortYear
  );
}

function formatFileDate(
  value: Date,
): string {
  return (
    `${String(value.getDate()).padStart(
      2,
      "0",
    )}` +
    `${String(
      value.getMonth() + 1,
    ).padStart(2, "0")}` +
    `${value.getFullYear()}`
  );
}

function formatReportTime(
  value: Date,
): string {
  return (
    `${String(value.getHours()).padStart(
      2,
      "0",
    )}.` +
    `${String(
      value.getMinutes(),
    ).padStart(2, "0")}`
  );
}

function formatReportDateTime(
  value: Date,
): string {
  return (
    `${formatReportDate(value)} ` +
    formatReportTime(value)
  );
}

const reportPageStyles = `
  .report-cycle-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }

  .report-cycle-toolbar__summary {
    display: grid;
    gap: 4px;
  }

  .report-cycle-toolbar__summary strong {
    color: var(--ink-strong);
  }

  .report-cycle-toolbar__summary span {
    color: var(--muted);
    font-size: 13px;
  }

  .historical-download {
    display: grid;
    gap: 12px;
    width: min(100%, 760px);
  }

  .historical-download__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .report-mode-tabs {
    display: inline-flex;
    gap: 8px;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface-soft);
  }

  .historical-download__single {
    display: grid;
    grid-template-columns:
      minmax(220px, 1fr) auto;
    gap: 12px;
    align-items: end;
  }

  .historical-download__range {
    display: grid;
    grid-template-columns:
      minmax(160px, 1fr)
      minmax(160px, 1fr)
      auto;
    gap: 12px;
    align-items: end;
  }

  .historical-download__hint {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }

  .report-message {
    margin: 0 0 14px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface-soft);
    color: var(--ink-strong);
    font-size: 13px;
    font-weight: 700;
  }

  .report-message--error {
    border-color:
      color-mix(
        in srgb,
        var(--danger, #c62828) 45%,
        var(--line)
      );
    color: var(--danger, #c62828);
  }

  .report-page-shell {
    overflow-x: auto;
    padding-bottom: 8px;
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
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .report-form-controls fieldset {
    margin: 0;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface-soft);
  }

  .report-form-controls legend {
    padding: 0 6px;
    color: var(--ink-strong);
    font-size: 13px;
    font-weight: 800;
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
    color: var(--ink-strong);
    font-size: 13px;
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
    grid-template-columns:
      minmax(180px, 1fr) 140px;
    gap: 12px;
    align-items: end;
  }

  @media (max-width: 980px) {
    .report-cycle-toolbar {
      align-items: stretch;
      flex-direction: column;
    }

    .report-form-controls__grid {
      grid-template-columns: 1fr;
    }

    .historical-download__single,
    .historical-download__range {
      grid-template-columns: 1fr;
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

  .fws-svg-report text {
    font-family:
      "Sarabun",
      "TH Sarabun New",
      Arial,
      sans-serif;
  }
`;