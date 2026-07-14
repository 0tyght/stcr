# Oven Simulation Model

## Evidence used

The six supplied OVEN14 reports cover cycles from 2 days 15 hours to 5 days. They show that:

- Report data begins after heat-up; it does not contain the furnace start from zero.
- Chamber temperature changes over hours, not immediately after a firing event.
- Relative humidity generally falls as the chamber warms, but local reversals and sensor anomalies occur.
- Missing and suspect points must remain identifiable instead of being silently smoothed.

Published rubber-sheet drying work supports indirect heating and drying-air temperatures around 45-60 C. A solar-assisted smokehouse study reports 45-60 C and up to five days of drying, while forced-convection work reports operation near 60 C and temperature variation across the chamber. Heat and smoke from fuelwood combustion are transferred to the chamber by convection, which supports modeling furnace and chamber response as separate time scales.

References:

- https://doi.org/10.1016/0960-1481(93)90039-J
- https://doi.org/10.1016/j.renene.2018.07.145
- https://www.sciencedirect.com/science/article/pii/S096014811830942X

## Lifecycle

1. `firedAt`: fire is started; raw readings begin and are persisted with phase `ignition`.
2. Furnace response: a wood load has a delay before temperature rises, then reaches a peak and decays.
3. Chamber response: heat arrives later and is attenuated by the furnace, ducting, chamber mass, air and rubber load.
4. `reportStartedAt`: chamber temperature stays at or above the configured Lower limit for 30 continuous minutes.
5. Readings after this point use phase `recording` and are included in reports.
6. The chart reserves a maximum six-day window, but a cycle may stop earlier.

## Current simulator parameters

- Each oven has a deterministic wood-loading interval between 3 and 6 hours, so all ovens do not peak together.
- A wood load has an ignition delay and a gradual rise. The previous load's decay tail overlaps the next interval to prevent an instantaneous temperature drop.
- Furnace temperature reacts first. Blower temperature follows the combustion wave, while chamber temperature uses a slower and strongly attenuated response.
- Relative humidity starts near 80% and follows a slow 6-day drying curve. Chamber heat has only a small secondary effect, avoiding an unrealistic immediate humidity drop during warmup.
- Raw samples arrive every 5 seconds. Median and EMA filtering are applied in Node-RED, while charts use 10-minute arithmetic-mean buckets.

The formula source of truth is `node-red/functions/simulation-model.js`. The flow builder injects this same source into simulator and persistence Function nodes, and the maintenance command loads it directly. When the formula changes, run `npm run node-red:reseed-current` to recalculate only readings belonging to cycles whose state is `recording`. The command preserves timestamps, cycle metadata, and raw telemetry events.

## Production calibration

The simulator is a physically informed test signal, not a calibrated digital twin. Before production, estimate per-company and per-oven parameters from database history: ignition delay, wood-loading interval, furnace rise/decay, chamber lag, humidity decay and sensor quality rules. Keep these parameters outside UI code.
