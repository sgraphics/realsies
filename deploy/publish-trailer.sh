#!/usr/bin/env bash
# Publish the rendered trailer to https://realsies.lol/trailer (static files served by nginx, not in git).
# Run from the repo root after `npm run trailer` in art/. The page links the video and poster with a
# content-hash version so browsers and Cloudflare never show a stale render; the page itself is no-cache.
set -euo pipefail
T=.bl0x/topics/near-hackathon/trailer
V=$(sha256sum "$T/realsies-trailer.mp4" | cut -c1-10)
P=$(sha256sum "$T/poster.png" | cut -c1-10)
TMP=$(mktemp -d)
sed -e "s#/trailer/realsies-trailer.mp4#/trailer/realsies-trailer.mp4?v=$V#g" \
    -e "s#/trailer/poster.png#/trailer/poster.png?v=$P#g" deploy/trailer/index.html > "$TMP/index.html"
ssh -o BatchMode=yes root@realsies-server 'mkdir -p /var/www/realsies/trailer'
scp -q -o BatchMode=yes "$TMP/index.html" "$T/realsies-trailer.mp4" "$T/poster.png" root@realsies-server:/var/www/realsies/trailer/
ssh -o BatchMode=yes root@realsies-server 'chmod 644 /var/www/realsies/trailer/*'
rm -rf "$TMP"
curl -s -o /dev/null -w "https://realsies.lol/trailer -> %{http_code} (video v=$V)\n" https://realsies.lol/trailer
