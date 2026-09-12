#!/usr/bin/env bash
set -Eeuo pipefail

release_directory="${1:-}"
if [[ -z "$release_directory" ]]; then
  echo "Usage: $0 /opt/stcr/releases/<release>" >&2
  exit 2
fi

release_directory="$(readlink -f "$release_directory")"
case "$release_directory" in
  /opt/stcr/releases/*) ;;
  *)
    echo "Release must be inside /opt/stcr/releases" >&2
    exit 2
    ;;
esac

test -f "$release_directory/deploy/ubuntu/ecosystem.config.cjs"
test -f "$release_directory/dist/index.html"
old_release="$(readlink -f /opt/stcr/current)"

pm2_stcr() {
  runuser -u stcr -- env HOME=/home/stcr PM2_HOME=/home/stcr/.pm2 \
    PATH=/opt/stcr-node/bin:/usr/bin:/bin /usr/bin/pm2 "$@"
}

rollback() {
  if [[ -n "$old_release" && -d "$old_release" ]]; then
    ln -sfn "$old_release" /opt/stcr/current
    pm2_stcr startOrReload "$old_release/deploy/ubuntu/ecosystem.config.cjs" --update-env || true
    pm2_stcr save --force || true
  fi
}
trap rollback ERR

ln -sfn "$release_directory" /opt/stcr/current
pm2_stcr startOrReload /opt/stcr/current/deploy/ubuntu/ecosystem.config.cjs --update-env

for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/healthz >/dev/null && \
     curl -fsS http://127.0.0.1:3001/readyz >/dev/null; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "Release did not become ready" >&2
    false
  fi
  sleep 1
done

install -d -o www-data -g stcr -m 0750 /var/www/stcr
rsync -a --exclude=index.html "$release_directory/dist/" /var/www/stcr/
install -o www-data -g stcr -m 0640 \
  "$release_directory/dist/index.html" /var/www/stcr/.index.html.next
mv -f /var/www/stcr/.index.html.next /var/www/stcr/index.html
printf '%s\n' "$(basename "$release_directory")" >/var/www/stcr/.release
chown www-data:stcr /var/www/stcr/.release
chmod 0640 /var/www/stcr/.release

pm2_stcr save --force
trap - ERR
echo "Activated $release_directory"
