# STCR Database

The production source of truth is MariaDB/MySQL. Node-RED is responsible for ingestion and realtime delivery, not long-term storage.

## Data lifecycle

1. Node-RED sends one four-sensor batch per oven to `POST /stcr/api/telemetry` every minute with a company-scoped API Key.
2. Every individual IoT message is inserted into `telemetry_events` with topic, device, sensor, sequence, timestamps and quality.
   Factory MQTT payloads are also retained unchanged in `factory_mqtt_messages` before normalization.
3. Complete four-sensor oven snapshots are inserted into `sensor_readings`, including ignition data.
4. `oven_cycles.fired_at` records the first fire event.
5. `report_started_at` is set only after chamber temperature stays above the configured lower limit for 30 minutes.
6. Samples before `report_started_at` use `cycle_phase='ignition'` and `included_in_report=FALSE`.
7. Report and historical queries select `included_in_report=TRUE` for the requested `cycle_id`.
8. Invalid or discontinuous source values are retained with `quality='suspect'`; they are never silently rewritten.

`users`, `roles`, `user_roles`, account status, company ownership and API Key hashes are stored in MySQL. Passwords use Argon2id hashes. API keys are compared using HMAC-SHA-256 with `STCR_API_KEY_PEPPER`; plaintext passwords and API keys are never stored in the database.

## Initialize with XAMPP

Start MySQL in the XAMPP Control Panel, then run:

```powershell
C:\xampp\mysql\bin\mysql.exe -u root < database\schema.sql
```

Apply numbered files in `database/migrations` in order when upgrading an existing database.

Use a dedicated database account and environment variables outside source control in production. Do not use the root account from Node-RED.

The local XAMPP setup uses the limited `stcr_app@127.0.0.1` account. Production must set `STCR_DB_HOST`, `STCR_DB_PORT`, `STCR_DB_USER`, `STCR_DB_PASSWORD`, and `STCR_DB_NAME` before starting Node-RED.

Apply `database/migrations/005_identity_api_keys_and_gr_report.sql` to an existing installation. It assigns `F01-05-05 R07` and `22/06/67` only to `company_id='gr'`; TTN keeps its own report metadata.
