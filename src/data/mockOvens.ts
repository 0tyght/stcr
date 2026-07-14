import type { LimitMap, Oven, OvenStatus, SensorKey, SensorSnapshot } from "../types";
import { allSensorKeys, sensorByKey } from "../utils/sensors";

type OvenSeed = {
  number: number;
  status: OvenStatus;
  cycleCount: number;
  updatedMinutesAgo: number;
  readings: Record<SensorKey, number>;
  firedHoursAgo?: number;
  startedHoursAgo?: number;
  stoppedHoursAgo?: number;
};

export function createDefaultLimits(): LimitMap {
  return {
    chamberTemp: { sensor: "chamberTemp", lower: 35, upper: 60 },
    humidity: { sensor: "humidity", lower: 45, upper: 85 },
    furnaceTemp: { sensor: "furnaceTemp", lower: 450, upper: 550 },
    blowerTemp: { sensor: "blowerTemp", lower: 330, upper: 400 },
  };
}

const seeds: OvenSeed[] = [
  {
    number: 11,
    status: "closed",
    cycleCount: 87,
    updatedMinutesAgo: 390,
    stoppedHoursAgo: 34,
    readings: { chamberTemp: 32, humidity: 60, furnaceTemp: 35, blowerTemp: 0 },
  },
  {
    number: 12,
    status: "closed",
    cycleCount: 89,
    updatedMinutesAgo: 1170,
    stoppedHoursAgo: 21,
    readings: { chamberTemp: 31, humidity: 58, furnaceTemp: 40, blowerTemp: 0 },
  },
  {
    number: 13,
    status: "closed",
    cycleCount: 88,
    updatedMinutesAgo: 1420,
    stoppedHoursAgo: 26,
    readings: { chamberTemp: 30, humidity: 62, furnaceTemp: 38, blowerTemp: 0 },
  },
  {
    number: 14,
    status: "closed",
    cycleCount: 85,
    updatedMinutesAgo: 1680,
    stoppedHoursAgo: 33,
    readings: { chamberTemp: 33, humidity: 57, furnaceTemp: 42, blowerTemp: 0 },
  },
  {
    number: 15,
    status: "open",
    cycleCount: 71,
    updatedMinutesAgo: 17,
    startedHoursAgo: 38,
    readings: { chamberTemp: 62.5, humidity: 52, furnaceTemp: 208, blowerTemp: 44 },
  },
  {
    number: 16,
    status: "offline",
    cycleCount: 83,
    updatedMinutesAgo: 14520,
    stoppedHoursAgo: 304,
    readings: { chamberTemp: 29, humidity: 63, furnaceTemp: 34, blowerTemp: 0 },
  },
  {
    number: 17,
    status: "open",
    cycleCount: 84,
    updatedMinutesAgo: 2,
    startedHoursAgo: 16,
    readings: { chamberTemp: 45.4, humidity: 50.8, furnaceTemp: 168, blowerTemp: 58 },
  },
  {
    number: 18,
    status: "open",
    cycleCount: 83,
    updatedMinutesAgo: 1,
    startedHoursAgo: 17,
    readings: { chamberTemp: 46.7, humidity: 49.9, furnaceTemp: 152, blowerTemp: 0 },
  },
  {
    number: 19,
    status: "closed",
    cycleCount: 55,
    updatedMinutesAgo: 15640,
    stoppedHoursAgo: 265,
    readings: { chamberTemp: 31, humidity: 56, furnaceTemp: 39, blowerTemp: 0 },
  },
  {
    number: 20,
    status: "open",
    cycleCount: 92,
    updatedMinutesAgo: 3,
    startedHoursAgo: 23,
    readings: { chamberTemp: 69.4, humidity: 38.2, furnaceTemp: 486, blowerTemp: 84 },
  },
  {
    number: 21,
    status: "open",
    cycleCount: 74,
    updatedMinutesAgo: 5,
    startedHoursAgo: 19,
    readings: { chamberTemp: 43.8, humidity: 54.2, furnaceTemp: 186, blowerTemp: 63 },
  },
  {
    number: 22,
    status: "offline",
    cycleCount: 66,
    updatedMinutesAgo: 78,
    stoppedHoursAgo: 12,
    readings: { chamberTemp: 41.1, humidity: 53.2, furnaceTemp: 180, blowerTemp: 60 },
  },
  {
    number: 23,
    status: "closed",
    cycleCount: 80,
    updatedMinutesAgo: 1710,
    stoppedHoursAgo: 27,
    readings: { chamberTemp: 30.2, humidity: 55.4, furnaceTemp: 36, blowerTemp: 0 },
  },
  {
    number: 24,
    status: "open",
    cycleCount: 79,
    updatedMinutesAgo: 8,
    startedHoursAgo: 15,
    readings: { chamberTemp: 42.1, humidity: 73.5, furnaceTemp: 205, blowerTemp: 52 },
  },
  {
    number: 25,
    status: "open",
    cycleCount: 91,
    updatedMinutesAgo: 4,
    startedHoursAgo: 26,
    readings: { chamberTemp: 47.8, humidity: 51.3, furnaceTemp: 238, blowerTemp: 72 },
  },
  {
    number: 26,
    status: "closed",
    cycleCount: 0,
    updatedMinutesAgo: 8640,
    stoppedHoursAgo: 144,
    readings: { chamberTemp: 0, humidity: 0, furnaceTemp: 0, blowerTemp: 0 },
  },
];

