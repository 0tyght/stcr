import { CheckCircle2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAppData } from "../app/providers";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusBadge } from "../components/ui/StatusBadge";
import { getErrorMessage } from "../services/api/errors";
import type {
  AlarmFilter,
  AlarmSeverity,
  AlarmStatus,
} from "../types";
import { formatDateTime, formatNumber } from "../utils/format";
import { sensorByKey } from "../utils/sensors";

const severityOptions: {
  label: string;
  value: AlarmSeverity | "all";
}[] = [
  { label: "ทั้งหมด", value: "all" },
  { label: "เตือน", value: "warning" },
  { label: "อันตราย", value: "danger" },
  { label: "ขาดการเชื่อมต่อ", value: "offline" },
];

const statusOptions: {
  label: string;
  value: AlarmStatus | "all";
}[] = [
  { label: "ทั้งหมด", value: "all" },
  { label: "กำลังเกิดเหตุ", value: "active" },
  { label: "รับทราบแล้ว", value: "acknowledged" },
  { label: "แก้ไขแล้ว", value: "resolved" },
];

const initialFilter: AlarmFilter = {
  severity: "all",
  status: "all",
  ovenId: "all",
  search: "",
};

export function AlarmPage() {
  const {
    ovens,
    alarms,
    loadAlarms,
    acknowledgeAlarm,
  } = useAppData();

  const [filter, setFilter] =
    useState<AlarmFilter>(initialFilter);
  const [appliedFilter, setAppliedFilter] =
    useState<AlarmFilter>(initialFilter);
  const [loading, setLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(
    null,
  );
  const [acknowledgingIds, setAcknowledgingIds] = useState<
    Set<string>
  >(new Set());
  const [rowErrors, setRowErrors] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedFilter(filter);
    }, 400);

    return () => window.clearTimeout(timer);
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFilterError(null);

    void loadAlarms(appliedFilter)
      .catch((nextError) => {
        if (!cancelled) {
          setFilterError(getErrorMessage(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appliedFilter, loadAlarms]);

  const activeCount = useMemo(
    () => alarms.filter((alarm) => alarm.status === "active").length,
    [alarms],
  );

  async function handleAcknowledge(alarmId: string) {
    if (acknowledgingIds.has(alarmId)) return;

    setAcknowledgingIds((current) => {
      const next = new Set(current);
      next.add(alarmId);
      return next;
    });
    setRowErrors((current) => {
      const next = { ...current };
      delete next[alarmId];
      return next;
    });

    try {
      await acknowledgeAlarm(alarmId);
    } catch (nextError) {
      setRowErrors((current) => ({
        ...current,
        [alarmId]: getErrorMessage(nextError),
      }));
    } finally {
      setAcknowledgingIds((current) => {
        const next = new Set(current);
        next.delete(alarmId);
        return next;
      });
    }
  }

  return (
    <>
      <PageHeader
        title="Alarm"
        description="รายการแจ้งเตือนปัจจุบันและประวัติย้อนหลัง พร้อมค้นหาและกรองตามระดับความรุนแรง"
        actions={
          <StatusBadge
            kind={activeCount ? "danger" : "normal"}
            label={`${activeCount} Active`}
          />
        }
      />

      <section className="panel toolbar-grid">
        <label className="search-field">
          <Search size={18} />
          <input
            value={filter.search}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                search: event.target.value,
              }))
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
                severity: event.target
                  .value as AlarmSeverity | "all",
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
              setFilter((current) => ({
                ...current,
                ovenId: event.target.value,
              }))
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

      {filterError ? (
        <div className="settings-message is-error">
          <span>{filterError}</span>
        </div>
      ) : null}

      {loading ? (
        <p className="muted-copy">กำลังโหลดรายการ Alarm...</p>
      ) : null}

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
              {alarms.map((alarm) => {
                const acknowledging =
                  acknowledgingIds.has(alarm.id);
                const rowError = rowErrors[alarm.id];

                return (
                  <tr key={alarm.id}>
                    <td>{formatDateTime(alarm.createdAt)}</td>
                    <td>{alarm.ovenName}</td>
                    <td>
                      <StatusBadge kind={alarm.severity} />
                    </td>
                    <td>
                      {alarm.sensor
                        ? sensorByKey[alarm.sensor].label
                        : "การเชื่อมต่อ"}
                    </td>
                    <td>
                      <strong>{alarm.title}</strong>
                      <span className="table-note">
                        {alarm.value !== undefined
                          ? `ค่า ${formatNumber(alarm.value)} / limit ${alarm.limit}`
                          : alarm.detail}
                      </span>
                      {rowError ? (
                        <span className="alarm-row-error">
                          {rowError}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <button
                        className="button"
                        type="button"
                        onClick={() =>
                          void handleAcknowledge(alarm.id)
                        }
                        disabled={
                          alarm.status !== "active" ||
                          acknowledging
                        }
                      >
                        <CheckCircle2 size={16} />
                        {acknowledging
                          ? "กำลังบันทึก..."
                          : "รับทราบ"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : (
        <EmptyState
          title="ไม่พบรายการแจ้งเตือน"
          description="ลองปรับตัวกรองหรือค้นหาด้วยคำอื่น"
        />
      )}
    </>
  );
}
