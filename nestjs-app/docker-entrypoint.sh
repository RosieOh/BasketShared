#!/bin/sh
# Run pending TypeORM migrations against the compiled DataSource, then start
# whatever command was passed (CMD). Migrations are idempotent and safe to run
# on every boot; the orchestrator will not start if the schema can't be applied.
set -e

echo "[entrypoint] Running database migrations..."
node ./node_modules/typeorm/cli.js -d dist/database/data-source.js migration:run

echo "[entrypoint] Migrations complete. Starting application..."
exec "$@"
