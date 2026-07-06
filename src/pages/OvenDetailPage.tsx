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
import { useEffect, useMemo, useState } from "react";
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

    const latest = Math.max(oven.cycleCount, 1);

    return Array.from({ length: latest }, (_, index) => {
      const cycle = latest - index;
      const range = getDetailCycleRange(oven, "historical", cycle);

      return {
        cycle,
        start: range.start,
        end: range.end,
        startDateKey: toThaiDateKey(range.start),
        endDateKey: toThaiDateKey(range.end),
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

  /*
    แก้บัคสำคัญ:
    - effect นี้ทำงานเฉพาะตอนเปลี่ยนเตาเท่านั้น
    - ห้ามใส่ oven.cycleCount หรือ oven.status เป็น dependency
    - ไม่งั้นตอน refresh / ข้อมูลเปลี่ยน จะเด้งจาก "ย้อนหลัง" กลับ "ปัจจุบัน"
  */
  useEffect(() => {
    if (!oven) return;

    const defaultCycle = getDefaultHistoricalCycle(oven);
    const defaultRange = getDetailCycleRange(oven, "historical", defaultCycle);

    setMode(canUseRealtime(oven.status) ? "realtime" : "historical");
    setHistoryPickMode("cycle");
    setSelectedCycle(defaultCycle);
    setSelectedDateKey(toThaiDateKey(defaultRange.end));
    setCalendarCursor(defaultRange.end);
  }, [oven?.id]);

  /*
    effect นี้ทำหน้าที่เดียว:
    ถ้าเตาไม่ได้เปิดอยู่ แต่ผู้ใช้อยู่โหมดปัจจุบัน ให้บังคับไปย้อนหลัง
    แต่ถ้าผู้ใช้อยู่ย้อนหลังอยู่แล้ว ห้ามดึงกลับไปปัจจุบัน
  */
  useEffect(() => {
    if (!oven) return;

    if (!realtimeAvailable && mode === "realtime") {
      setMode("historical");
    }
  }, [oven?.id, realtimeAvailable, mode]);

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
        ? `กำลังดู ${selectedRecord.label}`
        : "กำลังดูข้อมูลย้อนหลัง";

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

      {effectiveMode === "historical" ? (
        <section className="panel" style={{ display: "grid", gap: 16 }}>
          <div className="panel-heading">
            <div>
              <h2>ตัวกรองข้อมูลย้อนหลัง</h2>
              <p>เลือกจากประวัติทั้งหมดได้ทั้งแบบรอบอบและแบบวันที่</p>
            </div>

            <button className="button" type="button" onClick={handleResetHistory}>
              <RotateCcw size={16} />
              ดูรอบล่าสุด
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(260px, 0.9fr) minmax(320px, 1.1fr)",
              gap: 16,
            }}
          >
            <div
              className="panel"
              style={{
                boxShadow: "none",
                display: "grid",
                gap: 14,
                alignContent: "start",
              }}
            >
              <div className="panel-heading">
                <div>
                  <h2>
                    <ListFilter size={17} />
                    เลือกตามรอบอบ
                  </h2>
                  <p>เหมาะกับการดูรายงานตามรอบการอบ</p>
                </div>
              </div>

              <label className="field">
                <span>เลือกรอบที่</span>

                <select
                  value={selectedCycle ?? ""}
                  onChange={(event) => handleSelectCycle(Number(event.target.value))}
                >
                  {cycleRecords.map((record) => (
                    <option key={record.cycle} value={record.cycle}>
                      {record.label} · {record.rangeLabel}
                    </option>
                  ))}
                </select>
              </label>

              <div
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  background: "var(--surface-soft)",
                  padding: 14,
                  display: "grid",
                  gap: 6,
                }}
              >
                <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>
                  รอบที่กำลังแสดง
                </span>

                <strong style={{ color: "var(--ink-strong)", fontSize: 20 }}>
                  {currentCycleLabel}
                </strong>

                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {selectedRecord
                    ? selectedRecord.rangeLabel
                    : cycleRange
                      ? `${formatShortThaiDateTime(cycleRange.start)} - ${formatShortThaiDateTime(
                          cycleRange.end,
                        )}`
                      : "-"}
                </span>
              </div>
            </div>

            <div
              className="panel"
              style={{
                boxShadow: "none",
                display: "grid",
                gap: 14,
                alignContent: "start",
              }}
            >
              <div className="panel-heading">
                <div>
                  <h2>
                    <CalendarDays size={17} />
                    เลือกตามวันที่
                  </h2>
                  <p>วันที่ที่อยู่ในรอบเดียวกันจะถูกไฮไลต์ไว้</p>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(220px, 0.9fr) minmax(220px, 1fr)",
                  gap: 14,
                }}
              >
                <div
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    background: "var(--surface)",
                    padding: 12,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <button
                      className="button"
                      type="button"
                      onClick={() => setCalendarCursor(shiftMonth(calendarCursor, -1))}
                      aria-label="เดือนก่อนหน้า"
                    >
                      <ChevronLeft size={16} />
                    </button>

                    <strong style={{ color: "var(--ink-strong)" }}>
                      {formatThaiMonthYear(calendarCursor)}
                    </strong>

                    <button
                      className="button"
                      type="button"
                      onClick={() => setCalendarCursor(shiftMonth(calendarCursor, 1))}
                      aria-label="เดือนถัดไป"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      gap: 6,
                      color: "var(--muted)",
                      fontSize: 11,
                      fontWeight: 800,
                      textAlign: "center",
                    }}
                  >
                    {["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((day) => (
                      <span key={day}>{day}</span>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      gap: 6,
                    }}
                  >
                    {calendarCells.map((date) => {
                      const dateKey = toThaiDateKey(date);
                      const inCurrentMonth = date.getMonth() === calendarCursor.getMonth();
                      const recordsForDate = cycleRecords.filter((record) =>
                        isDateKeyInRange(dateKey, record.startDateKey, record.endDateKey),
                      );
                      const hasCycle = recordsForDate.length > 0;
                      const hasCycleEnd = cycleRecords.some(
                        (record) => record.endDateKey === dateKey,
                      );
                      const isSelectedDate = selectedDateKey === dateKey;
                      const isSelectedCycleDate = selectedRecord
                        ? isDateKeyInRange(
                            dateKey,
                            selectedRecord.startDateKey,
                            selectedRecord.endDateKey,
                          )
                        : false;

                      return (
                        <button
                          key={dateKey}
                          type="button"
                          disabled={!hasCycle}
                          onClick={() => handleSelectDate(dateKey)}
                          title={
                            hasCycle
                              ? `${recordsForDate.length} รอบที่เกี่ยวข้อง`
                              : "ไม่มีข้อมูลรอบอบ"
                          }
                          style={{
                            position: "relative",
                            minHeight: 36,
                            borderRadius: 10,
                            border: isSelectedDate
                              ? "1px solid var(--company-primary, var(--orange))"
                              : "1px solid var(--line)",
                            background: isSelectedDate
                              ? "var(--company-primary, var(--orange))"
                              : isSelectedCycleDate
                                ? "color-mix(in srgb, var(--company-primary, #f59e0b) 18%, transparent)"
                                : "var(--surface)",
                            color: isSelectedDate
                              ? "var(--company-on-primary, #111827)"
                              : inCurrentMonth
                                ? "var(--ink-strong)"
                                : "var(--muted-soft)",
                            opacity: hasCycle ? 1 : 0.38,
                            cursor: hasCycle ? "pointer" : "not-allowed",
                            fontWeight: isSelectedDate ? 900 : 750,
                          }}
                        >
                          {date.getDate()}

                          {hasCycleEnd ? (
                            <span
                              style={{
                                position: "absolute",
                                left: "50%",
                                bottom: 4,
                                width: 5,
                                height: 5,
                                borderRadius: 999,
                                transform: "translateX(-50%)",
                                background: isSelectedDate
                                  ? "currentColor"
                                  : "var(--company-primary, var(--orange))",
                              }}
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                  <label className="field">
                    <span>รอบของวันที่เลือก</span>

                    <select
                      value={selectedCycle ?? ""}
                      disabled={!selectedDateRecords.length}
                      onChange={(event) => {
                        setHistoryPickMode("date");
                        setSelectedCycle(Number(event.target.value));
                      }}
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

                  <div
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 12,
                      background: "var(--surface-soft)",
                      padding: 14,
                      display: "grid",
                      gap: 7,
                    }}
                  >
                    <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>
                      วันที่เลือก
                    </span>

                    <strong style={{ color: "var(--ink-strong)", fontSize: 17 }}>
                      {selectedDateKey
                        ? formatThaiDate(createDateFromKey(selectedDateKey))
                        : "ยังไม่ได้เลือกวันที่"}
                    </strong>

                    <span style={{ color: "var(--muted)", fontSize: 13 }}>
                      {selectedDateRecords.length
                        ? `พบ ${selectedDateRecords.length} รอบที่เกี่ยวข้องกับวันนี้`
                        : "วันที่นี้ไม่มีข้อมูลรอบอบ"}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      color: "var(--muted)",
                      fontSize: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <i
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: "var(--company-primary, var(--orange))",
                        }}
                      />
                      วันที่มีจุด = วันจบรอบ
                    </span>

                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <i
                        style={{
                          width: 22,
                          height: 10,
                          borderRadius: 999,
                          background:
                            "color-mix(in srgb, var(--company-primary, #f59e0b) 18%, transparent)",
                        }}
                      />
                      พื้นสีจาง = อยู่ในรอบเดียวกัน
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {effectiveMode === "realtime" ? (
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
      ) : null}

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
        </div>
      </section>

      {effectiveMode === "historical" ? (
        <section className="panel" style={{ display: "grid", gap: 16 }}>
          <div className="panel-heading">
            <div>
              <h2>กราฟข้อมูลย้อนหลัง</h2>
              <p>
                {selectedRecord
                  ? `${selectedRecord.label} · ${selectedRecord.rangeLabel}`
                  : "เลือกประวัติที่ต้องการดูจากตัวกรองด้านบน"}
              </p>
            </div>

            <span className="panel-mode-chip">ย้อนหลัง</span>
          </div>

          <div className="chart-grid-two">
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
          </div>
        </section>
      ) : (
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
    <section className="panel chart-panel grafana-chart-panel">
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

function toThaiDateKey(value: Date): string {
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