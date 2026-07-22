# STCR Production Readiness

Audit date: 2026-07-22
Decision: **NO-GO for factory production**

## Blocking items

1. Confirm why the broker currently publishes only ovens 1-6 although TTN has ovens 1-9. Oven numbers map directly, `oven_state` and `startoven` agree in observed messages, and `page` is currently ignored because it was always `1` and has no confirmed business meaning.
2. Enable MQTT TLS on port 8883, rotate the credential that was shared in plaintext, and re-test certificate validation.
3. Generate and activate separate GR and TTN ingestion API keys, scoped to the correct company/oven, then execute replay and cross-tenant rejection tests for HTTP ingestion.
4. Create the least-privilege production MySQL account and verify its grants. Never run Node-RED as MySQL root.
5. Establish retention jobs for raw MQTT, telemetry and audit data.
6. Finish alarm creation/resolution and offline-sensor monitoring from real telemetry, then test restart recovery from MySQL.
7. Copy backups to encrypted off-host storage and perform a documented restore drill with measured recovery time.
8. Add monitoring for DB connectivity, last telemetry age per oven, ingestion failures, disk usage, backup age and Node-RED process health.
9. Run end-to-end acceptance for both companies: login/roles, tenant isolation, 6-day realtime graph, historical cycle, PDF/CSV, settings and loss-of-signal behavior.
10. Obtain authorized SSH key access and validate the systemd, nginx, firewall, MariaDB and backup configuration on the actual Ubuntu host.

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

## Completed on 2026-07-22

- Added one-minute sensor aggregation and changed history/report queries to use the same stored averages.
- Implemented the real MQTT cycle lifecycle: an open oven starts recording immediately and a closed oven completes the report boundary.
- Verified the lifecycle with an automated MySQL integration test and observed real TTN messages create ignition cycles.
- Corrected the factory timestamp by 420 minutes and confirmed new source/receive timestamps have zero-second offset.
- Added offline status persistence after 180 seconds without data and corrected rejected CORS origins to return HTTP 403.
- Added GR ovens 11-26 to clean installs and existing-install migration without overwriting local settings.

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
