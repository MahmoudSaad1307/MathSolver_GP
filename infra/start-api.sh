#!/bin/sh
set -e

export API_PORT="${API_PORT:-${PORT:-4000}}"
export PORT="${API_PORT}"

cd /app/apps/api

if [ "${SKIP_PRISMA_MIGRATE:-false}" != "true" ]; then
  npx prisma migrate deploy
fi

if [ "${RUN_WORKER_WITH_API:-false}" = "true" ]; then
  node dist/worker.js &
fi

exec node dist/server.js
