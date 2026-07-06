import { Plus, Save } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../app/providers";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusBadge } from "../components/ui/StatusBadge";
import type { LimitMap, OvenUpdateInput, SensorKey } from "../types";
import { formatDateTime } from "../utils/format";
import { sensorByKey } from "../utils/sensors";

const editableLimitSensors: SensorKey[] = ["chamberTemp", "furnaceTemp"];

export function SettingPage() {
  const { ovens, auditEvents, saveLimits, updateOven, addOven } = useAppData();
  const navigate = useNavigate();
  const [ovenId, setOvenId] = useState("");
  const oven = ovens.find((item) => item.id === ovenId) ?? ovens[0];
  const [ovenForm, setOvenForm] = useState<OvenUpdateInput>({
    name: "",
    zone: "",
    line: "",
  });
  const [limits, setLimits] = useState<LimitMap | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ovenId && ovens[0]) {
      setOvenId(ovens[0].id);
    }
  }, [ovenId, ovens]);

  useEffect(() => {
    if (!oven) return;
    setOvenForm({
      name: oven.name,
      zone: oven.zone,
      line: oven.line,
    });
    setLimits(structuredClone(oven.limits));
  }, [oven]);

  const selectedAudit = useMemo(() => {
    if (!oven) return auditEvents;
    return auditEvents.filter((event) => event.target.includes(oven.name) || event.action.includes("เพิ่ม")).slice(0, 10);
  }, [auditEvents, oven]);

  async function handleOvenSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!oven) return;
    setSaving(true);
    await updateOven(oven.id, ovenForm);
    setSaving(false);
  }

  async function handleLimitSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!oven || !limits) return;
    setSaving(true);
    await saveLimits(oven.id, {
      ...limits,
      blowerTemp: {
        ...limits.blowerTemp,
        lower: limits.furnaceTemp.lower,
        upper: limits.furnaceTemp.upper,
      },
    });
    setSaving(false);
  }

  function updateLimit(sensor: SensorKey, field: "lower" | "upper", value: string) {
    setLimits((current) => {
      if (!current) return current;
      if (sensor === "furnaceTemp") {
        return {
          ...current,
          furnaceTemp: {
            ...current.furnaceTemp,
            [field]: Number(value),
          },
          blowerTemp: {
            ...current.blowerTemp,
            [field]: Number(value),
          },
        };
      }
      return {
        ...current,
        [sensor]: {
          ...current[sensor],
          [field]: Number(value),
        },
      };
    });
  }

  async function handleAddOven() {
    const newOven = await addOven();
    setOvenId(newOven.id);
    navigate(`/ovens/${newOven.id}`);
  }

  if (!oven || !limits) {
    return <EmptyState title="ยังไม่มีข้อมูลเตา" description="กดเพิ่มเตาใหม่เพื่อเริ่มตั้งค่า" />;
  }

  return (
    <>
      <PageHeader
        title="Setting"
        description="จัดการข้อมูลเตา ค่า Limit และประวัติการตั้งค่าที่สำคัญ"
        actions={
          <button className="button button-primary" type="button" onClick={() => void handleAddOven()}>
            <Plus size={17} />
            เพิ่มเตาใหม่
          </button>
        }
      />

      <section className="settings-layout">
        <div className="settings-stack">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>เลือกเตา</h2>
                <p>แก้ไขข้อมูลแยกตามเตาเพื่อไม่ให้ข้อมูลปะปนกัน</p>
              </div>
              <StatusBadge kind={oven.status} />
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
          </section>

          <form className="panel settings-form" onSubmit={handleOvenSubmit}>
            <div className="panel-heading">
              <div>
                <h2>ข้อมูลเตา</h2>
                <p>ชื่อเตา หมายเลขใช้อ้างอิงจากระบบ โซน และไลน์ผลิต</p>
              </div>
            </div>
            <label className="field">
              <span>ชื่อเตา</span>
              <input
                value={ovenForm.name}
                onChange={(event) => setOvenForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>โซน</span>
              <input
                value={ovenForm.zone}
                onChange={(event) => setOvenForm((current) => ({ ...current, zone: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>ไลน์ผลิต</span>
              <input
                value={ovenForm.line}
                onChange={(event) => setOvenForm((current) => ({ ...current, line: event.target.value }))}
              />
            </label>
            <button className="button button-dark" type="submit" disabled={saving}>
              <Save size={17} />
              บันทึกข้อมูลเตา
            </button>
          </form>
        </div>

        <div className="settings-stack">
          <form className="panel" onSubmit={handleLimitSubmit}>
            <div className="panel-heading">
              <div>
                <h2>Upper / Lower Limit</h2>
                <p>ค่าเดียวกันนี้จะถูกใช้กับกราฟ Alarm และรายงาน</p>
              </div>
            </div>
            <div className="limit-form">
              {editableLimitSensors.map((sensor) => (
                <div className="limit-row" key={sensor}>
                  <strong>{sensor === "furnaceTemp" ? "อุณหภูมิเตาเผา / Blower" : sensorByKey[sensor].label}</strong>
                  <label className="field">
                    <span>Lower</span>
                    <input
                      type="number"
                      value={limits[sensor].lower}
                      onChange={(event) => updateLimit(sensor, "lower", event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Upper</span>
                    <input
                      type="number"
                      value={limits[sensor].upper}
                      onChange={(event) => updateLimit(sensor, "upper", event.target.value)}
                    />
                  </label>
                </div>
              ))}
            </div>
            <button className="button button-primary" type="submit" disabled={saving}>
              <Save size={17} />
              บันทึกค่า Limit
            </button>
          </form>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>ประวัติการตั้งค่า</h2>
                <p>บันทึกเหตุการณ์สำคัญเพื่อใช้ตรวจสอบย้อนหลัง</p>
              </div>
            </div>
            <div className="audit-list">
              {selectedAudit.map((event) => (
                <article className="audit-item" key={event.id}>
                  <strong>{event.action}</strong>
                  <span>
                    {formatDateTime(event.createdAt)} · {event.actor}
                  </span>
                  <p>{event.detail}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </>
  );
}
