import {
  AlertTriangle,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAppData } from "../app/providers";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusBadge } from "../components/ui/StatusBadge";
import type { OvenCreateInput } from "../services/api/contracts";
import { getErrorMessage } from "../services/api/errors";
import type { LimitMap, LimitRule, Oven, SensorKey } from "../types";
import { formatDateTime } from "../utils/format";
import { sensorByKey } from "../utils/sensors";

const editableLimitSensors = [
  "chamberTemp",
  "furnaceTemp",
] as const satisfies readonly SensorKey[];

type EditableLimitSensor = (typeof editableLimitSensors)[number];

type OvenFormDraft = {
  name: string;
  zone: string;
  line: string;
};

type LimitDraft = Record<
  EditableLimitSensor,
  {
    lower: string;
    upper: string;
  }
>;

type FormMessage = {
  kind: "success" | "error" | "warning";
  text: string;
} | null;

const emptyOvenForm: OvenFormDraft = {
  name: "",
  zone: "",
  line: "",
};

function createOvenForm(oven: Oven): OvenFormDraft {
  return {
    name: oven.name,
    zone: oven.zone,
    line: oven.line,
  };
}

function createLimitDraft(oven: Oven): LimitDraft {
  return {
    chamberTemp: {
      lower: String(oven.limits.chamberTemp.lower),
      upper: String(oven.limits.chamberTemp.upper),
    },
    furnaceTemp: {
      lower: String(oven.limits.furnaceTemp.lower),
      upper: String(oven.limits.furnaceTemp.upper),
    },
  };
}

function validateOvenForm(form: OvenFormDraft): string | null {
  const fields: Array<[string, string]> = [
    ["ชื่อเตา", form.name],
    ["โซน", form.zone],
    ["ไลน์ผลิต", form.line],
  ];

  for (const [label, value] of fields) {
    if (!value.trim()) return `กรุณากรอก${label}`;
    if (value.trim().length > 100) {
      return `${label}ต้องไม่เกิน 100 ตัวอักษร`;
    }
  }

  return null;
}

function parseLimit(
  draft: LimitDraft,
  sensor: EditableLimitSensor,
): LimitRule | string {
  const lower = Number(draft[sensor].lower);
  const upper = Number(draft[sensor].upper);
  const label = sensorByKey[sensor].label;

  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    return `${label}: กรุณากรอก Lower และ Upper เป็นตัวเลข`;
  }

  if (lower >= upper) {
    return `${label}: Lower ต้องน้อยกว่า Upper`;
  }

  const min = sensor === "furnaceTemp" ? 0 : -40;
  const max = sensor === "furnaceTemp" ? 1000 : 150;

  if (lower < min || upper > max) {
    return `${label}: ค่าต้องอยู่ในช่วง ${min}–${max}°C`;
  }

  return { sensor, lower, upper };
}

function buildGlobalLimitMap(
  base: LimitMap,
  draft: LimitDraft,
): LimitMap | string {
  const chamberLimit = parseLimit(draft, "chamberTemp");
  if (typeof chamberLimit === "string") return chamberLimit;

  const furnaceLimit = parseLimit(draft, "furnaceTemp");
  if (typeof furnaceLimit === "string") return furnaceLimit;

  return {
    ...base,
    chamberTemp: chamberLimit,
    furnaceTemp: furnaceLimit,
  };
}

function editableLimitSignature(oven: Oven): string {
  return JSON.stringify({
    chamberTemp: oven.limits.chamberTemp,
    furnaceTemp: oven.limits.furnaceTemp,
  });
}

