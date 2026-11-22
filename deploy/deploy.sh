#!/usr/bin/env bash
# Runs ON THE SERVER (called by GitHub Actions over SSH).
# Updates the app to a commit, restarts it, checks it is healthy, and rolls
# back to the previous version automatically if it is not.
#   usage: deploy.sh [commit-sha]   (default: latest origin/main)
set -euo pipefail

APP_DIR=/opt/pos/app
ENV_FILE=/opt/pos/.env
SERVICE=pos
TARGET="${1:-origin/main}"

cd "$APP_DIR"
PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2 | tr -d '[:space:]')"
PORT="${PORT:-3100}"
PREV="$(git rev-parse HEAD)"

install_and_restart() {
  npm ci --omit=dev --no-audit --no-fund --loglevel=error
  sudo /usr/bin/systemctl restart "$SERVICE"
}

healthy() {
  for _ in $(seq 1 30); do
    if curl -fs "http://127.0.0.1:${PORT}/readyz" > /dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

echo "==> Fetching ${TARGET}"
git fetch --quiet origin main
git -c advice.detachedHead=false checkout --quiet --force "$TARGET"

echo "==> Installing and restarting (was ${PREV:0:7})"
install_and_restart

if healthy; then
  echo "==> Deployed $(git rev-parse --short HEAD) — healthy on port ${PORT}"
  exit 0
fi

echo "!! New version failed its health check. Rolling back to ${PREV:0:7}" >&2
sudo /usr/bin/journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
git -c advice.detachedHead=false checkout --quiet --force "$PREV"
install_and_restart
healthy && echo "==> Rolled back to ${PREV:0:7}" >&2
exit 1
