# STCR Database

MariaDB/MySQL is the production source of truth. Express subscribes to the
configured TTN and GR MQTT topics and keeps only the latest valid values in
memory for the realtime screen.

## Core data model

The application owns these groups:

- Identity: `companies`, `users`, `roles`, `user_roles`, `sessions`, `api_keys`
- Oven configuration: `ovens`
- Production: `oven_cycles`
- Sensor history: `sensor_minute_aggregates`
- Operations: `alarms`, `report_document_settings`, `audit_events`
- Ingestion diagnostics: `factory_mqtt_messages`
- Database control: `schema_migrations`

`sensor_minute_aggregates` is the only canonical sensor-history table. One row
represents one company, one oven and one UTC minute. Each fixed sensor keeps its
average, minimum, maximum, last value and accepted sample count. This wide row
is intentional: it avoids four times as many rows and keeps dashboard/report
queries simple.

The realtime screen is not written once per second. Valid MQTT values update
memory immediately, while completed minute buckets are written once to the
canonical table. Impossible values never enter realtime, history or reports.
Rejected, duplicate or incomplete MQTT payloads may be retained in
`factory_mqtt_messages` for diagnosis.

An open sensor state creates an `oven_cycles` row immediately. A closed state
marks that cycle as stopped. `cycle_number` is always the official production
round received from the factory; a temporary close/open signal does not make
the website invent another number. `source_cycle_number` retains the PLC value
for traceability. Reports and historical graphs query the canonical minute
table by `company_id`, `oven_id` and `cycle_id`.

All database timestamps are UTC. The company timezone is applied only at the
display and export boundary.

## Legacy-data boundary

STCR runtime does not map an older database schema. Migration 012 detaches the
previous duplicate runtime tables as:

- `legacy_sensor_readings`
- `legacy_telemetry_events`

They are preserved only as input for a separate data-mapping task. They are not
queried or written by the MQTT runtime. A legacy import should write normalized
one-minute rows to `sensor_minute_aggregates` with `source_kind='import'` and a
stable `source_ref`. It must not add old columns to the STCR core tables.

## Security

Passwords use Argon2id hashes. API keys are compared using HMAC-SHA-256 with
`STCR_API_KEY_PEPPER`; plaintext passwords and API keys are never stored in the
database.

Use separate accounts:

- Runtime: `SELECT`, `INSERT`, `UPDATE`, `DELETE` only
- Migration: schema-change privileges used only during deployment

Do not use the MariaDB root account from the application and do not keep
credentials in Git.

## Initialize and migrate

For a fresh database, load `database/schema.sql`.

For an existing database created before migration tracking, verify that it
already contains migrations 002-011 and then run this once:

```powershell
npm run db:migrate -- --baseline
```

After the baseline, run:

```powershell
npm run db:migrate
```

Later deployments only run the second command. Applied migration checksums are
verified and modified historical migrations are rejected.

Production must define `STCR_DB_HOST`, `STCR_DB_PORT`, `STCR_DB_USER`,
`STCR_DB_PASSWORD`, and `STCR_DB_NAME` before starting Express with PM2.
