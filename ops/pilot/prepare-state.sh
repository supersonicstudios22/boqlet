#!/bin/sh
set -eu
release=${1:?Usage: sh prepare-state.sh RELEASE}
case "$release" in *[!0-9a-f]*|'') exit 2 ;; esac
cd "$(dirname "$0")"
state=/srv/boqlet/state
umask 077
install -d -m 0700 "$state"
if [ ! -f "$state/boqlet-realm.json" ]; then
  install -m 0444 boqlet-realm.json "$state/boqlet-realm.json"
fi
if [ -e "$state/pilot.env" ]; then
  printf '%s\n' 'Existing pilot.env preserved.'
  exit 0
fi
temp=$(mktemp "$state/.pilot.XXXXXX")
trap 'rm -f "$temp"' EXIT HUP INT TERM
{
  printf 'PILOT_RELEASE=%s\nPILOT_STATE_DIR=%s\n' "$release" "$state"
  for key in DB_ADMIN_PASSWORD DB_PASSWORD QUEUE_PASSWORD IDENTITY_DB_PASSWORD IDENTITY_ADMIN_PASSWORD INVITATION_SECRET STORAGE_SECRET_KEY WORKER_TOKEN; do
    printf '%s=%s\n' "$key" "$(openssl rand -hex 32)"
  done
  printf 'STORAGE_ACCESS_KEY=boqlet_%s\n' "$(openssl rand -hex 8)"
  cat <<'EOF'
PILOT_EMAILS=
ENGINE_QUEUE_CONCURRENCY=1
ENGINE_QUEUE_POOL=default
ENGINE_QUEUE_MEMORY=4g
ENGINE_QUEUE_CPUS=2
ENGINE_QUEUE_JOB_TIMEOUT_SECONDS=1800
ENGINE_HTTP_CONCURRENCY=1
ENGINE_HTTP_MEMORY=1536m
ENGINE_HTTP_CPUS=1
MAX_UPLOAD_MIB=512
EOF
} > "$temp"
ln "$temp" "$state/pilot.env"
