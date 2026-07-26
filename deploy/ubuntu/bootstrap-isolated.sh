#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

BOOTSTRAP_ENV="${1:-/home/tytcdev/stcr-bootstrap.env}"
if [[ ! -r "$BOOTSTRAP_ENV" ]]; then
  echo "Missing bootstrap environment: $BOOTSTRAP_ENV" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$BOOTSTRAP_ENV"
set +a

: "${STCR_RELEASE_SHA:?STCR_RELEASE_SHA is required}"
: "${STCR_FACTORY_MQTT_USERNAME:?STCR_FACTORY_MQTT_USERNAME is required}"
: "${STCR_FACTORY_MQTT_PASSWORD:?STCR_FACTORY_MQTT_PASSWORD is required}"

case "$STCR_RELEASE_SHA" in
  (*[!0-9a-f]*|"") echo "Invalid STCR_RELEASE_SHA" >&2; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git xz-utils

if ! id stcr >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/stcr \
    --shell /usr/sbin/nologin stcr
fi

install -d -o stcr -g stcr -m 0750 \
  /opt/stcr/releases /opt/stcr/output /home/stcr/.pm2 /var/log/stcr
install -d -o www-data -g stcr -m 0750 /var/www/stcr
install -d -o root -g stcr -m 0750 /etc/stcr
install -d -o root -g root -m 0700 /var/backups/stcr

node_archive="$(
  curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt |
    awk '$2 ~ /^node-v24\..*-linux-x64\.tar\.xz$/ { print $2; exit }'
)"
if [[ -z "$node_archive" ]]; then
  echo "Cannot resolve the current Node.js 24 archive" >&2
  exit 1
fi
node_directory="${node_archive%.tar.xz}"
if [[ ! -x "/opt/$node_directory/bin/node" ]]; then
  temporary_directory="$(mktemp -d)"
  trap 'rm -rf "$temporary_directory"' EXIT
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$node_archive" \
    -o "$temporary_directory/$node_archive"
  curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt \
    -o "$temporary_directory/SHASUMS256.txt"
  (
    cd "$temporary_directory"
    grep "  $node_archive\$" SHASUMS256.txt | sha256sum -c -
  )
  tar -xJf "$temporary_directory/$node_archive" -C /opt
fi
chown -R root:root "/opt/$node_directory"
ln -sfn "/opt/$node_directory" /opt/stcr-node
/opt/stcr-node/bin/node --version

release_directory="/opt/stcr/releases/$STCR_RELEASE_SHA"
if [[ ! -d "$release_directory/.git" ]]; then
  runuser -u stcr -- git clone --filter=blob:none \
    https://github.com/0tyght/stcr.git "$release_directory"
fi
runuser -u stcr -- git -C "$release_directory" fetch --prune origin main
runuser -u stcr -- git -C "$release_directory" checkout --detach "$STCR_RELEASE_SHA"
test "$(runuser -u stcr -- git -C "$release_directory" rev-parse HEAD)" = "$STCR_RELEASE_SHA"
ln -sfn "$release_directory" /opt/stcr/current

runuser -u stcr -- env \
  HOME=/home/stcr \
  PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  /opt/stcr-node/bin/npm --prefix "$release_directory" ci
runuser -u stcr -- env \
  HOME=/home/stcr \
  PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  /opt/stcr-node/bin/npm --prefix "$release_directory" run build
runuser -u stcr -- env \
  HOME=/home/stcr \
  PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  /opt/stcr-node/bin/npm --prefix "$release_directory" prune --omit=dev

find /var/www/stcr -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a "$release_directory/dist/." /var/www/stcr/
chown -R www-data:stcr /var/www/stcr
find /var/www/stcr -type d -exec chmod 0750 {} +
find /var/www/stcr -type f -exec chmod 0640 {} +

db_app_password="$(openssl rand -base64 48 | tr -d '\n')"
db_migration_password="$(openssl rand -base64 48 | tr -d '\n')"
db_backup_password="$(openssl rand -base64 48 | tr -d '\n')"
api_key_pepper="$(openssl rand -hex 48)"

