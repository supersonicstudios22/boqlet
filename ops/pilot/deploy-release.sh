#!/bin/bash
# Install root-owned and use as an SSH authorized_keys forced command.
set -euo pipefail
umask 077
state=/srv/boqlet/state
ops=/srv/boqlet/current/ops/pilot
envfile=$state/pilot.env
if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([a-f0-9]{40})$ ]]; then
  revision=${BASH_REMATCH[1]}
  incoming=1
elif [[ $# = 2 && "$1" = --local && "$2" =~ ^[a-f0-9]{40}$ && -z "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  revision=$2
  incoming=0
else
  exit 2
fi
cd "$ops"
exec 9>"$state/config.lock"
flock -w 120 9
previous=$(sed -n 's/^PILOT_RELEASE=//p' "$envfile")
[[ "$previous" =~ ^[a-f0-9]{7,40}$ ]]
if [[ "$revision" == "$previous" ]]; then
  printf 'Revision %s is already deployed.\n' "$revision"
  exit
fi
work=$(mktemp -d "$state/.release.XXXXXX")
trap 'rm -f "$work/images.tar.gz" "$work/pilot.env"; rmdir "$work"' EXIT
images=("boqlet-web:$revision" "boqlet-api:$revision" "boqlet-engine:$revision")
if (( incoming )); then
  # A 3 GiB input cap prevents one transfer from filling the shared host.
  head -c 3221225473 > "$work/images.tar.gz"
  test "$(stat -c %s "$work/images.tar.gz")" -le 3221225472
  python3 - "$work/images.tar.gz" "${images[@]}" <<'PY'
import json, sys, tarfile
with tarfile.open(sys.argv[1], "r:gz") as archive:
    manifest = archive.extractfile("manifest.json")
    tags = [tag for image in json.load(manifest) for tag in image["RepoTags"]]
    if sorted(tags) != sorted(sys.argv[2:]):
        raise SystemExit("Bundle must contain exactly the three expected release tags")
PY
  docker load --input "$work/images.tar.gz"
fi
docker image inspect "${images[@]}" >/dev/null
compose() {
  PILOT_RELEASE="$1" docker compose --env-file "$envfile" "${@:2}"
}
verify() {
  for _ in {1..30}; do
    if sh check-private.sh >/dev/null 2>&1; then
      python3 check-public-edge.py && return
    fi
    sleep 2
  done
  return 1
}
services=(api boqlet-web engine queue)
# The runs-and-previews slot (P54, TF-180) is recreated too once the trusted Compose file defines it.
if compose "$revision" config --services | grep -qx queue-interactive; then
  services+=(queue-interactive)
fi
if compose "$revision" up -d --no-deps --pull never "${services[@]}" && verify; then
  sed "s/^PILOT_RELEASE=.*/PILOT_RELEASE=$revision/" "$envfile" > "$work/pilot.env"
  mv -f "$work/pilot.env" "$envfile"
  printf 'Boqlet %s deployed.\n' "$revision"
else
  printf 'Verification failed. Restoring the preceding Boqlet images.\n' >&2
  compose "$previous" up -d --no-deps --pull never "${services[@]}"
  exit 1
fi
