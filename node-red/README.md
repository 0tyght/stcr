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

1. Apply the latest MySQL migration.
2. Run `node node-red/create-user.mjs` for each account and execute the generated SQL. The password is shown once; MySQL receives only its Argon2id hash.
3. Set `STCR_API_KEY_PEPPER`, then run `node node-red/create-api-key.mjs` separately for GR and TTN. Execute the generated SQL and put each plaintext key only in the corresponding Node-RED secret environment.
4. Set `STCR_HTTP_INGEST_ENABLED=true`, exact `STCR_ALLOWED_ORIGINS`, and database environment variables before starting Node-RED. See `.env.example`.
5. Open Node-RED at `http://127.0.0.1:1880`.
6. Import `node-red/flows.json` only when the deployed flow is older than this file.
7. Select full-flow import and press Deploy.
8. Check `http://127.0.0.1:1880/stcr/api/health`. The public health response intentionally does not reveal company names.

The flow uses standard Node-RED nodes and Function nodes. No additional palette package is required.

## Source of truth

Function source files live in `node-red/functions/`. Do not edit generated Function node code inside `flows.json` directly. Rebuild and validate after a source change:

```powershell
npm run node-red:build
npm run node-red:validate
```

The web application uses Node-RED when `VITE_DATA_SOURCE=node-red` is configured. Each company can also point to a separate API URL through its company configuration when the production deployment is split later.

## Security boundary

- MySQL stores usernames, Argon2id password hashes, company ownership, roles and account status. Password plaintext is never persisted.
- MySQL stores only HMAC hashes of API keys. Plaintext API keys and `STCR_API_KEY_PEPPER` remain in Ubuntu/Node-RED secrets outside Git.
- CORS defaults allow local Vite/preview only. Set the exact production origins; wildcard origins are rejected.
- API sessions use opaque Bearer tokens, expire after 8 hours by default, and are invalidated when Node-RED restarts.
- Enable `adminAuth`, HTTPS, `credentialSecret`, a protected reverse proxy, explicit host binding, and firewall rules in the production Node-RED `settings.js`. These runtime settings are machine-owned and are intentionally not committed here. Do not add `httpNodeAuth` Basic authentication on top of this API without redesigning the Authorization header, because the application already uses Bearer tokens.
- Do not expose port 3306. Use a dedicated `stcr_app` account with only the privileges required by this schema.
- A real MQTT broker must require TLS, unique gateway credentials, and topic ACLs. The flow validates identity fields, topic shape, known oven ownership, and sequence replay, but broker authentication remains the production trust boundary.
