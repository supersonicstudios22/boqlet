#!/bin/bash
# Restore check (BE-025): restores the newest database dump of backup.sh into a scratch database on
# the pilot's Postgres, compares every table's row count with the live database, and drops it.
# The live data is only read. Weekly in v1 (deployment.md); the automated version of this check
# runs in CI on the local stack (services/api BackupRestoreTest).
set -euo pipefail
state=/srv/boqlet/state
ops=/srv/boqlet/current/ops/pilot
envfile=$state/pilot.env
target=${BACKUP_DIR:-/srv/boqlet/backups}
dump=$(ls -1t "$target"/boqlet-*.dump | head -1)
cd "$ops"
release=$(sed -n 's/^PILOT_RELEASE=//p' "$envfile")
compose() { PILOT_RELEASE="$release" docker compose --env-file "$envfile" "$@"; }
psql() { compose exec -T db psql -U boqlet_admin -v ON_ERROR_STOP=1 -At "$@"; }

psql -d boqlet_admin -c "DROP DATABASE IF EXISTS boqlet_restore_check" -c "CREATE DATABASE boqlet_restore_check OWNER boqlet_app"
trap 'psql -d boqlet_admin -c "DROP DATABASE IF EXISTS boqlet_restore_check" >/dev/null' EXIT
compose exec -T db pg_restore -U boqlet_admin --exit-on-error -d boqlet_restore_check < "$dump"
counts() {
  psql -d "$1" -c "SELECT string_agg(format('%s=%s', table_name, (xpath('/row/c/text()',
      query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text), ' ' ORDER BY table_name)
    FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
}
live=$(counts boqlet)
restored=$(counts boqlet_restore_check)
echo "dump: $dump"
if [[ "$live" == "$restored" ]]; then
  echo "restore check passed: every table has the same row count"
else
  # Rows written since the dump differ; list them for a person to judge.
  diff <(tr ' ' '\n' <<<"$live") <(tr ' ' '\n' <<<"$restored") || true
  echo "restore check: counts differ (rows written since the dump are expected to)"
fi
