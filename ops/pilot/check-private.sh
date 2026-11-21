#!/bin/sh
set -eu
aliases() {
  containers=$(docker ps -q --filter "label=com.docker.compose.project=$1")
  test -n "$containers"
  docker inspect $containers | jq -r --arg network "$2" '
    .[] | .NetworkSettings.Networks[$network].Aliases[]?
  ' | sort -u
}
narudzbe_aliases=$(aliases narudzbe-pilot narudzbe-pilot_application)
boqlet_aliases=$(aliases boqlet-pilot boqlet-pilot-ingress)
shared_aliases=$(printf '%s\n%s\n' "$narudzbe_aliases" "$boqlet_aliases" | sort | uniq -d)
if [ -n "$shared_aliases" ]; then
  printf 'Overlapping Docker aliases on edge networks:\n%s\n' "$shared_aliases" >&2
  exit 1
fi

service_ip() {
  docker inspect "boqlet-pilot-$1-1" | jq -er '.[0].NetworkSettings.Networks["boqlet-pilot-ingress"].IPAddress'
}
curl -fsS --max-time 5 "http://$(service_ip api):8080/actuator/health/readiness" | jq -e '.status == "UP"'
curl -fsS --max-time 5 "http://$(service_ip boqlet-web):3000/" -o /dev/null
docker exec -i boqlet-pilot-db-1 psql -v ON_ERROR_STOP=1 -U boqlet_admin -d boqlet <<'SQL'
DO $$
BEGIN
  IF NOT has_function_privilege('boqlet_queue', 'public.queue_claim(uuid,text,text[])', 'EXECUTE')
    OR has_table_privilege('boqlet_queue', 'public.flyway_schema_history', 'SELECT')
    OR has_database_privilege('boqlet_queue', 'boqlet_identity', 'CONNECT')
  THEN RAISE EXCEPTION 'Unexpected queue grants';
  END IF;
END $$;
SQL
docker inspect boqlet-pilot-queue-1 | jq -e '
  .[0] | .State.Running and (.HostConfig.Memory > 0) and (.HostConfig.NanoCpus > 0) and
  (.Config.Env | map(select(startswith("ENGINE_QUEUE_CONCURRENCY="))) | length == 1)
'
docker inspect boqlet-pilot-queue-1 | jq -r '
  .[0] | .HostConfig | {memoryBytes: .Memory, cpus: (.NanoCpus / 1000000000), pidLimit: .PidsLimit}
'
docker inspect boqlet-pilot-queue-1 | jq -r '.[0].Config.Env[] | select(startswith("ENGINE_QUEUE_CONCURRENCY="))'
