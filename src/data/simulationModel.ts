import type { SensorKey } from "../types";

export const SIMULATION_CYCLE_MS = 6 * 24 * 60 * 60 * 1000;

type SimulationProfile = {
  chamber: number;
  furnace: number;
  blower: number;
  humidityStart: number;
  humidityEnd: number;
  phase: number;
};

const profiles: Record<string, SimulationProfile> = {
  gr: {
    chamber: 57.5,
    furnace: 500,
    blower: 365,
    humidityStart: 80,
    humidityEnd: 57,
    phase: 0.2,
  },
  ttn: {
    chamber: 56.5,
    furnace: 490,
    blower: 355,
    humidityStart: 80,
    humidityEnd: 58,
    phase: 1.1,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function smoothstep(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function deterministicNoise(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function woodLoadingPeriod(companyId: string, ovenNumber: number, loadingIndex = 0): number {
  const companySeed = companyId === "ttn" ? 117 : 23;
  const randomValue =
    (deterministicNoise(companySeed + ovenNumber * 19.1 + loadingIndex * 37.7) + 1) / 2;
  return 3 + randomValue * 3;
}

function woodLoadingState(companyId: string, ovenNumber: number, elapsedHours: number) {
  if (elapsedHours <= 0) {
    return {
      loadingStartedAt: 0,
      intervalHours: woodLoadingPeriod(companyId, ovenNumber, 0),
    };
  }

  let loadingIndex = 0;
  let loadingStartedAt = 0;
  let intervalHours = woodLoadingPeriod(companyId, ovenNumber, loadingIndex);

  while (loadingStartedAt + intervalHours <= elapsedHours) {
    loadingStartedAt += intervalHours;
    loadingIndex += 1;
    intervalHours = woodLoadingPeriod(companyId, ovenNumber, loadingIndex);
  }

  return { loadingStartedAt, intervalHours };
}

function combustionPulse(companyId: string, ovenNumber: number, elapsedHours: number): number {
  if (elapsedHours <= 0) return 0;

  const loading = woodLoadingState(companyId, ovenNumber, elapsedHours);
  const cycleAge = elapsedHours - loading.loadingStartedAt;
  const ignitionDelay = 0.4;
  const riseHours = Math.min(2, loading.intervalHours * 0.45);
  const peakAt = ignitionDelay + riseHours;

  if (cycleAge <= ignitionDelay) return 0;
  if (cycleAge < peakAt) return smoothstep((cycleAge - ignitionDelay) / riseHours);

  const decayHours = Math.max(0.5, loading.intervalHours - peakAt);
  return 1 - smoothstep((cycleAge - peakAt) / decayHours);
}

export type SimulatedSensorValues = Record<SensorKey, number>;

export function simulateSensorValues(
  companyId: string,
  ovenNumber: number,
  timestamp: number,
  firedAt: number,
): SimulatedSensorValues {
  const profile = profiles[companyId] ?? profiles.gr;
  const elapsedMs = Math.max(0, timestamp - firedAt);
  const elapsedHours = elapsedMs / 3_600_000;
  const cycleProgress = clamp(elapsedMs / SIMULATION_CYCLE_MS, 0, 1);
  const ignition = smoothstep(elapsedHours / 2.5);
  const chamberWarmup = smoothstep(elapsedHours / 18);
  const phase = elapsedHours + ovenNumber * 0.83 + profile.phase;
  const furnacePulse = combustionPulse(companyId, ovenNumber, elapsedHours);
  const blowerPulse = combustionPulse(companyId, ovenNumber, elapsedHours - 0.2);
  const chamberPulse = combustionPulse(companyId, ovenNumber, elapsedHours - 1.4);
  const smallNoise = deterministicNoise(timestamp / 5000 + ovenNumber * 17) * 0.45;

  const furnaceTemp =
    ignition *
    (profile.furnace -
      25 +
      furnacePulse * 60 +
      Math.sin(phase * 0.11) * 4 +
      smallNoise * 2);
  const blowerTemp =
    ignition *
    (profile.blower -
      18 +
      blowerPulse * 36 +
      Math.sin(phase * 0.14) * 3 +
      smallNoise);
  const chamberTemp =
    29 +
    chamberWarmup *
      (profile.chamber -
        29 +
        Math.sin(phase * 0.045) * 0.45 +
        (chamberPulse - 0.5) * 0.45);
  const humidityBase =
    profile.humidityStart -
    (profile.humidityStart - profile.humidityEnd) * Math.pow(cycleProgress, 2);
  const chamberDryingEffect = chamberWarmup * Math.max(0, chamberTemp - 55) * 0.05;
  const humidity =
    humidityBase -
    chamberDryingEffect +
    Math.sin(phase * 0.035) * 0.25 -
    smallNoise * 0.08;

  return {
    chamberTemp: round(clamp(chamberTemp, 25, 63)),
    humidity: round(clamp(humidity, 42, 86)),
    furnaceTemp: round(clamp(furnaceTemp, 0, 565)),
    blowerTemp: round(clamp(blowerTemp, 0, 420)),
  };
}

export function simulateTenMinuteAverage(
  companyId: string,
  ovenNumber: number,
  bucketEnd: number,
  firedAt: number,
): SimulatedSensorValues {
  const sampleCount = 12;
  const sampleIntervalMs = 50_000;
  const totals: SimulatedSensorValues = {
    chamberTemp: 0,
    humidity: 0,
    furnaceTemp: 0,
    blowerTemp: 0,
  };

  for (let index = 0; index < sampleCount; index += 1) {
    const timestamp = bucketEnd - index * sampleIntervalMs;
    const values = simulateSensorValues(companyId, ovenNumber, timestamp, firedAt);
    totals.chamberTemp += values.chamberTemp;
    totals.humidity += values.humidity;
    totals.furnaceTemp += values.furnaceTemp;
    totals.blowerTemp += values.blowerTemp;
  }

  return {
    chamberTemp: round(totals.chamberTemp / sampleCount),
    humidity: round(totals.humidity / sampleCount),
    furnaceTemp: round(totals.furnaceTemp / sampleCount),
    blowerTemp: round(totals.blowerTemp / sampleCount),
  };
}

export function getSimulatedFiredAt(ovenStartedAt: string | undefined, fallbackEnd: number): number {
  const parsed = ovenStartedAt ? Date.parse(ovenStartedAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallbackEnd - SIMULATION_CYCLE_MS;
}
