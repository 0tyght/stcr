# STCR Database

The production source of truth is MariaDB/MySQL. Node-RED is responsible for ingestion and realtime delivery, not long-term storage.

## Data lifecycle

1. Node-RED subscribes directly to the configured TTN and GR MQTT topics. Valid values update the realtime screen immediately.
2. Values are aggregated per company, oven and receive-time minute into `sensor_minute_aggregates` with average, minimum, maximum, last value and sample count.
3. Broad physical bounds quarantine impossible values before realtime display, aggregation and reporting. Only anomalous payloads are retained in `factory_mqtt_messages` when full raw retention is disabled.
4. Exact duplicates and messages older than the latest accepted source timestamp do not change realtime or aggregate values.
5. An open status creates a recording `oven_cycles` row immediately; a closed status completes the active cycle.
6. Report and historical queries use `sensor_minute_aggregates` for the selected cycle. `sensor_readings` remains temporary compatibility storage and is not the source of truth.
7. All database timestamps are UTC. Company timezone is applied only when displaying dates.

`users`, `roles`, `user_roles`, account status, company ownership and API Key hashes are stored in MySQL. Passwords use Argon2id hashes. API keys are compared using HMAC-SHA-256 with `STCR_API_KEY_PEPPER`; plaintext passwords and API keys are never stored in the database.

## Initialize with XAMPP

Start MySQL in the XAMPP Control Panel, then run:

```powershell
C:\xampp\mysql\bin\mysql.exe -u root < database\schema.sql
```

Apply numbered files through `npm run db:migrate`. For an existing database that was
created before migration tracking, verify that it already contains migrations 002-011,
then run `npm run db:migrate -- --baseline` once. Never baseline an unverified database.
Later deployments can run `npm run db:migrate`; changed checksums are rejected.

Use a dedicated database account and environment variables outside source control in production. Do not use the root account from Node-RED.

The local XAMPP setup uses the limited `stcr_app@127.0.0.1` account. Production must set `STCR_DB_HOST`, `STCR_DB_PORT`, `STCR_DB_USER`, `STCR_DB_PASSWORD`, and `STCR_DB_NAME` before starting Node-RED.

The runtime account needs only `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on `stcr.*`. Run schema migrations with a separate administrator account; do not grant `CREATE`, `ALTER`, `DROP`, or `GRANT OPTION` to the Node-RED runtime user.

Apply `database/migrations/005_identity_api_keys_and_gr_report.sql` to an existing installation. It assigns `F01-05-05 R07` and `22/06/67` only to `company_id='gr'`; TTN keeps its own report metadata.
