import type { SensorDefinition, SensorKey } from "../types";

export const sensorDefinitions: SensorDefinition[] = [
  {
    key: "chamberTemp",
    label: "อุณหภูมิในห้องอบ",
    shortLabel: "ห้องอบ",
    unit: "C",
    color: "#e11d0f",
  },
  {
    key: "humidity",
    label: "ความชื้นในห้องอบ",
    shortLabel: "ความชื้น",
    unit: "%",
    color: "#f59e0b",
  },
  {
    key: "furnaceTemp",
    label: "อุณหภูมิเตาเผา",
    shortLabel: "เตาเผา",
    unit: "C",
    color: "#2563eb",
  },
  {
    key: "blowerTemp",
    label: "อุณหภูมิ Blower",
    shortLabel: "Blower",
    unit: "C",
    color: "#16a34a",
  },
];

export const allSensorKeys = sensorDefinitions.map((sensor) => sensor.key);

export const sensorByKey = sensorDefinitions.reduce<Record<SensorKey, SensorDefinition>>(
  (acc, sensor) => {
    acc[sensor.key] = sensor;
    return acc;
  },
  {} as Record<SensorKey, SensorDefinition>,
);