const ttnSeeds: OvenSeed[] = [
  { number: 1, status: "open", cycleCount: 42, updatedMinutesAgo: 0, firedHoursAgo: 1,
    readings: { chamberTemp: 29, humidity: 80, furnaceTemp: 0, blowerTemp: 0 } },
  { number: 2, status: "open", cycleCount: 38, updatedMinutesAgo: 0, firedHoursAgo: 23, startedHoursAgo: 15,
    readings: { chamberTemp: 56, humidity: 79, furnaceTemp: 490, blowerTemp: 355 } },
  { number: 3, status: "closed", cycleCount: 51, updatedMinutesAgo: 0, stoppedHoursAgo: 11,
    readings: { chamberTemp: 30, humidity: 68, furnaceTemp: 0, blowerTemp: 0 } },
  { number: 4, status: "open", cycleCount: 46, updatedMinutesAgo: 0, firedHoursAgo: 45, startedHoursAgo: 37,
    readings: { chamberTemp: 56, humidity: 78, furnaceTemp: 490, blowerTemp: 355 } },
  { number: 5, status: "closed", cycleCount: 33, updatedMinutesAgo: 0, stoppedHoursAgo: 13,
    readings: { chamberTemp: 30, humidity: 68, furnaceTemp: 0, blowerTemp: 0 } },
  { number: 6, status: "open", cycleCount: 55, updatedMinutesAgo: 0, firedHoursAgo: 67, startedHoursAgo: 59,
    readings: { chamberTemp: 56, humidity: 75, furnaceTemp: 490, blowerTemp: 355 } },
  { number: 7, status: "offline", cycleCount: 29, updatedMinutesAgo: 42, stoppedHoursAgo: 15,
    readings: { chamberTemp: 30, humidity: 68, furnaceTemp: 0, blowerTemp: 0 } },
  { number: 8, status: "open", cycleCount: 48, updatedMinutesAgo: 0, firedHoursAgo: 89, startedHoursAgo: 81,
    readings: { chamberTemp: 56, humidity: 70, furnaceTemp: 490, blowerTemp: 355 } },
  { number: 9, status: "closed", cycleCount: 36, updatedMinutesAgo: 0, stoppedHoursAgo: 17,
    readings: { chamberTemp: 30, humidity: 68, furnaceTemp: 0, blowerTemp: 0 } },
  { number: 10, status: "open", cycleCount: 44, updatedMinutesAgo: 0, firedHoursAgo: 111, startedHoursAgo: 103,
    readings: { chamberTemp: 56, humidity: 64, furnaceTemp: 490, blowerTemp: 355 } },
];

export function createSensorSnapshot(
  readings: Record<SensorKey, number>,
  updatedAt: string,
): SensorSnapshot {
  return allSensorKeys.reduce((snapshot, key) => {
    snapshot[key] = {
      key,
      value: readings[key],
      unit: sensorByKey[key].unit,
      updatedAt,
    };

    return snapshot;
  }, {} as SensorSnapshot);
}

export function createMockOvens(companyId = "gr", now = new Date()): Oven[] {
  const companySeeds = companyId === "ttn" ? ttnSeeds : seeds;

  return companySeeds.map((seed) => {
    const updatedAt = new Date(now.getTime() - seed.updatedMinutesAgo * 60 * 1000).toISOString();

    const startedAt = seed.startedHoursAgo
      ? new Date(now.getTime() - seed.startedHoursAgo * 60 * 60 * 1000).toISOString()
      : undefined;
    const firedAt = seed.firedHoursAgo
      ? new Date(now.getTime() - seed.firedHoursAgo * 60 * 60 * 1000).toISOString()
      : startedAt
        ? new Date(Date.parse(startedAt) - 8 * 60 * 60 * 1000).toISOString()
        : undefined;

    const stoppedAt = seed.stoppedHoursAgo
      ? new Date(now.getTime() - seed.stoppedHoursAgo * 60 * 60 * 1000).toISOString()
      : undefined;

    const oven: Oven = {
      id: `oven-${seed.number}`,
      number: seed.number,
      name: `เตา ${seed.number}`,
      zone: seed.number < 19 ? "โซน A" : "โซน B",
      line: seed.number % 2 === 0 ? "Line 2" : "Line 1",
      status: seed.status,
      enabled: true,
      cycleCount: seed.cycleCount,
      firedAt,
      reportStartedAt: startedAt,
      startedAt,
      stoppedAt,
      lastUpdatedAt: updatedAt,
      readings: createSensorSnapshot(seed.readings, updatedAt),
      limits: createDefaultLimits(),
    };

    return {
      ...oven,
      status: deriveOvenStatus(oven),
    };
  });
}

export function deriveOvenStatus(oven: Oven): OvenStatus {
  if (oven.status === "offline") return "offline";
  return (oven.firedAt || oven.startedAt) && !oven.stoppedAt ? "open" : "closed";
}

export function createNewOven(number: number): Oven {
  const now = new Date().toISOString();

  return {
    id: `oven-${number}`,
    number,
    name: `เตา ${number}`,
    zone: "โซนใหม่",
    line: "Line 1",
    status: "closed",
    enabled: true,
    cycleCount: 0,
    stoppedAt: now,
    lastUpdatedAt: now,
    readings: createSensorSnapshot(
      {
        chamberTemp: 30,
        humidity: 55,
        furnaceTemp: 35,
        blowerTemp: 0,
      },
      now,
    ),
    limits: createDefaultLimits(),
  };
}
