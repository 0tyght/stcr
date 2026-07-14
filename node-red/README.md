# STCR Node-RED Runtime

## What the flow models

- GR and TTN have independent device, gateway, filter, aggregation, history, and alarm state.
- Open ovens publish four independent sensor messages every 5 seconds.
- Chamber temperature, humidity, furnace temperature, and blower temperature follow a 6-day smoking cycle.
- Ignition data is stored, but report recording and alarms begin only after the configured warmup condition.
- Raw telemetry and processed snapshots are both persisted in MariaDB.
- Realtime and historical graphs use the same 10-minute bucket resolution.

See [IoT workflow](../docs/node-red-iot-workflow.md) and [API contract](../docs/node-red-api.md).

## Flow layout

ไฟล์ `flows.json` ที่สร้างขึ้นมี 4 แท็บ:

1. `01 จำลองข้อมูลอุปกรณ์หน้างาน`
2. `02 ประมวลผลข้อมูล GR`
3. `03 ประมวลผลข้อมูล TTN`
4. `04 ฐานข้อมูลและ API`

Each company has four visible sensor lanes. Every lane passes through gateway validation and signal processing before a company-specific batch aggregator creates one synchronized oven snapshot.

## Run or import

1. Open Node-RED at `http://127.0.0.1:1880`.
2. Import `node-red/flows.json` only when the deployed flow is older than this file.
3. Select full-flow import and press Deploy.
4. Check `http://127.0.0.1:1880/stcr/api/health?companyId=gr`.
5. Check `http://127.0.0.1:1880/stcr/api/health?companyId=ttn`.

The flow uses standard Node-RED nodes and Function nodes. No additional palette package is required.

## Source of truth

Function source files live in `node-red/functions/`. Do not edit generated Function node code inside `flows.json` directly. Rebuild and validate after a source change:

```powershell
npm run node-red:build
npm run node-red:validate
```

The web application uses Node-RED when `VITE_DATA_SOURCE=node-red` is configured. Each company can also point to a separate API URL through its company configuration when the production deployment is split later.
