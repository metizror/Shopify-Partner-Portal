#!/usr/bin/env bash
# Production deploy, run on the app server by the GitHub webhook listener.
#
# Point the webhook handler at this one script instead of open-coding the steps:
#   cd /var/www/shopify-dashboard && git pull && bash scripts/deploy.sh
# (or just `bash scripts/deploy.sh` — it pulls by itself).
#
# The whole reason this exists is the migrate step: schema changes have to land
# on the DB *before* the new code starts serving, otherwise a route deploys
# ahead of the columns it needs and 500s until someone runs prisma by hand.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/shopify-dashboard}"
APP_PORT="${APP_PORT:-3011}"
ECOSYSTEM="${ECOSYSTEM:-/opt/shopify-dashboard/ecosystem.config.js}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"

echo "▶ pulling $BRANCH"
git fetch --prune origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "▶ installing dependencies"
# Full install, devDependencies included. `postinstall` runs `prisma generate`
# and the prisma CLI is a devDependency, so --omit=dev fails outright.
npm ci

echo "▶ applying migrations"
# Make sure DATABASE_URL is in the environment before the prisma CLI runs —
# this box keeps its secrets in .env, but .env.local wins if it exists (that is
# the order Next.js itself uses). dotenv does not override already-set vars.
for f in "$APP_DIR/.env" "$APP_DIR/.env.local"; do
  [ -f "$f" ] && { set -a; . "$f"; set +a; }
done
npx prisma migrate deploy

echo "▶ building"
# 2 cores and no spare swap on this box — cap the heap so a build can't drag
# the other containers down with it.
NODE_OPTIONS=--max-old-space-size=2048 npm run build

echo "▶ restarting"
# startOrReload is idempotent: starts if absent, reloads if present, and can't
# create the duplicate pm2 entries that accumulated on the other app.
pm2 startOrReload "$ECOSYSTEM" --update-env
pm2 save

echo "▶ verifying"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$APP_PORT" >/dev/null 2>&1; then
    echo "✔ deploy complete — serving on :$APP_PORT"
    exit 0
  fi
  sleep 2
done

echo "✖ app did not respond on :$APP_PORT after 60s — check: pm2 logs" >&2
exit 1
