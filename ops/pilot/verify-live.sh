#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
email="pilot-smoke-$(openssl rand -hex 8)@example.invalid"
cleanup() {
  docker exec -i boqlet-pilot-db-1 psql -XqAt -v ON_ERROR_STOP=1 -U boqlet_admin -d boqlet --set=email="$email" <<'SQL'
BEGIN;
DELETE FROM native_setup_links WHERE email = :'email';
UPDATE sessions SET status = 'ended', ended_at = now()
WHERE status = 'active' AND user_id IN (SELECT id FROM users WHERE email = :'email');
DELETE FROM native_credentials WHERE user_id IN (SELECT id FROM users WHERE email = :'email');
UPDATE users SET deleted_at = now() WHERE email = :'email';
COMMIT;
SQL
}
trap cleanup EXIT
setup_url=$(bash issue-setup-link.sh "$email")
export SETUP_TOKEN=${setup_url##*token=}
export SMOKE_PASSWORD
SMOKE_PASSWORD=$(openssl rand -hex 24)
python3 check-live.py ../../fixtures/ifc/Ifc2x3_Duplex_Architecture.ifc "$email"
