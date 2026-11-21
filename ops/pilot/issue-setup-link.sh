#!/bin/bash
set -euo pipefail
email=${1,,}
purpose=${2:-setup}
[[ "$email" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ && ${#email} -le 254 ]]
[[ "$purpose" == setup || "$purpose" == reset ]]
token=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
digest=$(printf '%s' "$token" | openssl dgst -sha256 -r | cut -d' ' -f1)
issued=$(docker exec -i boqlet-pilot-db-1 psql -XqAt -v ON_ERROR_STOP=1 -U boqlet_admin -d boqlet \
  --set=email="$email" --set=purpose="$purpose" --set=digest="$digest" <<'SQL'
INSERT INTO native_setup_links (email, token_hash, expires_at, purpose)
SELECT :'email', :'digest', now() + interval '1 hour', :'purpose'
WHERE (:'purpose' = 'setup' AND NOT EXISTS (SELECT FROM users WHERE lower(email) = :'email'))
   OR (:'purpose' = 'reset' AND EXISTS (
         SELECT FROM native_credentials c JOIN users u ON u.id = c.user_id
         WHERE lower(u.email) = :'email' AND u.deleted_at IS NULL))
ON CONFLICT (email) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, purpose = excluded.purpose
RETURNING 1;
SQL
)
if [ "$issued" != 1 ]; then
  printf 'This address is ineligible for the requested link.\n' >&2
  exit 1
fi
printf 'https://booqlet.com/sign-up?token=%s\n' "$token"
