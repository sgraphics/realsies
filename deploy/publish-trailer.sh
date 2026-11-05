#!/usr/bin/env bash
# Publish the rendered trailer to https://realsies.lol/trailer (static files served by nginx, not in git).
# Run from the repo root after `npm run trailer` in art/.
set -euo pipefail
T=.bl0x/topics/near-hackathon/trailer
ssh -o BatchMode=yes root@realsies-server 'mkdir -p /var/www/realsies/trailer'
scp -q -o BatchMode=yes deploy/trailer/index.html "$T/realsies-trailer.mp4" "$T/poster.png" root@realsies-server:/var/www/realsies/trailer/
ssh -o BatchMode=yes root@realsies-server 'chmod 644 /var/www/realsies/trailer/*'
curl -s -o /dev/null -w "https://realsies.lol/trailer -> %{http_code}\n" https://realsies.lol/trailer
