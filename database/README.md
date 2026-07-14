# STCR Database

The production source of truth is MariaDB/MySQL. Node-RED is responsible for ingestion and realtime delivery, not long-term storage.

## Data lifecycle

1. Every individual IoT message is inserted into `telemetry_events` with topic, device, sensor, sequence, timestamps and quality.
2. Complete four-sensor oven snapshots are inserted into `sensor_readings`, including ignition data.
3. `oven_cycles.fired_at` records the first fire event.
4. `report_started_at` is set only after chamber temperature stays above the configured lower limit for 30 minutes.
5. Samples before `report_started_at` use `cycle_phase='ignition'` and `included_in_report=FALSE`.
6. Report and historical queries select `included_in_report=TRUE` for the requested `cycle_id`.
7. Invalid or discontinuous source values are retained with `quality='suspect'`; they are never silently rewritten.

## Initialize with XAMPP

Start MySQL in the XAMPP Control Panel, then run:

```powershell
C:\xampp\mysql\bin\mysql.exe -u root < database\schema.sql
```

Apply numbered files in `database/migrations` in order when upgrading an existing database.

Use a dedicated database account and environment variables outside source control in production. Do not use the root account from Node-RED.

The local XAMPP setup uses the limited `stcr_app@127.0.0.1` account. Production must set `STCR_DB_HOST`, `STCR_DB_PORT`, `STCR_DB_USER`, `STCR_DB_PASSWORD`, and `STCR_DB_NAME` before starting Node-RED.
