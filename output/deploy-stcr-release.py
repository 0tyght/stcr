import argparse
import pathlib
import re
import sys

import paramiko


def read_connection_notes(path: pathlib.Path) -> tuple[str, str, str]:
    text = path.read_text(encoding="utf-8")
    host = re.search(r"host\s*:\s*([0-9.]+)", text, re.IGNORECASE)
    username = re.search(r"Username\s*\|\s*`([^`]+)`", text)
    password = re.search(r"Password\s*\|\s*`([^`]+)`", text)
    if not (host and username and password):
        raise RuntimeError("อ่านข้อมูลเชื่อมต่อจาก setup notes ไม่ครบ")
    return host.group(1), username.group(1), password.group(1)


def run(
    client: paramiko.SSHClient,
    command: str,
    password: str | None = None,
    timeout: int = 900,
) -> str:
    stdin, stdout, stderr = client.exec_command(
        command,
        timeout=timeout,
        get_pty=password is not None,
    )
    if password is not None:
        stdin.write(password + "\n")
        stdin.flush()
    output = stdout.read().decode("utf-8", errors="replace")
    error = stderr.read().decode("utf-8", errors="replace")
    status = stdout.channel.recv_exit_status()
    if output:
        print(output, end="")
    if error:
        print(error, end="", file=sys.stderr)
    if status != 0:
        raise RuntimeError(f"คำสั่งบนเซิร์ฟเวอร์ล้มเหลว (exit {status})")
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--notes", required=True)
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{7,40}", args.sha):
        raise RuntimeError("Release SHA ไม่ถูกต้อง")

    host, username, password = read_connection_notes(pathlib.Path(args.notes))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=host,
        username=username,
        password=password,
        timeout=15,
        auth_timeout=15,
        banner_timeout=15,
        look_for_keys=False,
        allow_agent=False,
    )
    try:
        print("== Current production state ==")
        run(
            client,
            "hostname; whoami; readlink -f /opt/stcr/current; "
            "git -C /opt/stcr/current rev-parse HEAD; "
            "curl -fsS http://127.0.0.1:3001/readyz",
        )

        release = f"/opt/stcr/releases/{args.sha}"
        remote_script = f"""set -Eeuo pipefail
sha='{args.sha}'
release='{release}'
previous="$(readlink -f /opt/stcr/current)"
timestamp="$(date +%Y%m%d-%H%M%S)"
frontend_backup="/var/backups/stcr/frontend-$timestamp"
env_backup="/etc/stcr/stcr.env.bak-$timestamp"
target_env="/tmp/stcr-target-env-$timestamp"
switched=0

rollback() {{
  code=$?
  rm -f "$target_env"
  if [[ "$switched" = 1 ]]; then
    echo "Deployment failed; rolling back to $previous" >&2
    ln -sfn "$previous" /opt/stcr/current
    rm -rf /var/www/stcr
    cp -a "$frontend_backup" /var/www/stcr
    cp -a "$env_backup" /etc/stcr/stcr.env
    chown -R www-data:stcr /var/www/stcr
    runuser -u stcr -- env HOME=/home/stcr PM2_HOME=/home/stcr/.pm2 \
      PATH=/opt/stcr-node/bin:/usr/bin:/bin \
      /usr/bin/pm2 restart stcr-api --update-env || true
  fi
  exit "$code"
}}
trap rollback ERR

cd /home/stcr
cp -a /etc/stcr/stcr.env "$target_env"
if grep -q '^STCR_OFFLINE_THRESHOLD_SECONDS=' "$target_env"; then
  sed -i 's/^STCR_OFFLINE_THRESHOLD_SECONDS=.*/STCR_OFFLINE_THRESHOLD_SECONDS=300/' \
    "$target_env"
else
  printf '\\nSTCR_OFFLINE_THRESHOLD_SECONDS=300\\n' >> "$target_env"
fi
if grep -q '^STCR_ALLOWED_ORIGINS=' "$target_env"; then
  sed -i 's|^STCR_ALLOWED_ORIGINS=.*|STCR_ALLOWED_ORIGINS=https://report.tytc-rubber.site|' \
    "$target_env"
else
  printf '\\nSTCR_ALLOWED_ORIGINS=https://report.tytc-rubber.site\\n' >> "$target_env"
fi
sensor_ranges='{{"chamberTemp":{{"min":0,"max":150}},"humidity":{{"min":0,"max":100}},"furnaceTemp":{{"min":0,"max":1000}},"blowerTemp":{{"min":0,"max":600}}}}'
spike_limits='{{"chamberTemp":12,"humidity":20,"furnaceTemp":200,"blowerTemp":120}}'
if grep -q '^STCR_FACTORY_MQTT_SENSOR_RANGES_JSON=' "$target_env"; then
  sed -i "s|^STCR_FACTORY_MQTT_SENSOR_RANGES_JSON=.*|STCR_FACTORY_MQTT_SENSOR_RANGES_JSON='$sensor_ranges'|" \
    "$target_env"
else
  printf "\\nSTCR_FACTORY_MQTT_SENSOR_RANGES_JSON='%s'\\n" "$sensor_ranges" >> "$target_env"
fi
if grep -q '^STCR_FACTORY_MQTT_SPIKE_LIMITS_JSON=' "$target_env"; then
  sed -i "s|^STCR_FACTORY_MQTT_SPIKE_LIMITS_JSON=.*|STCR_FACTORY_MQTT_SPIKE_LIMITS_JSON='$spike_limits'|" \
    "$target_env"
else
  printf "STCR_FACTORY_MQTT_SPIKE_LIMITS_JSON='%s'\\n" "$spike_limits" >> "$target_env"
fi
chown root:stcr "$target_env"
chmod 0640 "$target_env"

if [[ ! -d "$release/.git" ]]; then
  runuser -u stcr -- env -u GIT_DIR -u GIT_WORK_TREE \
    git clone --filter=blob:none \
    https://github.com/0tyght/stcr.git "$release"
fi
runuser -u stcr -- env -u GIT_DIR -u GIT_WORK_TREE \
  git -C "$release" fetch --prune origin main
runuser -u stcr -- env -u GIT_DIR -u GIT_WORK_TREE \
  git -C "$release" checkout --detach "$sha"
echo "VERIFY_RELEASE_SHA"
ls -ld "$release" "$release/.git"
if [[ -f "$release/.git" ]]; then cat "$release/.git"; fi
grep -nE 'worktree|gitdir' "$release/.git/config" || true
[[ "$(cat "$release/.git/HEAD")" == "$sha"* ]]

echo "NPM_CI"
runuser -u stcr -- env HOME=/home/stcr PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  /opt/stcr-node/bin/npm --prefix "$release" ci
echo "BACKEND_CHECK"
runuser -u stcr -- env HOME=/home/stcr PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  /opt/stcr-node/bin/npm --prefix "$release" run backend:check
echo "BACKEND_PREFLIGHT"
runuser -u stcr -- env HOME=/home/stcr PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  STCR_ENV_FILE="$target_env" \
  /opt/stcr-node/bin/npm --prefix "$release" run backend:preflight
echo "FRONTEND_BUILD"
runuser -u stcr -- env HOME=/home/stcr PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  /opt/stcr-node/bin/npm --prefix "$release" run build
echo "NPM_PRUNE"
runuser -u stcr -- env HOME=/home/stcr PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  /opt/stcr-node/bin/npm --prefix "$release" prune --omit=dev

install -d -o root -g root -m 0700 "$frontend_backup"
cp -a /var/www/stcr/. "$frontend_backup/"
cp -a /etc/stcr/stcr.env "$env_backup"
chmod 0640 "$env_backup"

ln -sfn "$release" /opt/stcr/current
find /var/www/stcr -mindepth 1 -maxdepth 1 -exec rm -rf -- {{}} +
cp -a "$release/dist/." /var/www/stcr/
chown -R www-data:stcr /var/www/stcr
find /var/www/stcr -type d -exec chmod 0750 {{}} +
find /var/www/stcr -type f -exec chmod 0640 {{}} +

cp -a "$target_env" /etc/stcr/stcr.env
chown root:stcr /etc/stcr/stcr.env
chmod 0640 /etc/stcr/stcr.env
switched=1

runuser -u stcr -- env HOME=/home/stcr PM2_HOME=/home/stcr/.pm2 \
  PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  /usr/bin/pm2 restart stcr-api --update-env
runuser -u stcr -- env HOME=/home/stcr PM2_HOME=/home/stcr/.pm2 \
  PATH=/opt/stcr-node/bin:/usr/bin:/bin \
  /usr/bin/pm2 save

for attempt in {{1..30}}; do
  if curl -fsS http://127.0.0.1:3001/readyz; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:3001/readyz
test "$(readlink -f /opt/stcr/current)" = "$release"
test "$(grep '^STCR_OFFLINE_THRESHOLD_SECONDS=' /etc/stcr/stcr.env)" = \
  'STCR_OFFLINE_THRESHOLD_SECONDS=300'
test "$(grep '^STCR_ALLOWED_ORIGINS=' /etc/stcr/stcr.env)" = \
  'STCR_ALLOWED_ORIGINS=https://report.tytc-rubber.site'
test "$(grep '^STCR_FACTORY_MQTT_SENSOR_RANGES_JSON=' /etc/stcr/stcr.env)" = \
  "STCR_FACTORY_MQTT_SENSOR_RANGES_JSON='$sensor_ranges'"
test "$(grep '^STCR_FACTORY_MQTT_SPIKE_LIMITS_JSON=' /etc/stcr/stcr.env)" = \
  "STCR_FACTORY_MQTT_SPIKE_LIMITS_JSON='$spike_limits'"
test "$(grep -o '"pollIntervalMs":[[:space:]]*5000' /var/www/stcr/runtime-config.json)" = \
  '"pollIntervalMs":  5000'
trap - ERR
rm -f "$target_env"
echo
echo "DEPLOYED_SHA=$sha"
echo "PREVIOUS_RELEASE=$previous"
echo "FRONTEND_BACKUP=$frontend_backup"
echo "ENV_BACKUP=$env_backup"
"""
        quoted_script = remote_script.replace("'", "'\"'\"'")
        print("\n== Deploying release ==")
        run(
            client,
            f"sudo -S -p '' bash -lc '{quoted_script}'",
            password=password,
            timeout=1200,
        )
    finally:
        client.close()


if __name__ == "__main__":
    main()
