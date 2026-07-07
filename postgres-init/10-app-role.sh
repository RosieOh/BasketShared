#!/bin/bash
# Runs once during Postgres initialization (as the superuser). Creates the
# uuid-ossp extension and a NON-SUPERUSER application role. The app connects as
# this role so Row-Level Security actually applies (superusers bypass RLS).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  DO \$\$ BEGIN
    CREATE ROLE syncbridge_app LOGIN PASSWORD '$POSTGRES_PASSWORD' NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END \$\$;

  GRANT ALL ON SCHEMA public TO syncbridge_app;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO syncbridge_app;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO syncbridge_app;
EOSQL

echo "app role 'syncbridge_app' ready"
