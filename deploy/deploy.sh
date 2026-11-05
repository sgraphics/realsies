#!/usr/bin/env bash
# Server-side deploy: pull, build, restart. Run as root on the server.
# Secrets live outside git: /opt/realsies/.env and /opt/realsies/relay/.secrets/testnet.json.
# While the GitHub repo is private the server cannot pull: push from a dev machine instead,
#   git push root@<server>:/opt/realsies main:refs/heads/incoming
#   ssh root@<server> 'cd /opt/realsies && NO_PULL=1 bash deploy/deploy.sh'
# and NO_PULL=1 fast-forwards main to the pushed branch.
set -euo pipefail
APP=/opt/realsies
id realsies >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin realsies
if [ ! -d "$APP/.git" ]; then
  git clone https://github.com/sgraphics/realsies.git "$APP"
fi
git config --global --add safe.directory "$APP" || true
cd "$APP"
git checkout --quiet main
if [ "${NO_PULL:-}" = 1 ]; then
  git merge --ff-only --quiet incoming
else
  git fetch --quiet origin
  git pull --ff-only --quiet origin main
fi
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
# operator emails: the relay drops files in the spool, a root-only unit sends them through SES (deploy/realsies-mail.py)
install -d -o root -g realsies -m 1730 /var/spool/realsies-mail
install -d -o root -g root -m 700 /var/spool/realsies-mail/sent /var/spool/realsies-mail/failed
install -m 644 deploy/realsies-mail.path deploy/realsies-mail.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --quiet realsies
systemctl enable --quiet --now realsies-mail.path
systemctl restart realsies
sleep 3
systemctl --no-pager --lines=5 status realsies | head -12
curl -s -m 5 -o /dev/null -w "local /api/config -> %{http_code}\n" http://127.0.0.1:3960/api/config
