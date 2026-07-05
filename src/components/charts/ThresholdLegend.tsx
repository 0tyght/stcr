import type { LimitMap, SensorKey } from "../../types";
import { sensorByKey } from "../../utils/sensors";

export function ThresholdLegend({ sensors, limits }: { sensors: SensorKey[]; limits: LimitMap }) {
  return (
    <div className="threshold-legend" aria-label="คำอธิบายเส้น limit">
      {sensors.map((sensor) => {
        const definition = sensorByKey[sensor];
        const unit = definition.unit === "C" ? "°C" : "%";
        return (
          <div className="threshold-item" key={sensor}>
            <span className="legend-dot" style={{ backgroundColor: definition.color }} />
            <strong>{definition.shortLabel}</strong>
            <span className="dash-sample" style={{ borderTopColor: definition.color }} />
            <span>
              เส้นปะ Upper {limits[sensor].upper}
              {unit}
            </span>
            <span>
              Lower {limits[sensor].lower}
              {unit}
            </span>
          </div>
        );
      })}
    </div>
  );
}
