#!/usr/bin/env bash
# Rollback compatibility (TF-186, nfr.md "Availability and recovery"): the current API migrates a fresh
# database, then the previous release's API must start on that schema (Flyway ignores the newer
# migrations) and answer. Used by CI (.github/workflows/ci.yml "rollback"); runs anywhere with Docker.
#   scripts/ci-rollback-check.sh <current image> <previous image>
set -euo pipefail
current=${1:?current API image}
previous=${2:?previous API image}
net=boqlet-rollback-$$
cleanup() { docker rm -f "$net-db" "$net-api" >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$net" >/dev/null
docker run -d --name "$net-db" --network "$net" -e POSTGRES_USER=boqlet -e POSTGRES_PASSWORD=rollback-only \
  -e POSTGRES_DB=boqlet postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$net-db" pg_isready -U boqlet -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done

# Starts an API image on the database and waits until it is ready; prints its migration lines.
start() {
  docker rm -f "$net-api" >/dev/null 2>&1 || true
  docker run -d --name "$net-api" --network "$net" -p 127.0.0.1::8080 \
    -e BOQLET_JDBC_URL="jdbc:postgresql://$net-db:5432/boqlet" -e BOQLET_DB_USER=boqlet -e BOQLET_DB_PASSWORD=rollback-only \
    -e BOQLET_NATIVE_AUTH=true -e BOQLET_SECURE_COOKIE=false -e BOQLET_APP_URL=http://localhost:3000 \
    -e BOQLET_INVITATION_SECRET=rollback-check-signing-secret-not-for-production \
    -e BOQLET_SMTP_HOST=localhost -e BOQLET_SMTP_PORT=1025 -e BOQLET_SMTP_AUTH=false -e BOQLET_SMTP_STARTTLS=false \
    -e BOQLET_SMTP_FROM=boqlet@example.test -e BOQLET_S3_BUCKET=boqlet-rollback -e BOQLET_S3_REGION=us-east-1 \
    -e BOQLET_S3_ENDPOINT=http://localhost:8333 -e BOQLET_ENGINE_TRANSPORT=http -e BOQLET_ENGINE_HTTP_URL=http://localhost:8788 \
    -e AWS_ACCESS_KEY_ID=rollback -e AWS_SECRET_ACCESS_KEY=rollback-only -e AWS_DEFAULT_REGION=us-east-1 \
    "$1" >/dev/null
  local port
  port=$(docker port "$net-api" 8080/tcp | head -1 | sed 's/.*://')
  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:$port/actuator/health/readiness" 2>/dev/null | grep -q '"UP"'; then
      curl -fsS "http://127.0.0.1:$port/api/v1/plans" >/dev/null
      docker logs "$net-api" 2>&1 | grep -E "DbValidate|DbMigrate" || true
      return 0
    fi
    if [[ "$(docker inspect -f '{{.State.Running}}' "$net-api")" != true ]]; then break; fi
    sleep 1
  done
  echo "the API image $1 did not become ready on this schema:" >&2
  docker logs "$net-api" 2>&1 | tail -60 >&2
  return 1
}

echo "== $current migrates the database"
start "$current"
echo "== $previous starts on the migrated schema"
start "$previous"
echo "rollback check passed: $previous runs on the schema of $current"
