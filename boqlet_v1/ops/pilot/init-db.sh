#!/bin/sh
set -eu
set -- --set=api_password="$BOQLET_DB_PASSWORD" --set=queue_password="$BOQLET_QUEUE_PASSWORD"
set -- "$@" --set=identity_password="$BOQLET_IDENTITY_DB_PASSWORD"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" "$@" <<'SQL'
CREATE ROLE boqlet_app LOGIN PASSWORD :'api_password';
CREATE ROLE boqlet_queue LOGIN PASSWORD :'queue_password';
CREATE ROLE boqlet_identity LOGIN PASSWORD :'identity_password';
CREATE DATABASE boqlet OWNER boqlet_app;
CREATE DATABASE boqlet_identity OWNER boqlet_identity;
REVOKE CONNECT ON DATABASE boqlet FROM PUBLIC;
REVOKE CONNECT ON DATABASE boqlet_identity FROM PUBLIC;
GRANT CONNECT ON DATABASE boqlet TO boqlet_queue;
\connect boqlet
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO boqlet_queue;
SQL
