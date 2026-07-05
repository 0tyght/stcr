import { Gauge, PauseCircle, Power, Search, WifiOff, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppData } from "../app/providers";
import { OvenCard } from "../features/ovens/OvenCard";
import type { OvenStatusFilter } from "../types";
import { EmptyState } from "../components/ui/EmptyState";
import { LoadingState } from "../components/ui/LoadingState";
import { PageHeader } from "../components/ui/PageHeader";

const filters: { label: string; value: OvenStatusFilter }[] = [
  { label: "ทั้งหมด", value: "all" },
  { label: "เปิด", value: "open" },
  { label: "ปิด", value: "closed" },
  { label: "ขาดการเชื่อมต่อ", value: "offline" },
  { label: "ปิดใช้งาน", value: "disabled" },
];

export function DashboardPage() {
  const { ovens, loading } = useAppData();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OvenStatusFilter>("all");

  const summary = useMemo(() => {
    return {
      total: ovens.length,
      open: ovens.filter((oven) => oven.status === "open").length,
      closed: ovens.filter((oven) => oven.status === "closed").length,
      offline: ovens.filter((oven) => oven.status === "offline").length,
      disabled: ovens.filter((oven) => oven.status === "disabled").length,
    };
  }, [ovens]);

  const filteredOvens = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return ovens.filter((oven) => {
      const matchesStatus = status === "all" || oven.status === status;
      const matchesSearch =
        !keyword ||
        [oven.name, oven.number, oven.zone, oven.line].join(" ").toLowerCase().includes(keyword);
      return matchesStatus && matchesSearch;
    });
  }, [ovens, search, status]);

  if (loading) {
    return <LoadingState />;
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="ภาพรวมสถานะจริงของเตา พร้อมค่าล่าสุดแบบย่อเฉพาะเตาที่กำลังเปิด"
      />

      <section className="summary-grid" aria-label="สรุปสถานะเตา">
        <SummaryCard label="เตาทั้งหมด" value={summary.total} icon={<Gauge size={24} />} />
        <SummaryCard label="กำลังอบ" value={summary.open} tone="open" icon={<Power size={24} />} />
        <SummaryCard label="ปิดเตา" value={summary.closed} icon={<PauseCircle size={24} />} />
        <SummaryCard label="ขาดการเชื่อมต่อ" value={summary.offline} tone="offline" icon={<WifiOff size={24} />} />
        <SummaryCard label="ปิดใช้งาน" value={summary.disabled} tone="disabled" icon={<Wrench size={24} />} />
      </section>

      <section className="panel dashboard-toolbar">
        <label className="search-field">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหาเตา หมายเลข โซน หรือไลน์"
          />
        </label>
        <div className="segmented" role="group" aria-label="กรองสถานะเตา">
          {filters.map((filter) => (
            <button
              key={filter.value}
              className={`segment ${status === filter.value ? "is-active" : ""}`}
              type="button"
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </section>

      {filteredOvens.length ? (
        <section className="oven-grid">
          {filteredOvens.map((oven) => (
            <OvenCard key={oven.id} oven={oven} />
          ))}
        </section>
      ) : (
        <EmptyState title="ไม่พบเตาตามเงื่อนไข" description="ลองล้างคำค้นหาหรือเปลี่ยนตัวกรองสถานะ" />
      )}
    </>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "default" | "open" | "warning" | "danger" | "offline" | "disabled";
}) {
  return (
    <article className={`summary-card tone-${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="summary-icon">{icon}</div>
    </article>
  );
}
