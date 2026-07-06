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
import { Link, useParams } from "react-router-dom";

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
import { clampCycleStart, REPORT_CYCLE_MS } from "../utils/reportCycle";
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
  const { ovens, alarms, loading, refresh } = useAppData();

  const oven = ovens.find((item) => item.id === ovenId);

  const [mode, setMode] = useState<ChartMode>("realtime");
  const [historyPickMode, setHistoryPickMode] = useState<HistoryPickMode>("cycle");
  const [selectedCycle, setSelectedCycle] = useState<number | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [calendarCursor, setCalendarCursor] = useState<Date>(() => new Date());
  const [points, setPoints] = useState<TimeSeriesPoint[]>([]);

  const realtimeAvailable = oven ? canUseRealtime(oven.status) : false;

  const cycleRecords = useMemo<CycleRecord[]>(() => {
    if (!oven) return [];

    const latestCycle = Math.max(oven.cycleCount, 1);

    return Array.from({ length: latestCycle }, (_, index) => {
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

  useEffect(() => {
    if (!oven) return;

    const defaultCycle = getDefaultHistoricalCycle(oven);
    const defaultRange = getDetailCycleRange(oven, "historical", defaultCycle);

    setMode(canUseRealtime(oven.status) ? "realtime" : "historical");
    setHistoryPickMode("cycle");
    setSelectedCycle(defaultCycle);
    setSelectedDateKey(toDateKey(defaultRange.end));
    setCalendarCursor(defaultRange.end);
  }, [oven?.id]);

  useEffect(() => {
    if (!oven) return;

    if (!realtimeAvailable && mode === "realtime") {
      setMode("historical");
    }
  }, [oven?.id, mode, realtimeAvailable]);

  useEffect(() => {
    if (!selectedRecord || historyPickMode !== "cycle") return;

    setSelectedDateKey(selectedRecord.endDateKey);
    setCalendarCursor(selectedRecord.end);
  }, [historyPickMode, selectedRecord]);

  const effectiveMode = realtimeAvailable ? mode : "historical";

  const cycleRange = useMemo(() => {
    if (!oven) return null;

    return getDetailCycleRange(
      oven,
      effectiveMode,
      selectedCycle ?? getDefaultHistoricalCycle(oven),
    );
  }, [effectiveMode, oven, selectedCycle]);

  useEffect(() => {
    if (!oven || !cycleRange) return;

    void apiClient
      .getHistory({
        ovenId: oven.id,
        preset: "custom",
        sensors: allSensorKeys,
        startAt: cycleRange.start.toISOString(),
        endAt: cycleRange.end.toISOString(),
        cycleNumber:
          effectiveMode === "historical"
            ? selectedCycle ?? undefined
            : oven.cycleCount,
      })
      .then(setPoints);
  }, [cycleRange, effectiveMode, oven, selectedCycle]);

  const ovenAlarms = useMemo(
    () => alarms.filter((alarm) => alarm.ovenId === ovenId),
    [alarms, ovenId],
  );

  if (loading) {
    return <LoadingState />;
  }

  if (!oven) {
    return (
      <EmptyState
        title="ไม่พบข้อมูลเตา"
        description="กลับไปเลือกเตาจาก Dashboard หรือเมนูด้านซ้าย"
      />
    );
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
              onClick={async () => {
                await apiClient.advanceRealtime();
                await refresh();
              }}
            >
              <RefreshCw size={17} />
              รีเฟรช
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
            <Link
              className="button button-primary"
              to={`/reports?ovenId=${oven.id}&mode=${
                effectiveMode === "realtime" ? "current" : "history"
              }&cycle=${
                effectiveMode === "realtime"
                  ? oven.cycleCount
                  : selectedCycle ?? getDefaultHistoricalCycle(oven)
              }&auto=pdf`}
            >
              <FileDown size={17} />
              {effectiveMode === "realtime" ? "รายงานรอบปัจจุบัน" : "รายงานย้อนหลัง"}
            </Link>

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
            <TemperatureRangeCard oven={oven} />
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
                limit={getGaugeLimit(oven, sensor)}
                showLimit={sensor !== "humidity"}
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
            />
          </section>
        </>
      ) : (
        <HistoricalChartSection
          cycleRecords={cycleRecords}
          selectedCycle={selectedCycle}
          selectedDateKey={selectedDateKey}
          selectedDateRecords={selectedDateRecords}
          selectedRecord={selectedRecord}
          calendarCursor={calendarCursor}
          calendarCells={calendarCells}
          points={points}
          limits={oven.limits}
          onSelectCycle={handleSelectCycle}
          onSelectDate={handleSelectDate}
          onReset={handleResetHistory}
          onShiftMonth={(direction) => setCalendarCursor(shiftMonth(calendarCursor, direction))}
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
    </>
  );
}

function HistoricalChartSection({
  cycleRecords,
  selectedCycle,
  selectedDateKey,
  selectedDateRecords,
  selectedRecord,
  calendarCursor,
  calendarCells,
  points,
  limits,
  onSelectCycle,
  onSelectDate,
  onReset,
  onShiftMonth,
  onSelectDateCycle,
}: {
  cycleRecords: CycleRecord[];
  selectedCycle: number | null;
  selectedDateKey: string | null;
  selectedDateRecords: CycleRecord[];
  selectedRecord: CycleRecord | null;
  calendarCursor: Date;
  calendarCells: Date[];
  points: TimeSeriesPoint[];
  limits: LimitMap;
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
          <div>
            <strong style={styles.historyTitle}>ตัวกรองข้อมูลย้อนหลัง</strong>
            <p style={styles.historyDescription}>
              เลือกได้จากรอบอบโดยตรง หรือเลือกวันที่ที่มีข้อมูล ระบบจะไฮไลต์วันที่อยู่ในรอบเดียวกันให้
            </p>
          </div>

          <button className="button" type="button" onClick={onReset}>
            <RotateCcw size={16} />
            ดูรอบล่าสุด
          </button>
        </div>

        <div style={styles.historyFilterGrid}>
          <div style={styles.historyCard}>
            <div style={styles.historyCardHead}>
              <span style={styles.historyIconBox}>
                <ListFilter size={18} />
              </span>

              <div>
                <strong>เลือกตามรอบอบ</strong>
                <p>เหมาะกับการดูรายงานตามรอบการอบ</p>
              </div>
            </div>

            <label className="field">
              <span>เลือกรอบที่</span>

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

            <div style={styles.selectedSummary}>
              <span>รอบที่กำลังแสดง</span>
              <strong>{selectedRecord ? selectedRecord.label : "-"}</strong>
              <p>{selectedRecord ? selectedRecord.rangeLabel : "ยังไม่ได้เลือกรอบ"}</p>
            </div>
          </div>

          <div style={styles.historyCard}>
            <div style={styles.historyCardHead}>
              <span style={styles.historyIconBox}>
                <CalendarDays size={18} />
              </span>

              <div>
                <strong>เลือกตามวันที่</strong>
                <p>วันที่ที่มีพื้นสีจาง คือวันที่อยู่ในรอบเดียวกัน</p>
              </div>
            </div>

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
                <label className="field">
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

                <div style={styles.selectedSummary}>
                  <span>วันที่เลือก</span>
                  <strong>
                    {selectedDateKey
                      ? formatThaiDate(createDateFromKey(selectedDateKey))
                      : "ยังไม่ได้เลือกวันที่"}
                  </strong>
                  <p>
                    {selectedDateRecords.length
                      ? `พบ ${selectedDateRecords.length} รอบที่เกี่ยวข้องกับวันนี้`
                      : "วันที่นี้ไม่มีข้อมูลรอบอบ"}
                  </p>
                </div>

                <div style={styles.calendarLegend}>
                  <span>
                    <i style={styles.legendDot} />
                    มีข้อมูล
                  </span>

                  <span>
                    <i style={styles.legendPill} />
                    อยู่ในรอบเดียวกัน
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
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
                ...(isSelectedDate ? styles.calendarDaySelected : {}),
                ...(isInSelectedCycle && !isSelectedDate ? styles.calendarDayInCycle : {}),
                ...(!isCurrentMonth ? styles.calendarDayMuted : {}),
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
  const now = new Date();

  if (mode === "realtime" && oven.startedAt) {
    const end = now;

    return {
      start: clampCycleStart(new Date(oven.startedAt), end),
      end,
    };
  }

  const latestCycle = Math.max(oven.cycleCount, 1);
  const cycleOffset = Math.max(0, latestCycle - cycleNumber);
  const baseEnd = new Date(oven.stoppedAt ?? oven.lastUpdatedAt ?? now);
  const end = new Date(baseEnd.getTime() - cycleOffset * (REPORT_CYCLE_MS + 12 * 60 * 60 * 1000));
  const start = new Date(end.getTime() - REPORT_CYCLE_MS);

  return { start, end };
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

const styles = {
  historicalShell: {
    display: "grid",
    gap: 18,
    borderWidth: 1,
  },

  historyFilterPanel: {
    display: "grid",
    gap: 16,
    padding: 16,
    border: "1px solid var(--line)",
    borderRadius: 16,
    background:
      "linear-gradient(180deg, color-mix(in srgb, var(--surface-soft) 82%, transparent), var(--surface))",
  },

  historyFilterHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
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
    gridTemplateColumns: "minmax(280px, 0.95fr) minmax(250px, 1fr)",
    gap: 14,
    alignItems: "start",
  },

  calendarCard: {
    display: "grid",
    gap: 12,
    padding: 13,
    border: "1px solid var(--line)",
    borderRadius: 15,
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
    fontSize: 15,
    fontWeight: 850,
  },

  calendarWeekdays: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 6,
    color: "var(--muted)",
    fontSize: 11,
    fontWeight: 850,
    textAlign: "center",
  },

  calendarGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 6,
  },

  calendarDay: {
    position: "relative",
    display: "grid",
    minHeight: 42,
    placeItems: "center",
    border: "1px solid var(--line)",
    borderRadius: 13,
    background: "var(--surface-soft)",
    color: "var(--ink-strong)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 850,
    transition: "transform 0.14s ease, border-color 0.14s ease, background 0.14s ease",
  },

  calendarDaySelected: {
    borderColor: "var(--company-primary, var(--orange))",
    background: "var(--company-primary, var(--orange))",
    color: "var(--company-on-primary, #111827)",
    boxShadow: "0 8px 18px color-mix(in srgb, var(--company-primary, #f59e0b) 22%, transparent)",
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
    bottom: 6,
    width: 5,
    height: 5,
    borderRadius: 999,
    transform: "translateX(-50%)",
    background: "currentColor",
  },

  dateSidePanel: {
    display: "grid",
    alignContent: "start",
    gap: 12,
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