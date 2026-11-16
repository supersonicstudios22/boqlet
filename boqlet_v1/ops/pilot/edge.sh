#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
edge=/srv/boqlet/edge
proxy=narudzbe-pilot-proxy-1
rollback=boqlet-edge-rollback

compose_proxy() {
  local files f
  local -a args=()
  read -r files < "$edge/narudzbe-compose-baseline.txt"
  IFS=, read -ra files <<< "$files"
  for f in "${files[@]}"; do args+=(-f "$f"); done
  docker compose -p narudzbe-pilot --profile public "${args[@]}" "$@"
}

case "${1:-}" in
  prepare)
    umask 077
    install -d -m 0700 "$edge"
    if [ -e "$edge/narudzbe-compose-baseline.txt" ]; then
      printf '%s\n' 'Existing checkpoint requires reconciliation.' >&2
      exit 1
    fi
    docker inspect "$proxy" | jq -er '.[0] | select(.State.Running) | .Config.Labels["com.docker.compose.project.config_files"]' > "$edge/narudzbe-compose-baseline.txt"
    grep -q '^/srv/narudzbe/release/compose.json' "$edge/narudzbe-compose-baseline.txt"
    docker inspect "$proxy" | jq -er '.[0].NetworkSettings.Networks["narudzbe-pilot_proxy-egress"].IPAddress == "172.22.0.2"' >/dev/null
    python3 merge-routes.py /srv/narudzbe/release/proxy-routes.json traefik-routes.json > "$edge/routes.json"
    chmod 0444 "$edge/routes.json"
    install -m 0444 narudzbe-edge.compose.yaml "$edge/compose.yaml"
    compose_proxy config --quiet
    compose_proxy -f "$edge/compose.yaml" config --format json | jq -e '
      (.services.proxy.networks["proxy-egress"].gw_priority == 1) and
      (.services.proxy.networks | has("boqlet-ingress")) and
      ([.services.proxy.volumes[] | select(.target == "/etc/traefik/routes.json")] ==
       [{"type":"bind","source":"/srv/boqlet/edge/routes.json","target":"/etc/traefik/routes.json","read_only":true,"bind":{"create_host_path":false}}])
    ' >/dev/null
    systemd-run --unit="$rollback" --on-active=4min /bin/bash "$PWD/edge.sh" rollback
    systemctl is-active "$rollback.timer"
    ;;
  apply)
    systemctl is-active --quiet "$rollback.timer"
    compose_proxy -f "$edge/compose.yaml" up --detach --no-deps --pull never proxy
    ;;
  confirm)
    systemctl is-active --quiet "$rollback.timer"
    docker inspect "$proxy" | jq -e '.[0] | .State.Running and (.NetworkSettings.Networks | has("boqlet-pilot-ingress"))' >/dev/null
    python3 check-public-edge.py
    systemctl stop "$rollback.timer"
    ;;
  rollback)
    compose_proxy up --detach --no-deps --pull never proxy
    ;;
  *)
    printf '%s\n' 'Usage: edge.sh prepare|apply|confirm|rollback' >&2
    exit 2
    ;;
esac
