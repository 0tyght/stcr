# STCR Ubuntu layout

STCR must not share runtime users, PM2 homes, databases, logs or application
directories with the older GR/TTN services.

- Linux service user: `stcr`
- Application: `/opt/stcr/current`
- Isolated Node.js 24: `/opt/stcr-node`
- Frontend: `/var/www/stcr`
- Environment: `/etc/stcr/stcr.env`
- Logs: `/var/log/stcr`
- Backups: `/var/backups/stcr`
- PM2 home: `/home/stcr/.pm2`
- API listener: `127.0.0.1:3001`
- Pre-domain Nginx listener: `127.0.0.1:8300`
- Database: `stcr`
- Runtime DB user: `stcr_app`
- Migration DB user: `stcr_migrator`
- Backup DB user: `stcr_backup`

Before a domain is assigned, enable `nginx-stcr-local.conf`. It is reachable
only from the Ubuntu host and is intended for deployment smoke tests.

After DNS is ready:

1. Replace the placeholders in `nginx-stcr.conf`.
2. Obtain and verify the TLS certificate.
3. Test `nginx -t`.
4. Enable the public site and remove the local-only site.
5. Run the full browser acceptance test before retiring an older system.
