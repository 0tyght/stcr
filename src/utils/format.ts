import type { SensorKey } from "../types";
import { sensorByKey } from "./sensors";

const thaiDate = new Intl.DateTimeFormat("th-TH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "Asia/Bangkok",
});

const thaiDateTime = new Intl.DateTimeFormat("th-TH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

const thaiTime = new Intl.DateTimeFormat("th-TH", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Bangkok",
});

export function formatDate(value: string | Date): string {
  return thaiDate.format(new Date(value));
}

export function formatDateTime(value: string | Date): string {
  return thaiDateTime.format(new Date(value));
}

export function formatTime(value: string | Date): string {
  return thaiTime.format(new Date(value));
}

export function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatSensorValue(sensor: SensorKey, value: number): string {
  const definition = sensorByKey[sensor];
  return `${formatNumber(value, sensor === "furnaceTemp" ? 0 : 1)} ${definition.unit === "C" ? "°C" : "%"}`;
}

export function toDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}