mysql --protocol=socket <<SQL
CREATE DATABASE IF NOT EXISTS stcr
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'stcr_app'@'localhost' IDENTIFIED BY '${db_app_password}';
ALTER USER 'stcr_app'@'localhost' IDENTIFIED BY '${db_app_password}';
CREATE USER IF NOT EXISTS 'stcr_app'@'127.0.0.1' IDENTIFIED BY '${db_app_password}';
ALTER USER 'stcr_app'@'127.0.0.1' IDENTIFIED BY '${db_app_password}';
CREATE USER IF NOT EXISTS 'stcr_migrator'@'localhost' IDENTIFIED BY '${db_migration_password}';
ALTER USER 'stcr_migrator'@'localhost' IDENTIFIED BY '${db_migration_password}';
CREATE USER IF NOT EXISTS 'stcr_migrator'@'127.0.0.1' IDENTIFIED BY '${db_migration_password}';
ALTER USER 'stcr_migrator'@'127.0.0.1' IDENTIFIED BY '${db_migration_password}';
CREATE USER IF NOT EXISTS 'stcr_backup'@'localhost' IDENTIFIED BY '${db_backup_password}';
ALTER USER 'stcr_backup'@'localhost' IDENTIFIED BY '${db_backup_password}';
CREATE USER IF NOT EXISTS 'stcr_backup'@'127.0.0.1' IDENTIFIED BY '${db_backup_password}';
ALTER USER 'stcr_backup'@'127.0.0.1' IDENTIFIED BY '${db_backup_password}';
GRANT SELECT, INSERT, UPDATE, DELETE ON stcr.* TO 'stcr_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON stcr.* TO 'stcr_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON stcr.* TO 'stcr_migrator'@'localhost';
GRANT ALL PRIVILEGES ON stcr.* TO 'stcr_migrator'@'127.0.0.1';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES ON stcr.* TO 'stcr_backup'@'localhost';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES ON stcr.* TO 'stcr_backup'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

if ! mysql --protocol=socket -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='stcr'" |
  grep -qv '^0$'; then
  mysql --protocol=socket < "$release_directory/database/schema.sql"
fi

cat > /etc/stcr/stcr.env <<EOF
STCR_DEPLOYMENT_MODE=production
STCR_API_HOST=127.0.0.1
STCR_API_PORT=3001
STCR_SERVE_FRONTEND=false
STCR_TRUST_PROXY=true
STCR_ALLOWED_ORIGINS=http://127.0.0.1:8300
STCR_HTTP_ACCESS_LOG=true
STCR_HTTP_BODY_LIMIT_BYTES=32768
STCR_HTTP_REQUEST_TIMEOUT_MS=30000
STCR_HTTP_HEADERS_TIMEOUT_MS=35000
STCR_HTTP_KEEP_ALIVE_TIMEOUT_MS=5000
STCR_SHUTDOWN_TIMEOUT_MS=15000
STCR_DB_HOST=127.0.0.1
STCR_DB_PORT=3306
STCR_DB_USER=stcr_app
STCR_DB_PASSWORD=${db_app_password}
STCR_DB_NAME=stcr
STCR_DB_CONNECT_TIMEOUT_MS=5000
STCR_DB_HEALTH_TIMEOUT_MS=3000
STCR_SESSION_TTL_MINUTES=480
STCR_OFFLINE_THRESHOLD_SECONDS=180
STCR_API_KEY_PEPPER=${api_key_pepper}
STCR_HTTP_INGEST_ENABLED=false
STCR_FACTORY_MQTT_ENABLED=true
STCR_FACTORY_MQTT_URL=mqtt://127.0.0.1:1883
STCR_FACTORY_MQTT_USERNAME=${STCR_FACTORY_MQTT_USERNAME}
STCR_FACTORY_MQTT_PASSWORD=${STCR_FACTORY_MQTT_PASSWORD}
STCR_FACTORY_MQTT_CLIENT_ID=stcr-production-server
STCR_FACTORY_MQTT_QOS=1
STCR_FACTORY_MQTT_KEEPALIVE_SECONDS=30
STCR_FACTORY_MQTT_RECONNECT_MS=5000
STCR_FACTORY_MQTT_CONNECT_TIMEOUT_MS=10000
STCR_FACTORY_MQTT_MAX_PAYLOAD_BYTES=8192
STCR_FACTORY_MQTT_MAX_PENDING_MESSAGES=1000
STCR_FACTORY_MQTT_ALLOW_RETAINED_SENSOR=false
STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED=true
STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON='{"test":{"companyId":"ttn","messageType":"status"},"sensor":{"companyId":"ttn","messageType":"sensor"},"status_gr":{"companyId":"gr","messageType":"status"},"sensor_gr":{"companyId":"gr","messageType":"sensor"}}'
STCR_FACTORY_MQTT_OVEN_MAPS_JSON='{"ttn":{"1":"oven-1","2":"oven-2","3":"oven-3","4":"oven-4","5":"oven-5","6":"oven-6","7":"oven-7","8":"oven-8","9":"oven-9"},"gr":{"11":"oven-11","12":"oven-12","13":"oven-13","14":"oven-14","15":"oven-15","16":"oven-16","17":"oven-17","18":"oven-18","19":"oven-19","20":"oven-20","21":"oven-21","22":"oven-22","23":"oven-23","24":"oven-24","25":"oven-25","26":"oven-26"}}'
STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES=420
STCR_FACTORY_MQTT_SENSOR_RANGES_JSON='{"chamberTemp":{"min":-40,"max":150},"humidity":{"min":0,"max":100},"furnaceTemp":{"min":-40,"max":1000},"blowerTemp":{"min":-40,"max":600}}'
STCR_FACTORY_MQTT_OUT_OF_ORDER_TOLERANCE_MS=2000
STCR_FACTORY_MQTT_STORE_RAW_MESSAGES=false
STCR_BACKUP_RETENTION_DAYS=14
STCR_BACKUP_DB_USER=stcr_backup
STCR_BACKUP_DB_PASSWORD=${db_backup_password}
EOF
chown root:stcr /etc/stcr/stcr.env
chmod 0640 /etc/stcr/stcr.env

