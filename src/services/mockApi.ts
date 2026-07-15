import { createHistory } from "../data/mockHistory";
import {
  createMockOvens,
  createNewOven,
  createSensorSnapshot,
  deriveOvenStatus,
} from "../data/mockOvens";
import { getSimulatedFiredAt, simulateSensorValues } from "../data/simulationModel";
import type {
  Alarm,
  AlarmFilter,
  AuditEvent,
  HistoryQuery,
  LimitMap,
  Oven,
  OvenUpdateInput,
  ReportCycleMeta,
  ReportDocumentMeta,
  SensorKey,
  TimeSeriesPoint,
} from "../types";
import { buildLimitAlarms, isStale } from "../utils/limits";
import { sensorByKey } from "../utils/sensors";
import { DEFAULT_ACCOUNT_ID, getCurrentCompany } from "../config/companies";
import { ACCOUNT_STORAGE_KEY, getStoredAccountId } from "../config/preferences";
import type { AppApi } from "./api/contracts";

const ovensByCompany: Record<string, Oven[]> = {
  gr: createMockOvens("gr"),
  ttn: createMockOvens("ttn"),
};

let auditEvents: AuditEvent[] = [
  {
    id: "audit-1",
    actor: "system",
    action: "เปลี่ยนค่า Limit",
    target: "เตา 18",
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    detail: "ปรับ Upper Limit อุณหภูมิห้องอบจาก 58 เป็น 60",
  },
  {
    id: "audit-2",
    actor: "system",
    action: "แก้ไขสถานะเตา",
    target: "เตา 22",
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    detail: "ระบบตรวจพบข้อมูลล่าช้าเกิน 10 นาที",
  },
];

let reportDocumentMeta: ReportDocumentMeta = {
  documentNo: "F-WS-05 Rev.11",
  effectiveDate: "1-ธ.ค.-68",
};

const historicalAlarms: Alarm[] = [
  {
    id: "alarm-history-1",
    ovenId: "oven-18",
    ovenName: "เตา 18",
    severity: "warning",
    status: "resolved",
    sensor: "chamberTemp",
    title: "อุณหภูมิห้องอบต่ำกว่ามาตรฐาน",
    detail: "อุณหภูมิห้องอบลดต่ำกว่า Lower Limit เป็นเวลา 15 นาที",
    value: 28,
    limit: 30,
    createdAt: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
    resolvedAt: new Date(Date.now() - 17.5 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "alarm-history-2",
    ovenId: "oven-20",
    ovenName: "เตา 20",
    severity: "danger",
    status: "acknowledged",
    sensor: "furnaceTemp",
    title: "อุณหภูมิเตาเผาสูงผิดปกติ",
    detail: "ค่าเตาเผาเกิน Upper Limit และยังอยู่ระหว่างตรวจสอบ",
    value: 488,
    limit: 450,
    createdAt: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
  },
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function wait<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(clone(value)), ms);
  });
}

function getCurrentAccount(): string {
  if (typeof window === "undefined") {
    return DEFAULT_ACCOUNT_ID;
  }

  return localStorage.getItem(ACCOUNT_STORAGE_KEY) || getStoredAccountId();
}

function getVisibleOvens(): Oven[] {
  const company = getCurrentCompany();
  const profile = company.mockData;
  const companyOvens = ovensByCompany[company.id] ?? ovensByCompany.gr;
  const visible = companyOvens.slice(
    profile.sourceStartIndex,
    profile.count == null ? undefined : profile.sourceStartIndex + profile.count,
  );

  return visible.map((oven, index) => {
    const displayNumber = profile.displayNumberStart == null
      ? oven.number
      : profile.displayNumberStart + index;
    const now = Date.now();
    const sampleTime = Math.floor(now / 5000) * 5000;
    const updatedAt = oven.status === "offline"
      ? oven.lastUpdatedAt
      : new Date(sampleTime).toISOString();
    const simulatedValues = oven.status === "open"
      ? simulateSensorValues(
          company.id,
          displayNumber,
          sampleTime,
          getSimulatedFiredAt(oven.firedAt ?? oven.startedAt, sampleTime),
        )
      : { chamberTemp: 30, humidity: 68, furnaceTemp: 0, blowerTemp: 0 };

    return {
      ...oven,
      number: displayNumber,
      name: `เตา ${displayNumber}`,
      zone: profile.zone ?? oven.zone,
      line: profile.line ?? oven.line,
      lastUpdatedAt: updatedAt,
      readings: createSensorSnapshot(simulatedValues, updatedAt),
    };
  });
}

function updateCurrentCompanyOvens(update: (items: Oven[]) => Oven[]): void {
  const companyId = getCurrentCompany().id;
  ovensByCompany[companyId] = update(ovensByCompany[companyId] ?? []);
}

function getVisibleOvenIds(): Set<string> {
  return new Set(getVisibleOvens().map((oven) => oven.id));
}

function pushAudit(action: string, target: string, detail: string): void {
  const account = getCurrentAccount();

  auditEvents = [
    {
      id: `audit-${Date.now()}`,
      actor: account,
      action,
      target,
      detail,
      createdAt: new Date().toISOString(),
    },
    ...auditEvents,
  ].slice(0, 30);
}

function getOvenOrThrow(ovenId: string): Oven {
  const oven = getVisibleOvens().find((item) => item.id === ovenId);

  if (!oven) {
    throw new Error(`Oven not found: ${ovenId}`);
  }

  return oven;
}

