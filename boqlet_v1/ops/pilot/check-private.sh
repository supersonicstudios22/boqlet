#!/bin/sh
set -eu
service_ip() {
  docker inspect "boqlet-pilot-$1-1" | jq -er '.[0].NetworkSettings.Networks["boqlet-pilot-ingress"].IPAddress'
}
curl -fsS --max-time 5 "http://$(service_ip api):8080/actuator/health/readiness" | jq -e '.status == "UP"'
curl -fsS --max-time 5 "http://$(service_ip web):3000/" -o /dev/null
curl -fsS --max-time 5 "http://$(service_ip identity):8080/realms/boqlet/.well-known/openid-configuration" | jq -e '.issuer == "https://auth.booqlet.com/realms/boqlet"'
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
