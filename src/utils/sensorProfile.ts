import type { SensorKey } from "../types";

const allSensors: SensorKey[] = [
  "chamberTemp",
  "humidity",
  "furnaceTemp",
  "blowerTemp",
];

const grBasicSensors: SensorKey[] = ["chamberTemp", "humidity"];
const grFurnaceSensors: SensorKey[] = [
  "chamberTemp",
  "humidity",
  "furnaceTemp",
];

/**
 * The factory source does not install the same sensor set on every GR oven.
 * Keep this profile close to the presentation layer so unavailable equipment
 * is hidden instead of being presented as a disconnected or faulty sensor.
 */
export function getOvenSensorProfile(
  companyId: string,
  ovenNumber: number,
): SensorKey[] {
  if (companyId !== "gr") return allSensors;
  if (ovenNumber >= 11 && ovenNumber <= 17) return grBasicSensors;
  if (ovenNumber === 18) return grFurnaceSensors;
  return allSensors;
}
