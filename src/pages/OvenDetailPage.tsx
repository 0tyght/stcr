import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  History,
  ListFilter,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Thermometer,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

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
import type { LimitMap, Oven, OvenStatus, SensorKey, TimeSeriesPoint } from "../types";
import { formatDateTime } from "../utils/format";
import { getReadingState } from "../utils/limits";
import { getHistoricalCycleRange } from "../utils/reportCycle";
import { allSensorKeys } from "../utils/sensors";

type ChartMode = "realtime" | "historical";
type HistoryPickMode = "cycle" | "date";

type CycleRecord = {
  cycle: number;
  start: Date;
  end: Date;
  startDateKey: string;
  endDateKey: string;
  label: string;
  rangeLabel: string;
};

const environmentSensors: SensorKey[] = ["chamberTemp", "humidity"];
const heatSensors: SensorKey[] = ["furnaceTemp", "blowerTemp"];

const realtimeGaugeOrder: SensorKey[] = [
  "furnaceTemp",
  "blowerTemp",
  "chamberTemp",
  "humidity",
];

export function OvenDetailPage() {
  const { ovenId = "" } = useParams();
  const { ovens, alarms, loading, refresh, refreshing } = useAppData();

  const oven = ovens.find((item) => item.id === ovenId);

  const [mode, setMode] = useState<ChartMode>("realtime");
  const [historyPickMode, setHistoryPickMode] = useState<HistoryPickMode>("cycle");
  const [selectedCycle, setSelectedCycle] = useState<number | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [calendarCursor, setCalendarCursor] = useState<Date>(() => new Date());
  const [points, setPoints] = useState<TimeSeriesPoint[]>([]);
  const [currentReportFrameSrc, setCurrentReportFrameSrc] = useState<string | null>(null);

  const realtimeAvailable = oven ? canUseRealtime(oven.status) : false;

  const cycleRecords = useMemo<CycleRecord[]>(() => {
    if (!oven) return [];

    const latestCycle = getDefaultHistoricalCycle(oven);
    const availableCycleCount = Math.min(6, latestCycle);

    return Array.from({ length: availableCycleCount }, (_, index) => {
      const cycle = latestCycle - index;
      const range = getDetailCycleRange(oven, "historical", cycle);

      return {
        cycle,
        start: range.start,
        end: range.end,
        startDateKey: toDateKey(range.start),
        endDateKey: toDateKey(range.end),
        label: `รอบที่ ${cycle}`,
        rangeLabel: `${formatShortThaiDateTime(range.start)} - ${formatShortThaiDateTime(
          range.end,
        )}`,
      };
    });
  }, [oven]);

  const selectedRecord = useMemo(() => {
    if (!selectedCycle) return null;
    return cycleRecords.find((record) => record.cycle === selectedCycle) ?? null;
  }, [cycleRecords, selectedCycle]);

  const selectedDateRecords = useMemo(() => {
    if (!selectedDateKey) return [];

    return cycleRecords.filter((record) =>
      isDateKeyInRange(selectedDateKey, record.startDateKey, record.endDateKey),
    );
  }, [cycleRecords, selectedDateKey]);

  const calendarCells = useMemo(() => getCalendarCells(calendarCursor), [calendarCursor]);
  const effectiveMode =
    realtimeAvailable ? mode : "historical";

  const cycleRange = useMemo(() => {
    if (!oven) return null;

    return getDetailCycleRange(
      oven,
      effectiveMode,
      selectedCycle ??
        getDefaultHistoricalCycle(oven),
    );
  }, [
    effectiveMode,
    oven,
    selectedCycle,
  ]);
  const historyStartAt =
    cycleRange?.start.toISOString() ?? "";
  const historyEndAt =
    effectiveMode === "historical"
      ? cycleRange?.end.toISOString() ?? ""
      : "";
  const historyCycleNumber =
    effectiveMode === "historical"
      ? selectedCycle ?? undefined
      : oven?.cycleCount;
  const historyIncludeIgnition =
    effectiveMode === "realtime" &&
    !oven?.reportStartedAt;

  useEffect(() => {
    if (!oven?.id || !historyStartAt) return;

    let cancelled = false;

    const loadHistory = async () => {
      const nextPoints = await apiClient.getHistory({
        ovenId: oven.id,
        preset: "custom",
        sensors: allSensorKeys,
        startAt: historyStartAt,
        endAt:
          effectiveMode === "realtime"
            ? new Date().toISOString()
            : historyEndAt,
        cycleNumber: historyCycleNumber,
        includeIgnition: historyIncludeIgnition,
      });

      if (!cancelled) {
        setPoints(nextPoints);
      }
    };

    void loadHistory();

    const timer =
      effectiveMode === "realtime"
        ? window.setInterval(
            () => void loadHistory(),
            60_000,
          )
        : null;

    return () => {
      cancelled = true;

      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [
    effectiveMode,
    historyCycleNumber,
    historyEndAt,
    historyIncludeIgnition,
    historyStartAt,
    oven?.id,
  ]);
const ovenAlarms = useMemo(
    () => alarms.filter((alarm) => alarm.ovenId === ovenId),
    [alarms, ovenId],
  );

  if (loading) {
    return <LoadingState />;
  }

  if (!oven) {
    return <Navigate to="/" replace />;
  }

  function handleSelectCycle(cycle: number) {
    const record = cycleRecords.find((item) => item.cycle === cycle);

    setHistoryPickMode("cycle");
    setSelectedCycle(cycle);

    if (record) {
      setSelectedDateKey(record.endDateKey);
      setCalendarCursor(record.end);
    }
  }

  function handleSelectDate(dateKey: string) {
    const records = cycleRecords.filter((record) =>
      isDateKeyInRange(dateKey, record.startDateKey, record.endDateKey),
    );

    setHistoryPickMode("date");
    setSelectedDateKey(dateKey);

    if (records.length) {
      setSelectedCycle(records[0].cycle);
      setCalendarCursor(createDateFromKey(dateKey));
    }
  }

  function handleResetHistory() {
    if (!oven) return;

    const defaultCycle = getDefaultHistoricalCycle(oven);
    const record = cycleRecords.find((item) => item.cycle === defaultCycle);

    setHistoryPickMode("cycle");
    setSelectedCycle(defaultCycle);

    if (record) {
      setSelectedDateKey(record.endDateKey);
      setCalendarCursor(record.end);
    }
  }

  function handleDownloadCurrentReport() {
    if (!oven || !oven.reportStartedAt) return;

    const reportUrl = createReportFrameUrl({
      ovenId: oven.id,
      mode: "current",
      cycle: oven.cycleCount,
    });

    setCurrentReportFrameSrc(reportUrl);
  }

  const currentCycleLabel =
    effectiveMode === "realtime"
      ? `รอบปัจจุบัน ${oven.cycleCount}`
      : selectedRecord
        ? `${selectedRecord.label}`
        : "ยังไม่ได้เลือกรอบย้อนหลัง";

  return (
    <>
      <PageHeader
        title={`${oven.name} / Temperature control`}
        description={`${oven.zone} · ${oven.line} · อัปเดตล่าสุด ${formatDateTime(
          oven.lastUpdatedAt,
        )}`}
        actions={
          <>
            <StatusBadge kind={oven.status} />

            <button
              className="button"
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <RefreshCw size={17} />
              {refreshing ? "กำลังรีเฟรช" : "รีเฟรช"}
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
            title={
              realtimeAvailable
                ? "ดูกราฟรอบปัจจุบัน"
                : "เตานี้ไม่ได้เปิดอยู่ จึงไม่มีกราฟปัจจุบัน"
            }
          >
            ปัจจุบัน
          </button>

          <button
            className={`tab ${effectiveMode === "historical" ? "is-active" : ""}`}
            type="button"
            onClick={() => setMode("historical")}
          >
            ย้อนหลัง
          </button>
        </div>

        {effectiveMode === "realtime" ? (
          <p className="mode-note">
            <CalendarClock size={16} />
            ปัจจุบัน คือกราฟรอบที่กำลังอบอยู่ ข้อมูลจะเติมเข้ากราฟตามรอบส่งจริง
          </p>
        ) : (
          <p className="mode-note">
            <History size={16} />
            ย้อนหลัง เลือกดูได้ทั้งตามรอบอบหรือวันที่ที่มีข้อมูล
          </p>
        )}

        {!realtimeAvailable ? (
          <p className="mode-note mode-note-warning">
            เตานี้อยู่สถานะ {statusText(oven.status)} จึงดูได้เฉพาะข้อมูลย้อนหลังตามรอบอบ
          </p>
        ) : null}
      </section>

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
            {effectiveMode === "realtime" ? (
              <button
                className="button button-primary"
                type="button"
                onClick={handleDownloadCurrentReport}
                disabled={!oven.reportStartedAt}
                title={oven.reportStartedAt ? "ดาวน์โหลดรายงานรอบปัจจุบัน" : "รอข้อมูลเปิดเตาจาก MQTT"}
              >
                <FileDown size={17} />
                {oven.reportStartedAt ? "โหลดรายงานปัจจุบัน" : "รอข้อมูลเปิดเตา"}
              </button>
            ) : (
              <Link
                className="button button-primary"
                to={`/reports?ovenId=${oven.id}&mode=history&cycle=${
                  selectedCycle ?? getDefaultHistoricalCycle(oven)
                }`}
              >
                <FileDown size={17} />
                เปิดหน้ารายงานย้อนหลัง
              </Link>
            )}

            <button
              className="button"
              type="button"
              onClick={() => downloadCsv(`${oven.name}-cycle.csv`, points, allSensorKeys)}
            >
              <Download size={17} />
              ส่งออก CSV
            </button>
          </div>
        </div>

        <div className="status-side-stack">
          <div className={`status-panel status-banner status-${oven.status}`}>
            <p>สถานะเตา</p>
            <strong>{statusText(oven.status)}</strong>
            <span>{oven.cycleCount} รอบทั้งหมด</span>
          </div>

          {effectiveMode === "realtime" && realtimeAvailable ? (
            oven.reportStartedAt ? (
              <TemperatureRangeCard oven={oven} />
            ) : (
              <div className="status-range-card status-normal">
                <p>
                  <Thermometer size={16} />
                  ช่วงอุณหภูมิ
                </p>
                <strong>รอข้อมูลเปิดเตา</strong>
                <span>ระบบจะเริ่มบันทึกรอบทันทีเมื่อ MQTT แจ้งว่าเตาเปิด</span>
              </div>
            )
          ) : null}

          {effectiveMode === "historical" ? (
            <div className="status-range-card status-normal">
              <p>
                <History size={16} />
                รอบที่กำลังดู
              </p>

              <strong>{currentCycleLabel}</strong>

              <span>
                {selectedRecord
                  ? selectedRecord.rangeLabel
                  : cycleRange
                    ? `${formatShortThaiDateTime(cycleRange.start)} - ${formatShortThaiDateTime(
                        cycleRange.end,
                      )}`
                    : "-"}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {effectiveMode === "realtime" ? (
        <>
          <section className="realtime-gauge-grid" aria-label="ค่า realtime จากเซนเซอร์">
            {realtimeGaugeOrder.map((sensor) => (
              <SensorGauge
                key={sensor}
                sensor={sensor}
                value={oven.readings[sensor].value}
                updatedAt={oven.readings[sensor].updatedAt}
                limit={getGaugeLimit(oven, sensor)}
                showLimit={Boolean(oven.reportStartedAt) && sensor !== "humidity"}
              />
            ))}
          </section>

          <section className="chart-grid-two">
            <ChartPanel
              title="อุณหภูมิและความชื้นในห้องอบ"
              description="1 กราฟต่อ 1 รอบอบ แสดงเส้น Upper/Lower เฉพาะอุณหภูมิห้องอบ"
              points={points}
              sensors={environmentSensors}
              limits={oven.limits}
              mode={effectiveMode}
              rightAxisSensors={["humidity"]}
              leftAxisName="อุณหภูมิ °C"
              rightAxisName="ความชื้น %"
              limitSensors={["chamberTemp"]}
              timeRange={cycleRange ?? undefined}
            />

            <ChartPanel
              title="อุณหภูมิเตาเผาและ Blower"
              description="เตาเผาและ Blower ใช้ Upper/Lower ชุดเดียวกัน"
              points={points}
              sensors={heatSensors}
              limits={oven.limits}
              mode={effectiveMode}
              rightAxisSensors={[]}
              leftAxisName="อุณหภูมิ °C"
              rightAxisName=""
              limitSensors={["furnaceTemp"]}
              limitLabel="เตาเผา / Blower"
              timeRange={cycleRange ?? undefined}
            />
          </section>
        </>
      ) : (
        <HistoricalChartSection
          cycleRecords={cycleRecords}
          historyPickMode={historyPickMode}
          selectedCycle={selectedCycle}
          selectedDateKey={selectedDateKey}
          selectedDateRecords={selectedDateRecords}
          selectedRecord={selectedRecord}
          calendarCursor={calendarCursor}
          calendarCells={calendarCells}
          points={points}
          limits={oven.limits}
          onChangePickMode={setHistoryPickMode}
          onSelectCycle={handleSelectCycle}
          onSelectDate={handleSelectDate}
          onReset={handleResetHistory}
          onShiftMonth={(direction) =>
            setCalendarCursor((current) => shiftMonth(current, direction))
          }
          onSelectDateCycle={(cycle) => {
            setHistoryPickMode("date");
            setSelectedCycle(cycle);
          }}
        />
      )}

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

      {currentReportFrameSrc ? (
        <iframe
          key={currentReportFrameSrc}
          title="ดาวน์โหลดรายงานปัจจุบัน"
          src={currentReportFrameSrc}
          style={{
            position: "fixed",
            width: 1,
            height: 1,
            right: 0,
            bottom: 0,
            opacity: 0,
            pointerEvents: "none",
            border: 0,
          }}
        />
      ) : null}
    </>
  );
}

function HistoricalChartSection({
  cycleRecords,
  historyPickMode,
  selectedCycle,
  selectedDateKey,
  selectedDateRecords,
  selectedRecord,
  calendarCursor,
  calendarCells,
  points,
  limits,
  onChangePickMode,
  onSelectCycle,
  onSelectDate,
  onReset,
  onShiftMonth,
  onSelectDateCycle,
}: {
  cycleRecords: CycleRecord[];
  historyPickMode: HistoryPickMode;
  selectedCycle: number | null;
  selectedDateKey: string | null;
  selectedDateRecords: CycleRecord[];
  selectedRecord: CycleRecord | null;
  calendarCursor: Date;
  calendarCells: Date[];
  points: TimeSeriesPoint[];
  limits: LimitMap;
  onChangePickMode: (mode: HistoryPickMode) => void;
  onSelectCycle: (cycle: number) => void;
  onSelectDate: (dateKey: string) => void;
  onReset: () => void;
  onShiftMonth: (direction: number) => void;
  onSelectDateCycle: (cycle: number) => void;
}) {
  return (
    <section className="panel" style={styles.historicalShell}>
      <div className="panel-heading">
        <div>
          <h2>กราฟข้อมูลย้อนหลัง</h2>
          <p>
            {selectedRecord
              ? `${selectedRecord.label} · ${selectedRecord.rangeLabel}`
              : "เลือกประวัติที่ต้องการดูจากตัวกรองด้านล่าง"}
          </p>
        </div>

        <span className="panel-mode-chip">ย้อนหลัง</span>
      </div>

      <div style={styles.historyFilterPanel}>
        <div style={styles.historyFilterHeader}>
          <div style={styles.historyModeTabs} aria-label="วิธีเลือกข้อมูลย้อนหลัง">
            <button
              className={`tab ${historyPickMode === "cycle" ? "is-active" : ""}`}
              type="button"
              onClick={() => onChangePickMode("cycle")}
            >
              <ListFilter size={15} />
              ตามรอบอบ
            </button>
            <button
              className={`tab ${historyPickMode === "date" ? "is-active" : ""}`}
              type="button"
              onClick={() => onChangePickMode("date")}
            >
              <CalendarDays size={15} />
              ตามวันที่
            </button>
          </div>

          <button className="button" type="button" onClick={onReset}>
            <RotateCcw size={15} />
            รอบล่าสุด
          </button>
        </div>

        {historyPickMode === "cycle" ? (
          <div style={styles.cyclePickerRow}>
            <label className="field compact-field" style={styles.cycleSelectField}>
              <span>รอบอบ</span>
              <select
                value={selectedCycle ?? ""}
                onChange={(event) => onSelectCycle(Number(event.target.value))}
              >
                {cycleRecords.map((record) => (
                  <option key={record.cycle} value={record.cycle}>
                    {record.label} · {record.rangeLabel}
                  </option>
                ))}
              </select>
            </label>

            <div style={styles.compactSelectionSummary}>
              <strong>{selectedRecord ? selectedRecord.label : "-"}</strong>
              <span>{selectedRecord ? selectedRecord.rangeLabel : "ยังไม่ได้เลือกรอบ"}</span>
            </div>
          </div>
        ) : (
          <div style={styles.calendarLayout}>
            <CalendarPicker
              cursor={calendarCursor}
              cells={calendarCells}
              cycleRecords={cycleRecords}
              selectedDateKey={selectedDateKey}
              selectedRecord={selectedRecord}
              onSelectDate={onSelectDate}
              onShiftMonth={onShiftMonth}
            />

            <div style={styles.dateSidePanel}>
              <label className="field compact-field">
                <span>รอบของวันที่เลือก</span>
                <select
                  value={selectedCycle ?? ""}
                  disabled={!selectedDateRecords.length}
                  onChange={(event) => onSelectDateCycle(Number(event.target.value))}
                >
                  {selectedDateRecords.length ? (
                    selectedDateRecords.map((record) => (
                      <option key={record.cycle} value={record.cycle}>
                        {record.label} · {record.rangeLabel}
                      </option>
                    ))
                  ) : (
                    <option value="">ไม่มีรอบในวันที่เลือก</option>
                  )}
                </select>
              </label>

              <div style={styles.compactSelectionSummary}>
                <strong>
                  {selectedDateKey
                    ? formatThaiDate(createDateFromKey(selectedDateKey))
                    : "ยังไม่ได้เลือกวันที่"}
                </strong>
                <span>
                  {selectedDateRecords.length
                    ? `${selectedDateRecords.length} รอบที่เกี่ยวข้อง`
                    : "วันที่นี้ไม่มีข้อมูลรอบอบ"}
                </span>
              </div>

              <div style={styles.calendarLegend}>
                <span><i style={styles.legendDot} />มีข้อมูล</span>
                <span><i style={styles.legendPill} />อยู่ในรอบเดียวกัน</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={styles.chartCardGrid}>
        <ChartPanel
          title="อุณหภูมิและความชื้นในห้องอบ"
          description="1 กราฟต่อ 1 รอบอบ แสดงเส้น Upper/Lower เฉพาะอุณหภูมิห้องอบ"
          points={points}
          sensors={environmentSensors}
          limits={limits}
          mode="historical"
          rightAxisSensors={["humidity"]}
          leftAxisName="อุณหภูมิ °C"
          rightAxisName="ความชื้น %"
          limitSensors={["chamberTemp"]}
        />

        <ChartPanel
          title="อุณหภูมิเตาเผาและ Blower"
          description="เตาเผาและ Blower ใช้ Upper/Lower ชุดเดียวกัน"
          points={points}
          sensors={heatSensors}
          limits={limits}
          mode="historical"
          rightAxisSensors={[]}
          leftAxisName="อุณหภูมิ °C"
          rightAxisName=""
          limitSensors={["furnaceTemp"]}
          limitLabel="เตาเผา / Blower"
        />
      </div>
    </section>
  );
}

function CalendarPicker({
  cursor,
  cells,
  cycleRecords,
  selectedDateKey,
  selectedRecord,
  onSelectDate,
  onShiftMonth,
}: {
  cursor: Date;
  cells: Date[];
  cycleRecords: CycleRecord[];
  selectedDateKey: string | null;
  selectedRecord: CycleRecord | null;
  onSelectDate: (dateKey: string) => void;
  onShiftMonth: (direction: number) => void;
}) {
  return (
    <div style={styles.calendarCard}>
      <div style={styles.calendarTopbar}>
        <button
          className="button"
          type="button"
          onClick={() => onShiftMonth(-1)}
          aria-label="เดือนก่อนหน้า"
        >
          <ChevronLeft size={16} />
        </button>

        <strong style={styles.calendarMonth}>{formatThaiMonthYear(cursor)}</strong>

        <button
          className="button"
          type="button"
          onClick={() => onShiftMonth(1)}
          aria-label="เดือนถัดไป"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div style={styles.calendarWeekdays}>
        {["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div style={styles.calendarGrid}>
        {cells.map((date) => {
          const dateKey = toDateKey(date);
          const isCurrentMonth = date.getMonth() === cursor.getMonth();

          const recordsForDate = cycleRecords.filter((record) =>
            isDateKeyInRange(dateKey, record.startDateKey, record.endDateKey),
          );

          const hasCycle = recordsForDate.length > 0;
          const hasCycleEnd = cycleRecords.some((record) => record.endDateKey === dateKey);
          const isSelectedDate = selectedDateKey === dateKey;
          const isInSelectedCycle = selectedRecord
            ? isDateKeyInRange(dateKey, selectedRecord.startDateKey, selectedRecord.endDateKey)
            : false;

          return (
            <button
              key={dateKey}
              type="button"
              disabled={!hasCycle}
              onClick={() => onSelectDate(dateKey)}
              title={hasCycle ? `${recordsForDate.length} รอบที่เกี่ยวข้อง` : "ไม่มีข้อมูลรอบอบ"}
              style={{
                ...styles.calendarDay,
                ...(!isCurrentMonth ? styles.calendarDayMuted : {}),
                ...(isInSelectedCycle && !isSelectedDate ? styles.calendarDayInCycle : {}),
                ...(isSelectedDate ? styles.calendarDaySelected : {}),
                ...(!hasCycle ? styles.calendarDayDisabled : {}),
              }}
            >
              <span>{date.getDate()}</span>

              {hasCycleEnd ? <i style={styles.calendarDot} /> : null}
            </button>
          );
        })}
      </div>
    </div>
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
  limitSensors,
  limitLabel,
  timeRange,
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
  limitSensors: SensorKey[];
  limitLabel?: string;
  timeRange?: { start: Date; end: Date };
}) {
  return (
    <section className="panel chart-panel grafana-chart-panel" style={styles.chartPanel}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>

        <span className="panel-mode-chip">{mode === "realtime" ? "ปัจจุบัน" : "ย้อนหลัง"}</span>
      </div>

      <ThresholdLegend
        sensors={limitSensors}
        limits={limits}
        labelOverrides={limitLabel ? { [limitSensors[0]]: limitLabel } : undefined}
      />

      <TimeSeriesChart
        points={points}
        sensors={sensors}
        limits={limits}
        title={title}
        realtime={mode === "realtime"}
        rightAxisSensors={rightAxisSensors}
        leftAxisName={leftAxisName}
        rightAxisName={rightAxisName}
        limitSensors={limitSensors}
        timeRange={timeRange}
      />
    </section>
  );
}

function getGaugeLimit(oven: Oven, sensor: SensorKey) {
  if (sensor === "furnaceTemp" || sensor === "blowerTemp") {
    return oven.limits.furnaceTemp;
  }

  return oven.limits[sensor];
}

function getDefaultHistoricalCycle(oven: Oven): number {
  if (oven.status === "open") {
    return Math.max(1, oven.cycleCount - 1);
  }

  return Math.max(1, oven.cycleCount);
}

function TemperatureRangeCard({ oven }: { oven: Oven }) {
  const reading = oven.readings.chamberTemp;
  const limit = oven.limits.chamberTemp;
  const state = getReadingState(reading.value, "chamberTemp", oven.limits);

  const labels: Record<ReturnType<typeof getReadingState>, string> = {
    normal: "อยู่ในช่วง",
    warning: reading.value > limit.upper ? "สูงกว่า Upper" : "ต่ำกว่า Lower",
    danger: reading.value > limit.upper ? "สูงกว่า Upper มาก" : "ต่ำกว่า Lower มาก",
  };

  return (
    <div className={`status-range-card status-${state}`}>
      <p>
        <Thermometer size={16} />
        ช่วงอุณหภูมิ
      </p>

      <strong>{labels[state]}</strong>

      <span>
        Lower {limit.lower}°C · Upper {limit.upper}°C · ตอนนี้ {reading.value.toFixed(1)}°C
      </span>
    </div>
  );
}

function getDetailCycleRange(
  oven: Oven,
  mode: ChartMode,
  cycleNumber: number,
): { start: Date; end: Date } {
  if (mode === "realtime" && oven.startedAt) {
    const start = new Date(oven.startedAt);
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);

    return {
      start,
      end,
    };
  }

  if (mode === "realtime" && oven.firedAt) {
    const start = new Date(oven.firedAt);
    return {
      start,
      end: new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000),
    };
  }

  return getHistoricalCycleRange(oven, cycleNumber);
}

function canUseRealtime(status: OvenStatus): boolean {
  return status === "open";
}

function statusText(status: OvenStatus): string {
  const labels: Record<OvenStatus, string> = {
    open: "เปิด",
    closed: "ปิด",
    offline: "ขาดการเชื่อมต่อ",
  };

  return labels[status];
}

function toDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Bangkok",
  }).formatToParts(value);

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

function createDateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function isDateKeyInRange(dateKey: string, startKey: string, endKey: string): boolean {
  return dateKey >= startKey && dateKey <= endKey;
}

function shiftMonth(value: Date, direction: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + direction, 1, 12, 0, 0);
}

function getCalendarCells(cursor: Date): Date[] {
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12, 0, 0);
  const firstWeekday = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function formatThaiMonthYear(value: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function formatThaiDate(value: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function formatShortThaiDateTime(value: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function createReportFrameUrl({
  ovenId,
  mode,
  cycle,
}: {
  ovenId: string;
  mode: "current" | "history";
  cycle: number;
}): string {
  const params = new URLSearchParams({
    ovenId,
    mode,
    cycle: String(cycle),
    auto: "pdf",
    t: String(Date.now()),
  });

  return `${window.location.origin}${window.location.pathname}#/reports?${params.toString()}`;
}

const styles = {
  historicalShell: {
    display: "grid",
    gap: 12,
    borderWidth: 1,
  },

  historyFilterPanel: {
    display: "grid",
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--line)",
    borderRadius: 6,
    background: "var(--surface-soft)",
  },

  historyFilterHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  historyModeTabs: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: 3,
    border: "1px solid var(--line)",
    borderRadius: 6,
    background: "var(--surface)",
  },

  cyclePickerRow: {
    display: "grid",
    gridTemplateColumns: "minmax(360px, 0.9fr) minmax(300px, 1.1fr)",
    alignItems: "end",
    gap: 10,
  },

  cycleSelectField: {
    minWidth: 0,
  },

  compactSelectionSummary: {
    display: "flex",
    minHeight: 34,
    alignItems: "center",
    gap: 10,
    padding: "6px 10px",
    border: "1px solid var(--line)",
    borderRadius: 5,
    background: "var(--surface)",
    color: "var(--muted)",
    fontSize: 12,
  },

  historyTitle: {
    display: "block",
    color: "var(--ink-strong)",
    fontSize: 17,
    fontWeight: 850,
  },

  historyDescription: {
    margin: "4px 0 0",
    color: "var(--muted)",
    fontSize: 13,
    lineHeight: 1.55,
  },

  historyFilterGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 0.82fr) minmax(420px, 1.18fr)",
    gap: 16,
  },

  historyCard: {
    display: "grid",
    alignContent: "start",
    gap: 14,
    padding: 15,
    border: "1px solid var(--line)",
    borderRadius: 15,
    background: "var(--surface)",
    boxShadow: "0 2px 10px rgba(15, 23, 42, 0.04)",
  },

  historyCardHead: {
    display: "flex",
    alignItems: "flex-start",
    gap: 11,
  },

  historyIconBox: {
    display: "grid",
    width: 36,
    height: 36,
    placeItems: "center",
    borderRadius: 12,
    color: "var(--company-primary, var(--orange))",
    background: "color-mix(in srgb, var(--company-primary, #f59e0b) 15%, transparent)",
    border: "1px solid color-mix(in srgb, var(--company-primary, #f59e0b) 28%, transparent)",
  },

  selectedSummary: {
    display: "grid",
    gap: 6,
    padding: 14,
    borderRadius: 13,
    border: "1px solid var(--line)",
    background: "var(--surface-soft)",
  },

  calendarLayout: {
    display: "grid",
    gridTemplateColumns: "300px minmax(320px, 1fr)",
    gap: 10,
    alignItems: "start",
  },

  calendarCard: {
    display: "grid",
    gap: 7,
    padding: 8,
    border: "1px solid var(--line)",
    borderRadius: 5,
    background: "var(--surface)",
  },

  calendarTopbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  calendarMonth: {
    color: "var(--ink-strong)",
    fontSize: 13,
    fontWeight: 850,
  },

  calendarWeekdays: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 3,
    color: "var(--muted)",
    fontSize: 11,
    fontWeight: 850,
    textAlign: "center",
  },

  calendarGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 3,
  },

  calendarDay: {
    position: "relative",
    display: "grid",
    minHeight: 30,
    placeItems: "center",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--line)",
    borderRadius: 4,
    background: "var(--surface-soft)",
    color: "var(--ink-strong)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 850,
    transition: "transform 0.14s ease, border-color 0.14s ease, background 0.14s ease",
  },

  calendarDaySelected: {
    borderColor: "var(--company-primary, var(--orange))",
    background: "var(--company-primary, var(--orange))",
    color: "var(--company-on-primary, #111827)",
    boxShadow: "inset 0 0 0 1px color-mix(in srgb, #fff 35%, transparent)",
  },

  calendarDayInCycle: {
    borderColor: "color-mix(in srgb, var(--company-primary, #f59e0b) 28%, var(--line))",
    background: "color-mix(in srgb, var(--company-primary, #f59e0b) 14%, var(--surface))",
  },

  calendarDayMuted: {
    color: "var(--muted-soft)",
  },

  calendarDayDisabled: {
    opacity: 0.34,
    cursor: "not-allowed",
    background: "var(--surface)",
  },

  calendarDot: {
    position: "absolute",
    left: "50%",
    bottom: 3,
    width: 4,
    height: 4,
    borderRadius: 999,
    transform: "translateX(-50%)",
    background: "currentColor",
  },

  dateSidePanel: {
    display: "grid",
    alignContent: "start",
    gap: 8,
  },

  calendarLegend: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    color: "var(--muted)",
    fontSize: 12,
    fontWeight: 700,
  },

  legendDot: {
    display: "inline-block",
    width: 9,
    height: 9,
    marginRight: 6,
    borderRadius: 999,
    background: "var(--company-primary, var(--orange))",
    verticalAlign: "middle",
  },

  legendPill: {
    display: "inline-block",
    width: 24,
    height: 10,
    marginRight: 6,
    borderRadius: 999,
    background: "color-mix(in srgb, var(--company-primary, #f59e0b) 16%, transparent)",
    border: "1px solid color-mix(in srgb, var(--company-primary, #f59e0b) 28%, transparent)",
    verticalAlign: "middle",
  },

  chartCardGrid: {
    display: "grid",
    gap: 16,
  },

  chartPanel: {
    borderRadius: 16,
  },
} satisfies Record<string, CSSProperties>;
