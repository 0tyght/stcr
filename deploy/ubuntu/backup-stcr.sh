#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ENV_FILE="${STCR_ENV_FILE:-/etc/stcr/stcr.env}"
BACKUP_DIR="${STCR_BACKUP_DIR:-/var/backups/stcr}"
RETENTION_DAYS="${STCR_BACKUP_RETENTION_DAYS:-14}"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Cannot read $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for name in STCR_DB_HOST STCR_DB_PORT STCR_DB_NAME STCR_BACKUP_DB_USER STCR_BACKUP_DB_PASSWORD; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing $name" >&2
    exit 1
  fi
done

install -d -m 0700 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/stcr-$stamp.sql.gz"
temporary="$target.partial"
client_config="$(mktemp)"

cleanup() {
  rm -f "$client_config" "$temporary"
}
trap cleanup EXIT

cat >"$client_config" <<EOF
[client]
host=$STCR_DB_HOST
port=$STCR_DB_PORT
user=$STCR_BACKUP_DB_USER
password=$STCR_BACKUP_DB_PASSWORD
default-character-set=utf8mb4
EOF
chmod 0600 "$client_config"

mysqldump \
  --defaults-extra-file="$client_config" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --hex-blob \
  "$STCR_DB_NAME" | gzip -9 >"$temporary"

gzip -t "$temporary"
test -s "$temporary"
mv "$temporary" "$target"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'stcr-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
echo "STCR backup completed: $target"
