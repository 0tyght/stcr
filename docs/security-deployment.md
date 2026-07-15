# STCR Security Deployment Checklist

The repository now protects the application/API boundary for development. Complete this checklist before real sensor or internet exposure.

## Required before production

1. Put the website and Node-RED behind HTTPS. Redirect HTTP to HTTPS and enable HSTS after HTTPS is verified.
2. Enable Node-RED `adminAuth` and `credentialSecret`; restrict the editor/admin API to a VPN or administrator network. Keep the HTTP API on its Bearer-token authentication rather than stacking `httpNodeAuth` Basic auth on the same Authorization header.
3. Set exact `STCR_ALLOWED_ORIGINS`. Never use `*` with this API.
4. Create users with `node node-red/create-user.mjs`; store only the generated Argon2id hash in MySQL.
5. Set a non-empty `STCR_DB_PASSWORD`; grant the application account only SELECT, INSERT, UPDATE, and DELETE on the `stcr` database.
6. Bind MariaDB to localhost/private network and block public port 3306.
7. Put Node-RED behind a reverse proxy with request logging, additional per-IP rate limiting, body limits, and the security headers already used by the local preview.
8. Configure MQTT/field gateways with TLS, unique client credentials, and ACLs restricted to `stcr/<company>/<oven>/telemetry/#` for that device.
9. Store backups encrypted, test restoration, and define data retention for raw telemetry, reports, alarms, and audit events.
10. Set a random `STCR_API_KEY_PEPPER`, issue separate API keys for GR and TTN, and keep plaintext keys only in the matching Node-RED secret environment.
11. Run a final authenticated penetration test using the actual domain, reverse proxy, Node-RED runtime, database grants, and field gateway.

## Runtime secrets

Keep these outside the frontend and outside Git: `STCR_DB_PASSWORD`, `STCR_API_KEY_PEPPER`, plaintext ingestion API keys, TLS private keys, MQTT credentials, Node-RED credential secret, and reverse-proxy secrets. Variables beginning with `VITE_` are public browser configuration and must never contain secrets.

On Ubuntu, copy `deploy/ubuntu/stcr.env.example` to `/etc/stcr/stcr.env`, replace every placeholder, set ownership to the Node-RED service account and permissions to `0600`. Install `deploy/ubuntu/node-red-stcr-override.conf` as the systemd override, then run `systemctl daemon-reload` and restart Node-RED. The real `/etc/stcr/stcr.env` must never be placed inside the repository.
