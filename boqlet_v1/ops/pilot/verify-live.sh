#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
state=/srv/boqlet/state
envfile=$state/pilot.env
umask 077
exec 9>"$state/config.lock"
flock -n 9
work=$(mktemp -d "$state/.verify.XXXXXX")
compose() { docker compose --env-file "$envfile" "$@"; }
username="pilot-smoke-$(openssl rand -hex 6)"
email="$username@example.invalid"
export SMOKE_PASSWORD
SMOKE_PASSWORD=$(openssl rand -hex 24)
update_identity() {
  docker exec -i -e SMOKE_PASSWORD boqlet-pilot-identity-1 /bin/bash -s -- "$username" "$email" "$1" <<'KEYCLOAK'
set -euo pipefail
username=$1 email=$2 action=$3
config=$(mktemp)
trap 'rm -f "$config"' EXIT
admin() { /opt/keycloak/bin/kcadm.sh "$@" --config "$config"; }
admin config credentials --server http://127.0.0.1:8080 --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"
if [ "$action" = create ]; then
  id=$(admin create users -r boqlet -i -s "username=$username" -s "email=$email" \
    -s firstName=Boqlet -s lastName=Smoke -s enabled=true -s emailVerified=true)
  admin set-password -r boqlet --userid "$id" --new-password "$SMOKE_PASSWORD"
else
  admin delete "users/$action" -r boqlet
  exit
fi
printf '%s\n' "$id"
KEYCLOAK
}

cleanup() {
  local result=$?
  if [ -f "$work/pilot.env" ]; then
    mv -f "$work/pilot.env" "$envfile"
    if ! compose up -d --no-deps api; then result=1; fi
  fi
  if [ -n "${user_id:-}" ]; then
    if ! update_identity "$user_id"; then result=1; fi
  fi
  rmdir "$work"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
fixture=../../fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc
user_id=$(update_identity create)
python3 check-live.py "$fixture" "$email" --denied
cp -p "$envfile" "$work/pilot.env"
python3 - "$envfile" "$email" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
lines = path.read_text().splitlines()
for index, line in enumerate(lines):
    if line.startswith("PILOT_EMAILS="):
        lines[index] = line + ("," if line != "PILOT_EMAILS=" else "") + sys.argv[2]
        break
else:
    lines.append("PILOT_EMAILS=" + sys.argv[2])
path.write_text("\n".join(lines) + "\n")
PY
compose up -d --no-deps api
for _ in {1..30}; do
  if sh check-private.sh >/dev/null 2>&1; then break; fi
  sleep 2
done
sh check-private.sh >/dev/null
python3 check-live.py "$fixture" "$email"
