# STCR Production Readiness

Audit date: 2026-07-21  
Decision: **NO-GO for factory production**

## Blocking items

1. Confirm why the broker currently publishes only ovens 1-6 although TTN has ovens 1-9. Oven numbers map directly, `oven_state` and `startoven` agree in observed messages, and `page` is currently ignored because it was always `1` and has no confirmed business meaning.
2. Implement the real oven-cycle state machine for telemetry ingestion: ignition, 30-minute ready hold, recording, completed/cancelled, and report boundaries.
3. Configure the issued TTN API key and run a controlled database-forwarding test before leaving MQTT forwarding enabled.
4. Enable MQTT TLS on port 8883, rotate the credential that was shared in plaintext, and re-test certificate validation.
5. Generate and activate separate GR and TTN ingestion API keys, scoped to the correct company/oven, then execute replay and cross-tenant rejection tests.
6. Create the least-privilege production MySQL account and verify its grants. Never run Node-RED as MySQL root.
7. Establish retention jobs for raw MQTT, telemetry and audit data.
8. Finish alarm creation/resolution and offline-sensor monitoring from real telemetry, then test restart recovery from MySQL.
9. Copy backups to encrypted off-host storage and perform a documented restore drill with measured recovery time.
10. Add monitoring for DB connectivity, last telemetry age per oven, ingestion failures, disk usage, backup age and Node-RED process health.
11. Run end-to-end acceptance for both companies: login/roles, tenant isolation, 6-day realtime graph, historical cycle, PDF/CSV, settings and loss-of-signal behavior.
12. Obtain authorized SSH key access and validate the systemd, nginx, firewall, MariaDB and backup configuration on the actual Ubuntu host.

## Completed in the 2026-07-21 audit

- Subscribed read-only to the real `test` and `sensor` topics with QoS 1 and confirmed valid JSON payloads.
- Confirmed the feed belongs to TTN and configured explicit oven mapping 1-9.
- Detected that the source emits Bangkok wall-clock time with a trailing `Z` (seven hours in the future) and added an explicit 420-minute source-time correction.
- Added an environment-controlled MQTT adapter; forwarding to MySQL is off by default.
- Added original-payload retention in `factory_mqtt_messages` with duplicate detection.
- Added database-backed runtime startup and removed runtime test-data generators.
- Persisted oven settings and alarm acknowledgement changes to MySQL.
- Made production history and CSV fail visibly when MySQL is unavailable.
- Added Ubuntu Node-RED, nginx, local backup service and daily timer templates.
- Confirmed anonymous MQTT access is rejected; confirmed port 1883 is reachable and TLS port 8883 is not.
- Production dependency audit reports zero known vulnerabilities.

## Guardrails already present

- Passwords use Argon2id hashes; ingestion keys use HMAC-SHA-256 hashes with an external pepper.
- API requests validate company and oven ownership and reject sequence replay/invalid physical ranges.
- Telemetry persistence uses transactions and unique constraints.
- The frontend and Node-RED Flow contain no runtime test-data generator or fallback data source.
- Production environment preflight rejects placeholders, weak/missing secrets and temporary tunnel URLs.
- TypeScript build, Node-RED contract validation and production dependency audit run in CI.
- Desktop and iPad smoke tests passed at 1440x900 and 1024x768 without horizontal page overflow using the same-origin development proxy.

## Release gate

Run these from the exact release commit and final environment:

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run typecheck
npm run node-red:build
npm run node-red:validate
npm run build
npm run production:preflight
```

Deployment is approved only when all commands pass, all blocking items are closed, a backup restore has been demonstrated, and the factory acceptance test is signed off.