cat > /etc/stcr/migration.env <<EOF
STCR_DB_HOST=127.0.0.1
STCR_DB_PORT=3306
STCR_DB_USER=stcr_app
STCR_DB_PASSWORD=${db_app_password}
STCR_DB_NAME=stcr
STCR_DB_MIGRATION_USER=stcr_migrator
STCR_DB_MIGRATION_PASSWORD=${db_migration_password}
EOF
chown root:root /etc/stcr/migration.env
chmod 0600 /etc/stcr/migration.env

set -a
# shellcheck disable=SC1091
source /etc/stcr/migration.env
set +a
if [[ "$(mysql --protocol=socket -N stcr -e \
  "SELECT COUNT(*) FROM schema_migrations")" = "0" ]]; then
  /opt/stcr-node/bin/npm --prefix "$release_directory" run db:migrate -- --baseline
else
  /opt/stcr-node/bin/npm --prefix "$release_directory" run db:migrate
fi

install -o root -g root -m 0755 \
  "$release_directory/deploy/ubuntu/backup-stcr.sh" /usr/local/sbin/backup-stcr
install -o root -g root -m 0644 \
  "$release_directory/deploy/ubuntu/stcr-backup.service" /etc/systemd/system/stcr-backup.service
install -o root -g root -m 0644 \
  "$release_directory/deploy/ubuntu/stcr-backup.timer" /etc/systemd/system/stcr-backup.timer
install -o root -g root -m 0644 \
  "$release_directory/deploy/ubuntu/pm2-stcr.service" /etc/systemd/system/pm2-stcr.service

install -o root -g root -m 0644 \
  "$release_directory/deploy/ubuntu/nginx-stcr-local.conf" \
  /etc/nginx/sites-available/stcr-local
ln -sfn /etc/nginx/sites-available/stcr-local /etc/nginx/sites-enabled/stcr-local

cat > /etc/logrotate.d/stcr <<'EOF'
/var/log/stcr/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    create 0640 stcr stcr
}
EOF

nginx -t
systemctl reload nginx
systemctl daemon-reload

runuser -u stcr -- env \
  HOME=/home/stcr \
  PM2_HOME=/home/stcr/.pm2 \
  PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  /usr/bin/pm2 start "$release_directory/deploy/ubuntu/ecosystem.config.cjs" \
    --only stcr-api --update-env
runuser -u stcr -- env \
  HOME=/home/stcr \
  PM2_HOME=/home/stcr/.pm2 \
  PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  /usr/bin/pm2 save

systemctl enable pm2-stcr.service stcr-backup.timer
systemctl restart pm2-stcr.service
systemctl start stcr-backup.timer

rm -f "$BOOTSTRAP_ENV"

curl -fsS http://127.0.0.1:3001/readyz
curl -fsS http://127.0.0.1:8300/readyz
curl -fsS http://127.0.0.1:8300/runtime-config.json
echo
echo "STCR isolated deployment completed at $STCR_RELEASE_SHA"
