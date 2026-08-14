#!/usr/bin/env bash
# Pings the dashboard's install/uninstall poller. Meant to be run every few
# minutes from cron, since the app has no internal scheduler of its own. Reads
# DASHBOARD_PASSWORD from the project's .env so the secret never lives in the
# crontab. Token-based: no cookie, no per-app code.
#
# Defaults to the checkout this script lives in and a dashboard on localhost;
# override either from the crontab if yours differ:
#
#   */5 * * * * PROJECT_DIR=/var/www/shopify-dashboard \
#     DASHBOARD_URL=https://dashboard.example.com \
#     /var/www/shopify-dashboard/scripts/poll-events.sh >> /var/log/poll.log 2>&1
set -euo pipefail

# The parent of scripts/ — so the script works from any working directory
# without anyone editing a path into it.
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"
URL="${DASHBOARD_URL%/}/api/cron/poll-events"

if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "No .env at $PROJECT_DIR/.env — set PROJECT_DIR to your checkout." >&2
  exit 1
fi

# Load DASHBOARD_PASSWORD from .env (strip surrounding quotes/whitespace).
PW=$(grep -E '^\s*DASHBOARD_PASSWORD\s*=' "$PROJECT_DIR/.env" | head -1 \
       | sed -E 's/^[^=]+=\s*//; s/^["'"'"']//; s/["'"'"']\s*$//')

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RESP=$(curl -s --max-time 60 -X POST "$URL" -H "x-dashboard-password: $PW" || echo '{"ok":false,"error":"curl_failed"}')
echo "$TS $RESP"
