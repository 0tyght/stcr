import type { AlarmSeverity, OvenStatus } from "../../types";

type BadgeKind = OvenStatus | AlarmSeverity | "normal" | "active" | "acknowledged" | "resolved";

const labels: Record<BadgeKind, string> = {
  open: "เปิด",
  closed: "ปิด",
  warning: "เตือน",
  danger: "อันตราย",
  offline: "ขาดการเชื่อมต่อ",
  disabled: "ปิดใช้งาน",
  normal: "ปกติ",
  active: "กำลังเกิดเหตุ",
  acknowledged: "รับทราบแล้ว",
  resolved: "แก้ไขแล้ว",
};

export function StatusBadge({ kind, label }: { kind: BadgeKind; label?: string }) {
  return <span className={`status-badge status-${kind}`}>{label ?? labels[kind]}</span>;
}
