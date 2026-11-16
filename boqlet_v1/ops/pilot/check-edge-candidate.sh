#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
temp=$(mktemp -d /srv/boqlet/.edge-check.XXXXXX)
candidate=boqlet-edge-check-${temp##*.}
trap 'result=$?; if [ "$result" -ne 0 ]; then docker logs "$candidate" >&2 || true; fi; docker rm -f "$candidate" >/dev/null 2>&1 || true; rm -f "$temp/routes.yaml"; rmdir "$temp"' EXIT
image=$(docker inspect -f '{{.Image}}' narudzbe-pilot-proxy-1)
python3 merge-routes.py /srv/narudzbe/release/proxy-routes.json traefik-routes.json |
  jq 'del(.http.routers[].tls)' > "$temp/routes.yaml"
chmod 0444 "$temp/routes.yaml"
docker run -d --name "$candidate" --network boqlet-pilot-ingress --user 10001:10001 \
  --cap-drop ALL --security-opt no-new-privileges --memory 192m \
  --mount "type=bind,source=$temp/routes.yaml,target=/etc/traefik/boqlet-candidate.yaml,readonly" \
  "$image" --entryPoints.websecure.address=:8443 --providers.file.filename=/etc/traefik/boqlet-candidate.yaml \
  --providers.file.watch=false --global.checkNewVersion=false --log.level=INFO >/dev/null
address=$(docker inspect "$candidate" | jq -er '.[0].NetworkSettings.Networks["boqlet-pilot-ingress"].IPAddress')
probe() {
  printf 'Probing %s%s\n' "$1" "$2" >&2
  curl -fsS --retry 3 --retry-all-errors --max-time 5 -H "Host: $1" "http://$address:8443$2"
}
probe booqlet.com / >/dev/null
probe auth.booqlet.com /realms/boqlet/.well-known/openid-configuration |
  jq -e '.issuer == "https://auth.booqlet.com/realms/boqlet"'
code() {
  curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -H "Host: $1" "http://$address:8443$2"
}
test "$(code booqlet.com /api/v1/me)" = 401
test "$(code auth.booqlet.com /admin/)" = 404
test "$(code files.booqlet.com /boqlet-pilot/test)" = 404
if docker logs "$candidate" 2>&1 | grep -iE 'Cannot start the provider|error while'; then exit 1; fi
printf '%s\n' 'Candidate route probes passed.'
