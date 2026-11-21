#!/bin/bash
# Backup of the pilot (BE-025, deployment.md "Backups and recovery", docs/operations/pilot.md). Run on the host as
# root, e.g. hourly from a systemd timer (RPO 1 h); it is not installed by the deploy.
#   - Postgres: `pg_dump -Fc` of the boqlet database (the same command as the restore test,
#     services/api BackupRestoreTest), plus the roles (`pg_dumpall --roles-only`).
#   - Object storage: a tar of the SeaweedFS volume. Crash-consistent only: uploads are written
#     once and parse artifacts can be recomputed from them.
#   - Keeps BACKUP_KEEP_DAYS (default 14) days. With BACKUP_REMOTE set (an rclone remote, e.g.
#     `offsite:boqlet`), each new file is also copied off the host; without it, backups stay on the
#     host, which is not yet an off-host backup (docs/product/known-limitations.md).
# Check a dump with restore-check.sh.
set -euo pipefail
umask 077
state=/srv/boqlet/state
ops=/srv/boqlet/current/ops/pilot
envfile=$state/pilot.env
target=${BACKUP_DIR:-/srv/boqlet/backups}
keep=${BACKUP_KEEP_DAYS:-14}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$target"
cd "$ops"
release=$(sed -n 's/^PILOT_RELEASE=//p' "$envfile")
compose() { PILOT_RELEASE="$release" docker compose --env-file "$envfile" "$@"; }

compose exec -T db pg_dump -U boqlet_admin -Fc boqlet > "$target/boqlet-$stamp.dump.part"
mv "$target/boqlet-$stamp.dump.part" "$target/boqlet-$stamp.dump"
compose exec -T db pg_dumpall -U boqlet_admin --roles-only > "$target/roles-$stamp.sql"
volume=$(docker volume ls --format '{{.Name}}' | grep -E '(^|_)objects$' | head -1)
docker run --rm -v "$volume:/data:ro" -v "$target:/out" alpine:3.20 \
  tar czf "/out/objects-$stamp.tgz.part" -C /data .
mv "$target/objects-$stamp.tgz.part" "$target/objects-$stamp.tgz"

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  for file in "boqlet-$stamp.dump" "roles-$stamp.sql" "objects-$stamp.tgz"; do
    rclone copyto "$target/$file" "$BACKUP_REMOTE/$file"
  done
fi
find "$target" -maxdepth 1 -type f \( -name 'boqlet-*.dump' -o -name 'roles-*.sql' -o -name 'objects-*.tgz' \) \
  -mtime "+$keep" -delete
echo "backup $stamp: $(du -h "$target/boqlet-$stamp.dump" | cut -f1) database, $(du -h "$target/objects-$stamp.tgz" | cut -f1) objects"