export function SettingPage() {
  const {
    ovens,
    auditEvents,
    saveGlobalLimits,
    updateOven,
    addOven,
    deleteOven,
  } = useAppData();

  const [ovenId, setOvenId] = useState("");
  const oven = ovens.find((item) => item.id === ovenId) ?? null;
  const globalLimitSource = ovens[0] ?? null;
  const limitDirtyRef = useRef(false);

  const [ovenForm, setOvenForm] =
    useState<OvenFormDraft>(emptyOvenForm);
  const [ovenBaseline, setOvenBaseline] =
    useState<OvenFormDraft>(emptyOvenForm);
  const [limitDraft, setLimitDraft] = useState<LimitDraft | null>(
    null,
  );
  const [limitBaseline, setLimitBaseline] =
    useState<LimitDraft | null>(null);

  const [savingOvenInfo, setSavingOvenInfo] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);
  const [deletingOven, setDeletingOven] = useState(false);
  const [message, setMessage] = useState<FormMessage>(null);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addingOven, setAddingOven] = useState(false);
  const [addForm, setAddForm] = useState({
    number: "",
    name: "",
    zone: "",
    line: "",
  });
  const [addError, setAddError] = useState<string | null>(null);

  const isOvenDirty = useMemo(
    () => JSON.stringify(ovenForm) !== JSON.stringify(ovenBaseline),
    [ovenBaseline, ovenForm],
  );

  const isLimitDirty = useMemo(
    () =>
      limitDraft !== null &&
      limitBaseline !== null &&
      JSON.stringify(limitDraft) !== JSON.stringify(limitBaseline),
    [limitBaseline, limitDraft],
  );

  const hasMixedLimits = useMemo(() => {
    if (!globalLimitSource) return false;

    const signature = editableLimitSignature(globalLimitSource);
    return ovens.some(
      (item) => editableLimitSignature(item) !== signature,
    );
  }, [globalLimitSource, ovens]);

  const hasUnsavedChanges = isOvenDirty || isLimitDirty;

  useEffect(() => {
    if (!ovenId && ovens[0]) {
      setOvenId(ovens[0].id);
      return;
    }

    if (ovenId && !ovens.some((item) => item.id === ovenId)) {
      setOvenId(ovens[0]?.id ?? "");
    }
  }, [ovenId, ovens]);

  useEffect(() => {
    const selected = ovens.find((item) => item.id === ovenId);
    if (!selected) return;

    const nextOvenForm = createOvenForm(selected);
    setOvenForm(nextOvenForm);
    setOvenBaseline(nextOvenForm);
    setMessage(null);
  }, [ovenId]);

  useEffect(() => {
    limitDirtyRef.current = isLimitDirty;
  }, [isLimitDirty]);

  useEffect(() => {
    if (limitDirtyRef.current) return;

    const source = ovens[0];
    if (!source) {
      setLimitDraft(null);
      setLimitBaseline(null);
      return;
    }

    const nextLimitDraft = createLimitDraft(source);
    setLimitDraft(nextLimitDraft);
    setLimitBaseline(nextLimitDraft);
  }, [ovens]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () =>
      window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const selectedAudit = useMemo(() => {
    if (!oven) return auditEvents.slice(0, 10);

    return auditEvents
      .filter(
        (event) =>
          event.action.includes("Limit") ||
          event.target === oven.id ||
          event.target.includes(oven.id) ||
          event.detail.includes(oven.name),
      )
      .slice(0, 10);
  }, [auditEvents, oven]);

  function handleOvenSelection(nextOvenId: string) {
    if (
      hasUnsavedChanges &&
      !window.confirm(
        "มีข้อมูลที่ยังไม่ได้บันทึก ต้องการยกเลิกการแก้ไขและเปลี่ยนเตาหรือไม่",
      )
    ) {
      return;
    }

    setOvenId(nextOvenId);
  }

  function resetOvenForm() {
    setOvenForm(ovenBaseline);
    setMessage(null);
  }

  function resetLimitForm() {
    if (limitBaseline) setLimitDraft(limitBaseline);
    setMessage(null);
  }

  async function handleOvenSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!oven) return;

    const validationError = validateOvenForm(ovenForm);
    if (validationError) {
      setMessage({ kind: "error", text: validationError });
      return;
    }

    setSavingOvenInfo(true);
    setMessage(null);

    try {
      const updated = await updateOven(oven.id, {
        name: ovenForm.name.trim(),
        zone: ovenForm.zone.trim(),
        line: ovenForm.line.trim(),
      });

      const nextForm = createOvenForm(updated);
      setOvenForm(nextForm);
      setOvenBaseline(nextForm);
      setMessage({
        kind: "success",
        text: "บันทึกข้อมูลเตาเรียบร้อยแล้ว",
      });
    } catch (nextError) {
      setMessage({
        kind: "error",
        text: getErrorMessage(nextError),
      });
    } finally {
      setSavingOvenInfo(false);
    }
  }

  async function handleLimitSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!globalLimitSource || !limitDraft) return;

    const nextLimits = buildGlobalLimitMap(
      globalLimitSource.limits,
      limitDraft,
    );

    if (typeof nextLimits === "string") {
      setMessage({ kind: "error", text: nextLimits });
      return;
    }

    setSavingLimits(true);
    setMessage(null);

    try {
      const updatedOvens = await saveGlobalLimits(nextLimits);
      const nextDraft = updatedOvens[0]
        ? createLimitDraft(updatedOvens[0])
        : limitDraft;

      setLimitDraft(nextDraft);
      setLimitBaseline(nextDraft);
      setMessage({
        kind: "success",
        text: `บันทึกค่า Limit กลางให้เตาทั้งหมด ${updatedOvens.length} เตาเรียบร้อยแล้ว`,
      });
    } catch (nextError) {
      setMessage({
        kind: "error",
        text: getErrorMessage(nextError),
      });
    } finally {
      setSavingLimits(false);
    }
  }

  function updateLimit(
    sensor: EditableLimitSensor,
    field: "lower" | "upper",
    value: string,
  ) {
    setLimitDraft((current) => {
      if (!current) return current;

      return {
        ...current,
        [sensor]: {
          ...current[sensor],
          [field]: value,
        },
      };
    });
  }

  function openAddDialog() {
    const nextNumber =
      ovens.reduce(
        (maximum, item) => Math.max(maximum, item.number),
        0,
      ) + 1;

    setAddForm({
      number: String(nextNumber),
      name: `เตา ${nextNumber}`,
      zone: "",
      line: "",
    });
    setAddError(null);
    setAddDialogOpen(true);
  }

  async function handleAddSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const number = Number(addForm.number);
    if (!Number.isInteger(number) || number <= 0) {
      setAddError("หมายเลขเตาต้องเป็นจำนวนเต็มมากกว่า 0");
      return;
    }

    if (ovens.some((item) => item.number === number)) {
      setAddError(`มีเตาหมายเลข ${number} อยู่แล้ว`);
      return;
    }

    const normalizedName = addForm.name.trim().toLocaleLowerCase("th-TH");
    if (
      ovens.some(
        (item) =>
          item.name.trim().toLocaleLowerCase("th-TH") ===
          normalizedName,
      )
    ) {
      setAddError(`มีชื่อเตา ${addForm.name.trim()} อยู่แล้ว`);
      return;
    }

    const validationError = validateOvenForm(addForm);
    if (validationError) {
      setAddError(validationError);
      return;
    }

    const input: OvenCreateInput = {
      number,
      name: addForm.name.trim(),
      zone: addForm.zone.trim(),
      line: addForm.line.trim(),
    };

    if (
      !window.confirm(
        `ยืนยันเพิ่ม ${input.name} หมายเลข ${input.number} หรือไม่`,
      )
    ) {
      return;
    }

    setAddingOven(true);
    setAddError(null);

    try {
      const created = await addOven(input);
      let limitWarning: string | null = null;

      if (globalLimitSource && limitDraft) {
        const nextLimits = buildGlobalLimitMap(
          globalLimitSource.limits,
          limitDraft,
        );

        if (typeof nextLimits === "string") {
          limitWarning = nextLimits;
        } else {
          try {
            await saveGlobalLimits(nextLimits);
          } catch (nextError) {
            limitWarning = getErrorMessage(nextError);
          }
        }
      }

      setAddDialogOpen(false);
      setOvenId(created.id);
      setMessage(
        limitWarning
          ? {
              kind: "warning",
              text: `เพิ่ม ${created.name} แล้ว แต่ยังใช้ค่า Limit กลางไม่สำเร็จ: ${limitWarning}`,
            }
          : {
              kind: "success",
              text: `เพิ่ม ${created.name} และใช้ค่า Limit กลางเรียบร้อยแล้ว`,
            },
      );
    } catch (nextError) {
      setAddError(getErrorMessage(nextError));
    } finally {
      setAddingOven(false);
    }
  }

  async function handleDeleteOven() {
    if (!oven) return;

    if (hasUnsavedChanges) {
      setMessage({
        kind: "warning",
        text: "กรุณาบันทึกหรือยกเลิกการแก้ไขก่อนลบเตา",
      });
      return;
    }

    const confirmed = window.confirm(
      `ยืนยันลบ ${oven.name} หมายเลข ${oven.number} หรือไม่`,
    );

    if (!confirmed) return;

    setDeletingOven(true);
    setMessage(null);

    try {
      await deleteOven(oven.id);
      setOvenId("");
      setMessage({
        kind: "success",
        text: `ลบ ${oven.name} เรียบร้อยแล้ว`,
      });
    } catch (nextError) {
      setMessage({
        kind: "error",
        text: getErrorMessage(nextError),
      });
    } finally {
      setDeletingOven(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Setting"
        description="จัดการข้อมูลเตาและกำหนดค่า Limit กลางที่ใช้พร้อมกันทุกเตา"
        actions={
          <button
            className="button button-primary"
            type="button"
            onClick={openAddDialog}
          >
            <Plus size={17} />
            เพิ่มเตาใหม่
          </button>
        }
      />

      {message ? (
        <div className={`settings-message is-${message.kind}`}>
          {message.kind !== "success" ? (
            <AlertTriangle size={18} />
          ) : null}
          <span>{message.text}</span>
        </div>
      ) : null}

      {!oven || !limitDraft ? (
        <EmptyState
          title="ยังไม่มีข้อมูลเตา"
          description="กดเพิ่มเตาใหม่เพื่อเริ่มตั้งค่า"
        />
      ) : (
        <section className="settings-layout">
          <div className="settings-stack">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>เลือกเตา</h2>
                  <p>
                    การรีเฟรชข้อมูลอัตโนมัติจะไม่เขียนทับค่าที่กำลังแก้
                  </p>
                </div>
                <StatusBadge kind={oven.status} />
              </div>

              <label className="field">
                <span>เตา</span>
                <select
                  value={oven.id}
                  onChange={(event) =>
                    handleOvenSelection(event.target.value)
                  }
                >
                  {ovens.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <form
              className="panel settings-form"
              onSubmit={handleOvenSubmit}
            >
              <div className="panel-heading">
                <div>
                  <h2>ข้อมูลเตา</h2>
                  <p>ชื่อเตา โซน และไลน์ผลิต</p>
                </div>
              </div>

              <label className="field">
                <span>ชื่อเตา</span>
                <input
                  maxLength={100}
                  value={ovenForm.name}
                  onChange={(event) =>
                    setOvenForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>โซน</span>
                <input
                  maxLength={100}
                  value={ovenForm.zone}
                  onChange={(event) =>
                    setOvenForm((current) => ({
                      ...current,
                      zone: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>ไลน์ผลิต</span>
                <input
                  maxLength={100}
                  value={ovenForm.line}
                  onChange={(event) =>
                    setOvenForm((current) => ({
                      ...current,
                      line: event.target.value,
                    }))
                  }
                />
              </label>

              <div className="settings-actions">
                <button
                  className="button button-ghost"
                  type="button"
                  disabled={!isOvenDirty || savingOvenInfo}
                  onClick={resetOvenForm}
                >
                  <RotateCcw size={17} />
                  ยกเลิกการแก้ไข
                </button>
                <button
                  className="button button-dark"
                  type="submit"
                  disabled={!isOvenDirty || savingOvenInfo}
                >
                  <Save size={17} />
                  {savingOvenInfo
                    ? "กำลังบันทึก..."
                    : "บันทึกข้อมูลเตา"}
                </button>
              </div>
            </form>

            <section className="panel settings-danger-zone">
              <div className="panel-heading">
                <div>
                  <h2>ลบเตา</h2>
                  <p>ลบเตาที่ไม่ต้องการออกจากระบบ</p>
                </div>
              </div>
              <button
                className="button button-danger"
                type="button"
                disabled={deletingOven}
                onClick={() => void handleDeleteOven()}
              >
                <Trash2 size={17} />
                {deletingOven ? "กำลังลบ..." : "ลบเตานี้"}
              </button>
            </section>
          </div>

          <div className="settings-stack">
            <form className="panel" onSubmit={handleLimitSubmit}>
              <div className="panel-heading">
                <div>
                  <h2>Upper / Lower Limit กลาง</h2>
                  <p>
                    ตั้งค่าครั้งเดียวและใช้พร้อมกันทุกเตาในบริษัท
                    โดย Blower ไม่มีค่า Lower/Upper
                  </p>
                </div>
              </div>

              {hasMixedLimits ? (
                <div className="settings-message is-warning">
                  <AlertTriangle size={18} />
                  <span>
                    พบค่า Limit ของบางเตาไม่ตรงกัน กดบันทึกเพื่อปรับให้ทุกเตาใช้ค่าเดียวกัน
                  </span>
                </div>
              ) : null}

              <div className="limit-form">
                {editableLimitSensors.map((sensor) => (
                  <div className="limit-row" key={sensor}>
                    <strong>{sensorByKey[sensor].label}</strong>
                    <label className="field">
                      <span>Lower</span>
                      <input
                        inputMode="decimal"
                        type="number"
                        value={limitDraft[sensor].lower}
                        onChange={(event) =>
                          updateLimit(
                            sensor,
                            "lower",
                            event.target.value,
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Upper</span>
                      <input
                        inputMode="decimal"
                        type="number"
                        value={limitDraft[sensor].upper}
                        onChange={(event) =>
                          updateLimit(
                            sensor,
                            "upper",
                            event.target.value,
                          )
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>

              <div className="settings-actions">
                <button
                  className="button button-ghost"
                  type="button"
                  disabled={!isLimitDirty || savingLimits}
                  onClick={resetLimitForm}
                >
                  <RotateCcw size={17} />
                  ยกเลิกการแก้ไข
                </button>
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={(!isLimitDirty && !hasMixedLimits) || savingLimits}
                >
                  <Save size={17} />
                  {savingLimits
                    ? "กำลังบันทึกทุกเตา..."
                    : "บันทึกค่า Limit ทุกเตา"}
                </button>
              </div>
            </form>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>ประวัติการตั้งค่า</h2>
                  <p>
                    แสดงการแก้ข้อมูลเตาที่เลือกและการเปลี่ยนค่า Limit ทั้งระบบ
                  </p>
                </div>
              </div>

              <div className="audit-list">
                {selectedAudit.length ? (
                  selectedAudit.map((event) => (
                    <article className="audit-item" key={event.id}>
                      <strong>{event.action}</strong>
                      <span>
                        {formatDateTime(event.createdAt)} · {event.actor}
                      </span>
                      <p>{event.detail}</p>
                    </article>
                  ))
                ) : (
                  <p className="muted-copy">
                    ยังไม่มีประวัติการตั้งค่าสำหรับเตานี้
                  </p>
                )}
              </div>
            </section>
          </div>
        </section>
      )}

      {addDialogOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !addingOven) {
              setAddDialogOpen(false);
            }
          }}
        >
          <form
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-oven-title"
            onSubmit={handleAddSubmit}
          >
            <div className="modal-header">
              <div>
                <h2 id="add-oven-title">เพิ่มเตาใหม่</h2>
                <p>ตรวจข้อมูลให้ครบก่อนกดยืนยันเพิ่มเตา</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="ปิด"
                disabled={addingOven}
                onClick={() => setAddDialogOpen(false)}
              >
                <X size={19} />
              </button>
            </div>

            {addError ? (
              <div className="settings-message is-error">
                <AlertTriangle size={18} />
                <span>{addError}</span>
              </div>
            ) : null}

            <label className="field">
              <span>หมายเลขเตา</span>
              <input
                min="1"
                step="1"
                type="number"
                value={addForm.number}
                onChange={(event) =>
                  setAddForm((current) => ({
                    ...current,
                    number: event.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>ชื่อเตา</span>
              <input
                maxLength={100}
                value={addForm.name}
                onChange={(event) =>
                  setAddForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>โซน</span>
              <input
                maxLength={100}
                value={addForm.zone}
                onChange={(event) =>
                  setAddForm((current) => ({
                    ...current,
                    zone: event.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>ไลน์ผลิต</span>
              <input
                maxLength={100}
                value={addForm.line}
                onChange={(event) =>
                  setAddForm((current) => ({
                    ...current,
                    line: event.target.value,
                  }))
                }
              />
            </label>

            <div className="modal-actions">
              <button
                className="button button-ghost"
                type="button"
                disabled={addingOven}
                onClick={() => setAddDialogOpen(false)}
              >
                ยกเลิก
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={addingOven}
              >
                <Plus size={17} />
                {addingOven ? "กำลังเพิ่ม..." : "ยืนยันเพิ่มเตา"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