function getActiveAlarms(): Alarm[] {
  return getVisibleOvens().flatMap((oven) => {
    if (isStale(oven.lastUpdatedAt)) {
      return [
        {
          id: `${oven.id}-offline-${oven.lastUpdatedAt}`,
          ovenId: oven.id,
          ovenName: oven.name,
          severity: "offline",
          status: "active",
          title: "ข้อมูลจากเตาขาดการเชื่อมต่อ",
          detail: "อุปกรณ์หรือเซนเซอร์ไม่ส่งข้อมูลตามรอบเวลาที่กำหนด",
          createdAt: oven.lastUpdatedAt,
        },
      ];
    }

    return buildLimitAlarms(oven.id, oven.name, oven.readings, oven.limits);
  });
}

function getVisibleHistoricalAlarms(): Alarm[] {
  const visibleIds = getVisibleOvenIds();

  return historicalAlarms.filter((alarm) => visibleIds.has(alarm.ovenId));
}

function applyAlarmFilter(alarms: Alarm[], filter?: AlarmFilter): Alarm[] {
  if (!filter) return alarms;

  const search = filter.search.trim().toLowerCase();

  return alarms.filter((alarm) => {
    const matchesSeverity = filter.severity === "all" || alarm.severity === filter.severity;
    const matchesStatus = filter.status === "all" || alarm.status === filter.status;
    const matchesOven = filter.ovenId === "all" || alarm.ovenId === filter.ovenId;
    const matchesSearch =
      !search ||
      [
        alarm.ovenName,
        alarm.title,
        alarm.detail,
        alarm.sensor ? sensorByKey[alarm.sensor].label : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);

    return matchesSeverity && matchesStatus && matchesOven && matchesSearch;
  });
}

function getAllAlarms(filter?: AlarmFilter): Alarm[] {
  const alarms = [...getActiveAlarms(), ...getVisibleHistoricalAlarms()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return applyAlarmFilter(alarms, filter);
}

export const mockApi: AppApi = {
  async getOvens(): Promise<Oven[]> {
    return wait(getVisibleOvens());
  },

  async getOven(ovenId: string): Promise<Oven> {
    return wait(getOvenOrThrow(ovenId));
  },

  async getHistory(query: HistoryQuery): Promise<TimeSeriesPoint[]> {
    const oven = getOvenOrThrow(query.ovenId);

    return wait(createHistory(query, oven, getCurrentCompany().id), 160);
  },

  async getAlarms(filter?: AlarmFilter): Promise<Alarm[]> {
    return wait(getAllAlarms(filter));
  },

  async getAuditEvents(): Promise<AuditEvent[]> {
    return wait(auditEvents);
  },

  async getReportDocumentMeta(): Promise<ReportDocumentMeta> {
    return wait(reportDocumentMeta);
  },

  async saveReportDocumentMeta(meta: ReportDocumentMeta): Promise<ReportDocumentMeta> {
    reportDocumentMeta = { ...meta };
    return wait(reportDocumentMeta);
  },
  async getReportCycleMeta(): Promise<ReportCycleMeta> {
    return wait({
      rubberType: null,
      smokingPeriodStatus: null,
      temperatureControlStatus: null,
      reason: null,
      inputNetWeightKg: null,
      outputNetWeightKg: null,
      firewoodWeightKg: null,
    });
  },
  async saveReportCycleMeta(): Promise<void> {
    await wait(undefined);
  },

  async saveLimits(ovenId: string, limits: LimitMap): Promise<Oven> {
    const oven = getOvenOrThrow(ovenId);

    const updated: Oven = {
      ...oven,
      limits,
    };

    const withStatus: Oven = {
      ...updated,
      status: deriveOvenStatus(updated),
    };

    updateCurrentCompanyOvens((items) =>
      items.map((item) => (item.id === ovenId ? withStatus : item)),
    );

    pushAudit("เปลี่ยนค่า Limit", oven.name, "บันทึกค่า Upper/Lower Limit ใหม่");

    return wait(withStatus);
  },

  async updateOven(ovenId: string, input: OvenUpdateInput): Promise<Oven> {
    const oven = getOvenOrThrow(ovenId);

    const updated: Oven = {
      ...oven,
      ...input,
    };

    const withStatus: Oven = {
      ...updated,
      status: deriveOvenStatus(updated),
    };

    updateCurrentCompanyOvens((items) =>
      items.map((item) => (item.id === ovenId ? withStatus : item)),
    );

    pushAudit("แก้ไขข้อมูลเตา", withStatus.name, "ปรับข้อมูลชื่อเตา โซน หรือไลน์");

    return wait(withStatus);
  },

  async addOven(): Promise<Oven> {
    const companyId = getCurrentCompany().id;
    const companyOvens = ovensByCompany[companyId] ?? [];
    const nextNumber = Math.max(0, ...companyOvens.map((oven) => oven.number)) + 1;
    const oven = createNewOven(nextNumber);

    ovensByCompany[companyId] = [...companyOvens, oven];

    pushAudit("เพิ่มเตาใหม่", oven.name, "เพิ่มเตาใหม่สำหรับรองรับการขยายระบบ");

    return wait(oven);
  },

  async getRealtimeOvens(): Promise<Oven[]> {
    return wait(getVisibleOvens(), 60);
  },

  async acknowledgeAlarm(alarmId: string): Promise<Alarm[]> {
    pushAudit("รับทราบ Alarm", alarmId, "ผู้ใช้รับทราบรายการแจ้งเตือน");

    return wait(getAllAlarms());
  },

  async exportRawCsv(ovenId: string, sensors: SensorKey[]): Promise<string> {
    const points = createHistory(
      {
        ovenId,
        preset: "cycle",
        sensors,
      },
      getOvenOrThrow(ovenId),
      getCurrentCompany().id,
    );

    const header = ["timestamp", ...sensors];

    const rows = points.map((point) => [
      point.timestamp,
      ...sensors.map((sensor) => point[sensor]),
    ]);

    return wait([header, ...rows].map((row) => row.join(",")).join("\n"), 100);
  },
};
