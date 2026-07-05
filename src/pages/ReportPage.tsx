import { CalendarRange, Download, FileDown, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppData } from "../app/providers";
import { ThresholdLegend } from "../components/charts/ThresholdLegend";
import { TimeSeriesChart } from "../components/charts/TimeSeriesChart";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { apiClient } from "../services/apiClient";
import { downloadCsv, printReport } from "../services/reportExport";
import type { SensorKey, TimeSeriesPoint } from "../types";
import { formatNumber, toDateInputValue } from "../utils/format";
import { summarizeHistory } from "../utils/report";
import { REPORT_CYCLE_DAYS, getDefaultCycleRange } from "../utils/reportCycle";
import { allSensorKeys, sensorByKey } from "../utils/sensors";

export function ReportPage() {
  const { ovens } = useAppData();
  const [searchParams] = useSearchParams();
  const requestedOvenId = searchParams.get("ovenId");
  const [appliedQueryOvenId, setAppliedQueryOvenId] = useState<string | null>(null);
  const [ovenId, setOvenId] = useState(requestedOvenId ?? "");
  const [startAt, setStartAt] = useState(() => toDateInputValue(getDefaultCycleRange().start));
  const [endAt, setEndAt] = useState(() => toDateInputValue(getDefaultCycleRange().end));
  const [selectedSensors, setSelectedSensors] = useState<SensorKey[]>(allSensorKeys);
  const [points, setPoints] = useState<TimeSeriesPoint[]>([]);

  const oven = ovens.find((item) => item.id === ovenId) ?? ovens[0];

  useEffect(() => {
    if (requestedOvenId && appliedQueryOvenId !== requestedOvenId && ovens.some((item) => item.id === requestedOvenId)) {
      setOvenId(requestedOvenId);
      setAppliedQueryOvenId(requestedOvenId);
      return;
    }

    if (!ovenId && ovens[0]) {
      setOvenId(ovens[0].id);
    }
  }, [appliedQueryOvenId, ovenId, ovens, requestedOvenId]);

  const loadReport = useCallback(async () => {
    if (!oven) return;
    setPoints(
      await apiClient
      .getHistory({
        ovenId: oven.id,
        preset: "custom",
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        sensors: selectedSensors,
      }),
    );
  }, [endAt, oven, selectedSensors, startAt]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const summaries = useMemo(() => {
    if (!oven) return [];
    return summarizeHistory(points, selectedSensors, oven.limits);
  }, [oven, points, selectedSensors]);

  function toggleSensor(sensor: SensorKey) {
    setSelectedSensors((current) => {
      if (current.includes(sensor)) {
        return current.length === 1 ? current : current.filter((item) => item !== sensor);
      }
      return [...current, sensor];
    });
  }

  function applyCycleRange() {
    const range = getDefaultCycleRange();
    setStartAt(toDateInputValue(range.start));
    setEndAt(toDateInputValue(range.end));
  }

  if (!oven) {
    return <EmptyState title="ยังไม่มีข้อมูลเตา" description="เพิ่มเตาในหน้า Setting ก่อนออกรายงาน" />;
  }

  return (
    <>
      <PageHeader
        title="Report"
        description={`รายงานหนึ่งรอบการอบใช้ช่วงกราฟ ${REPORT_CYCLE_DAYS} วัน และสามารถปรับช่วงเวลาเองได้`}
        actions={
          <>
            <button className="button button-primary" type="button" onClick={printReport}>
              <FileDown size={17} />
              ดาวน์โหลด PDF
            </button>
            <button className="button" type="button" onClick={() => downloadCsv(`${oven.name}-report.csv`, points, selectedSensors)}>
              <Download size={17} />
              ส่งออก CSV
            </button>
          </>
        }
      />

      <section className="report-layout">
        <aside className="panel report-filter">
          <div className="panel-heading">
            <div>
              <h2>เงื่อนไขรายงาน</h2>
              <p>ใช้ชุดตัวกรองเดียวกับกราฟย้อนหลัง</p>
            </div>
          </div>
          <label className="field">
            <span>เตา</span>
            <select value={oven.id} onChange={(event) => setOvenId(event.target.value)}>
              {ovens.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>เริ่มต้น</span>
            <input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
          </label>
          <label className="field">
            <span>สิ้นสุด</span>
            <input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
          </label>
          <button className="button button-dark" type="button" onClick={applyCycleRange}>
            <CalendarRange size={17} />
            ใช้ช่วง 1 รอบ ({REPORT_CYCLE_DAYS} วัน)
          </button>
          <p className="cycle-note">PDF และ CSV จะใช้ช่วงเวลาที่เลือกอยู่ตรงนี้เป็นหลัก</p>
          <div className="field">
            <span>ประเภทข้อมูล</span>
            <div className="metric-toggles">
              {allSensorKeys.map((sensor) => (
                <label key={sensor} className="check-pill">
                  <input
                    type="checkbox"
                    checked={selectedSensors.includes(sensor)}
                    onChange={() => toggleSensor(sensor)}
                  />
                  {sensorByKey[sensor].shortLabel}
                </label>
              ))}
            </div>
          </div>
          <button className="button button-dark" type="button" onClick={() => void loadReport()}>
            <RefreshCw size={17} />
            โหลดตัวอย่างรายงาน
          </button>
        </aside>

        <section className="report-preview">
          <div className="print-header">
            <h1>รายงาน {oven.name}</h1>
            <p>
              1 รอบการอบ ({REPORT_CYCLE_DAYS} วัน) · ช่วงเวลา {startAt} ถึง {endAt}
            </p>
          </div>

          <div className="report-summary">
            {summaries.map((summary) => (
              <article key={summary.sensor} className="mini-card">
                <span>{sensorByKey[summary.sensor].label}</span>
                <strong>{formatNumber(summary.average)}</strong>
                <small>
                  Min {formatNumber(summary.min)} · Max {formatNumber(summary.max)} · เกิน {summary.exceedCount} ครั้ง
                </small>
              </article>
            ))}
          </div>

          <section className="panel chart-panel">
            <ThresholdLegend sensors={selectedSensors} limits={oven.limits} />
            <TimeSeriesChart
              points={points}
              sensors={selectedSensors}
              limits={oven.limits}
              title={`Report Preview - ${oven.name} (${REPORT_CYCLE_DAYS} วัน)`}
            />
          </section>
        </section>
      </section>
    </>
  );
}
