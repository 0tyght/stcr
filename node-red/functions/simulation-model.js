const SIMULATION_MODEL_CYCLE_MS = 6 * 24 * 60 * 60 * 1000;
const SIMULATION_MODEL_PROFILES = {
  gr: { chamber: 57.5, furnace: 500, blower: 365, humidityStart: 80, humidityEnd: 57, phase: 0.2 },
  ttn: { chamber: 56.5, furnace: 490, blower: 355, humidityStart: 80, humidityEnd: 58, phase: 1.1 },
};

function simulationClamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function simulationRound(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function simulationSmoothstep(value) {
  const x = simulationClamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function simulationNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function simulationWoodLoadingPeriod(companyId, ovenNumber, loadingIndex = 0) {
  const companySeed = companyId === "ttn" ? 117 : 23;
  const randomValue = (simulationNoise(
    companySeed + ovenNumber * 19.1 + loadingIndex * 37.7,
  ) + 1) / 2;
  return 3 + randomValue * 3;
}

function simulationWoodLoadingState(companyId, ovenNumber, elapsedHours) {
  if (elapsedHours <= 0) {
    return {
      loadingIndex: 0,
      loadingStartedAt: 0,
      intervalHours: simulationWoodLoadingPeriod(companyId, ovenNumber, 0),
    };
  }

  let loadingIndex = 0;
  let loadingStartedAt = 0;
  let intervalHours = simulationWoodLoadingPeriod(companyId, ovenNumber, loadingIndex);

  while (loadingStartedAt + intervalHours <= elapsedHours) {
    loadingStartedAt += intervalHours;
    loadingIndex += 1;
    intervalHours = simulationWoodLoadingPeriod(companyId, ovenNumber, loadingIndex);
  }

  return { loadingIndex, loadingStartedAt, intervalHours };
}

function simulationCombustionPulse(companyId, ovenNumber, elapsedHours) {
  if (elapsedHours <= 0) return 0;

  const loading = simulationWoodLoadingState(companyId, ovenNumber, elapsedHours);
  const cycleAge = elapsedHours - loading.loadingStartedAt;
  const periodHours = loading.intervalHours;
  const ignitionDelay = 0.4;
  const riseHours = Math.min(2, periodHours * 0.45);
  const peakAt = ignitionDelay + riseHours;

  if (cycleAge <= ignitionDelay) return 0;
  if (cycleAge < peakAt) {
    return simulationSmoothstep((cycleAge - ignitionDelay) / riseHours);
  }

  const decayHours = Math.max(0.5, periodHours - peakAt);
  return 1 - simulationSmoothstep((cycleAge - peakAt) / decayHours);
}

function simulationSensorValues(companyId, ovenNumber, timestamp, firedAt) {
  const profile = SIMULATION_MODEL_PROFILES[companyId] || SIMULATION_MODEL_PROFILES.gr;
  const elapsedMs = Math.max(0, timestamp - firedAt);
  const elapsedHours = elapsedMs / 3600000;
  const cycleProgress = simulationClamp(elapsedMs / SIMULATION_MODEL_CYCLE_MS, 0, 1);
  const ignition = simulationSmoothstep(elapsedHours / 2.5);
  const chamberWarmup = simulationSmoothstep(elapsedHours / 18);
  const phase = elapsedHours + ovenNumber * 0.83 + profile.phase;
  const furnacePulse = simulationCombustionPulse(companyId, ovenNumber, elapsedHours);
  const blowerPulse = simulationCombustionPulse(companyId, ovenNumber, elapsedHours - 0.2);
  const chamberPulse = simulationCombustionPulse(companyId, ovenNumber, elapsedHours - 1.4);
  const smallNoise = simulationNoise(timestamp / 5000 + ovenNumber * 17) * 0.45;
  const furnaceTemp = ignition * (
    profile.furnace - 25 + furnacePulse * 60 + Math.sin(phase * 0.11) * 4 + smallNoise * 2
  );
  const blowerTemp = ignition * (
    profile.blower - 18 + blowerPulse * 36 + Math.sin(phase * 0.14) * 3 + smallNoise
  );
  const chamberTemp = 29 + chamberWarmup * (
    profile.chamber - 29 + Math.sin(phase * 0.045) * 0.45 + (chamberPulse - 0.5) * 0.45
  );
  const humidityBase = profile.humidityStart
    - (profile.humidityStart - profile.humidityEnd) * Math.pow(cycleProgress, 2);
  const chamberDryingEffect = chamberWarmup * Math.max(0, chamberTemp - 55) * 0.05;
  const humidity = humidityBase - chamberDryingEffect
    + Math.sin(phase * 0.035) * 0.25 - smallNoise * 0.08;

  return {
    chamberTemp: simulationRound(simulationClamp(chamberTemp, 25, 63)),
    humidity: simulationRound(simulationClamp(humidity, 42, 86)),
    furnaceTemp: simulationRound(simulationClamp(furnaceTemp, 0, 565)),
    blowerTemp: simulationRound(simulationClamp(blowerTemp, 0, 420)),
  };
}
