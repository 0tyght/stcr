import { CheckCircle2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAppData } from "../app/providers";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusBadge } from "../components/ui/StatusBadge";
import type { AlarmFilter, AlarmSeverity, AlarmStatus } from "../types";
import { formatDateTime, formatNumber } from "../utils/format";
import { sensorByKey } from "../utils/sensors";

const severityOptions: { label: string; value: AlarmSeverity | "all" }[] = [
  { label: "ทั้งหมด", value: "all" },
  { label: "เตือน", value: "warning" },
  { label: "อันตราย", value: "danger" },
  { label: "ขาดการเชื่อมต่อ", value: "offline" },
];

const statusOptions: { label: string; value: AlarmStatus | "all" }[] = [
  { label: "ทั้งหมด", value: "all" },
  { label: "กำลังเกิดเหตุ", value: "active" },
  { label: "รับทราบแล้ว", value: "acknowledged" },
  { label: "แก้ไขแล้ว", value: "resolved" },
];

export function AlarmPage() {
  const { ovens, alarms, loadAlarms, acknowledgeAlarm } = useAppData();

  const [filter, setFilter] = useState<AlarmFilter>({
    severity: "all",
    status: "all",
    ovenId: "all",
    search: "",
  });

  useEffect(() => {
    void loadAlarms(filter);
  }, [filter, loadAlarms]);

  const activeCount = useMemo(
    () => alarms.filter((alarm) => alarm.status === "active").length,
    [alarms],
  );

  return (
    <>
      <PageHeader
        title="Alarm"
        description="รายการแจ้งเตือนปัจจุบันและประวัติย้อนหลัง พร้อมค้นหาและกรองตามระดับความรุนแรง"
        actions={<StatusBadge kind={activeCount ? "danger" : "normal"} label={`${activeCount} Active`} />}
      />

      <section className="panel toolbar-grid">
        <label className="search-field">
          <Search size={18} />

          <input
            value={filter.search}
            onChange={(event) =>
              setFilter((current) => ({ ...current, search: event.target.value }))
            }
            placeholder="ค้นหาเตา ประเภทข้อมูล หรือรายละเอียด"
          />
        </label>

        <label className="field">
          <span>ระดับ</span>

          <select
            value={filter.severity}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                severity: event.target.value as AlarmSeverity | "all",
              }))
            }
          >
            {severityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>สถานะ</span>

          <select
            value={filter.status}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                status: event.target.value as AlarmStatus | "all",
              }))
            }
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>เตา</span>

          <select
            value={filter.ovenId}
            onChange={(event) =>
              setFilter((current) => ({ ...current, ovenId: event.target.value }))
            }
          >
            <option value="all">ทุกเตา</option>

            {ovens.map((oven) => (
              <option key={oven.id} value={oven.id}>
                {oven.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {alarms.length ? (
        <section className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>เวลาเกิดเหตุ</th>
                <th>เตา</th>
                <th>ระดับ</th>
                <th>ประเภทข้อมูล</th>
                <th>รายละเอียด</th>
                <th>จัดการ</th>
              </tr>
            </thead>

            <tbody>
              {alarms.map((alarm) => (
                <tr key={alarm.id} className={`alarm-row severity-${alarm.severity}`}>
                  <td>{formatDateTime(alarm.createdAt)}</td>

                  <td>{alarm.ovenName}</td>

                  <td>
                    <StatusBadge kind={alarm.severity} />
                  </td>

                  <td>{alarm.sensor ? sensorByKey[alarm.sensor].label : "การเชื่อมต่อ"}</td>

                  <td>
                    <strong>{alarm.title}</strong>

                    <span className="table-note">
                      {alarm.value !== undefined
                        ? `ค่า ${formatNumber(alarm.value)} / limit ${alarm.limit}`
                        : alarm.detail}
                    </span>
                  </td>

                  <td>
                    <button
                      className="button"
                      type="button"
                      onClick={() => void acknowledgeAlarm(alarm.id)}
                      disabled={alarm.status !== "active"}
                    >
                      <CheckCircle2 size={16} />
                      รับทราบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <EmptyState title="ไม่พบรายการแจ้งเตือน" description="ลองปรับตัวกรองหรือค้นหาด้วยคำอื่น" />
      )}
    </>
  );
}
