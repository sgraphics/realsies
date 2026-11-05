#!/usr/bin/env bash
# Server-side deploy: pull, build, restart. Run as root on the server.
# Secrets live outside git: /opt/realsies/.env and /opt/realsies/relay/.secrets/testnet.json.
set -euo pipefail
APP=/opt/realsies
id realsies >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin realsies
if [ ! -d "$APP/.git" ]; then
  git clone https://github.com/sgraphics/realsies.git "$APP"
fi
git config --global --add safe.directory "$APP" || true
cd "$APP"
git fetch --quiet origin
git checkout --quiet main
git pull --ff-only --quiet origin main
mkdir -p relay/data
for pkg in art web relay; do
  echo "== $pkg: install"
  (cd "$pkg" && npm ci --no-audit --no-fund --loglevel=error)
done
echo "== web: build"
(cd web && npm run build --silent)
echo "== relay: build"
(cd relay && npm run build --silent)
chown -R realsies:realsies "$APP"
chmod 600 "$APP/.env" relay/.secrets/*.json 2>/dev/null || true
install -m 644 deploy/realsies.service /etc/systemd/system/realsies.service
systemctl daemon-reload
systemctl enable --quiet realsies
systemctl restart realsies
sleep 3
systemctl --no-pager --lines=5 status realsies | head -12
curl -s -m 5 -o /dev/null -w "local /api/config -> %{http_code}\n" http://127.0.0.1:3960/api/config
