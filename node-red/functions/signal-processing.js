const calibration = {
  gr: {
    chamberTemp: { gain: 1, offset: 0 },
    humidity: { gain: 1, offset: 0 },
    furnaceTemp: { gain: 1, offset: 0 },
    blowerTemp: { gain: 1, offset: 0 },
  },
  ttn: {
    chamberTemp: { gain: 1, offset: 0 },
    humidity: { gain: 1, offset: 0 },
    furnaceTemp: { gain: 1, offset: 0 },
    blowerTemp: { gain: 1, offset: 0 },
  },
};

const processingRules = {
  chamberTemp: { alpha: 0.18, spikeDelta: 4 },
  humidity: { alpha: 0.16, spikeDelta: 7 },
  furnaceTemp: { alpha: 0.30, spikeDelta: 85 },
  blowerTemp: { alpha: 0.25, spikeDelta: 60 },
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

const telemetry = msg.payload;
if (!msg.telemetry || !telemetry?.sensorKey) return null;

const companyCalibration = calibration[telemetry.companyId] || calibration.gr;
const sensorCalibration = companyCalibration[telemetry.sensorKey] || { gain: 1, offset: 0 };
const rule = processingRules[telemetry.sensorKey];
if (!rule) return null;

const rawValue = Number(telemetry.value);
const calibratedValue = rawValue * sensorCalibration.gain + sensorCalibration.offset;
const stateKey = `filter:${telemetry.companyId}:${telemetry.ovenId}:${telemetry.sensorKey}`;
const previous = context.get(stateKey) || { window: [], ema: null };
const sampleWindow = [...previous.window, calibratedValue].slice(-5);
const windowMedian = median(sampleWindow);
const spikeRejected = sampleWindow.length >= 3
  && Math.abs(calibratedValue - windowMedian) > rule.spikeDelta;
const acceptedValue = spikeRejected ? windowMedian : calibratedValue;
const filteredValue = previous.ema == null
  ? acceptedValue
  : rule.alpha * acceptedValue + (1 - rule.alpha) * previous.ema;

context.set(stateKey, { window: sampleWindow, ema: filteredValue });

const qualityReasons = [...(telemetry.qualityReasons || [])];
if (spikeRejected) qualityReasons.push("spike-rejected");

msg.payload = {
  ...telemetry,
  rawValue: round(rawValue),
  calibratedValue: round(calibratedValue),
  value: round(filteredValue),
  quality: spikeRejected && telemetry.quality === "good" ? "suspect" : telemetry.quality,
  qualityReasons,
  processing: {
    method: "calibration+median5+ema",
    medianWindow: 5,
    emaAlpha: rule.alpha,
    spikeRejected,
  },
  processedTimestamp: new Date().toISOString(),
};

node.status({
  fill: spikeRejected ? "yellow" : "green",
  shape: spikeRejected ? "ring" : "dot",
  text: `${telemetry.sensorKey} ${round(filteredValue, 1)}`,
});

return msg;
