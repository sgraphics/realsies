#!/usr/bin/env bash
# Publish the rendered promo clips to https://realsies.lol/trailer/clips/ : one page with a player and a
# Download button per clip, for saving them on a phone (static files next to the trailer, not in git).
# Usage, from the repo root:  deploy/publish-clips.sh
# Render them first (cd trailer && npm run render -- <variant>). Links carry a content-hash version, so a
# re-render never comes back stale from a browser or Cloudflare cache; the page itself is no-cache.
set -euo pipefail
HOST=root@realsies-server
DIR=/var/www/realsies/trailer/clips
# variant | video file | title
CLIPS=(
  "how-you-win|realsies-how-you-win.mp4|How you win (scoring)"
  "plug-in|realsies-plug-in.mp4|Plug in (AI builders)"
  "for-realsies|realsies-trailer.mp4|Trailer: For realsies?"
)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
items=""
files=()
for c in "${CLIPS[@]}"; do
  IFS='|' read -r variant video title <<<"$c"
  src=trailer/out/$variant
  [ -f "$src/$video" ] || { echo "skip $variant: no $src/$video (render it first)" >&2; continue; }
  v=$(sha256sum "$src/$video" | cut -c1-10)
  mb=$(du -k "$src/$video" | awk '{printf "%.1f", $1/1024}')
  cp "$src/$video" "$TMP/$video"
  cp "$src/poster.png" "$TMP/$variant-poster.png"
  files+=("$TMP/$video" "$TMP/$variant-poster.png")
  items+="<section><h2>$title</h2><video controls playsinline preload=\"metadata\" poster=\"$variant-poster.png?v=$v\" src=\"$video?v=$v\"></video>"
  items+="<a class=\"dl\" href=\"$video?v=$v\" download=\"$video\">Download ($mb MB)</a></section>"
done
[ ${#files[@]} -gt 0 ] || { echo "nothing to publish" >&2; exit 1; }
cat >"$TMP/index.html" <<EOF
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Realsies clips</title>
<style>
body{margin:0;background:#181425;color:#ead4aa;font:16px/1.4 system-ui,sans-serif;padding:16px;max-width:720px;margin:auto}
h1{font-size:22px;color:#feae34}h2{font-size:17px;margin:24px 0 8px}
video{width:100%;border-radius:8px;background:#000}
.dl{display:block;margin-top:10px;padding:14px;text-align:center;background:#feae34;color:#181425;font-weight:700;border-radius:8px;text-decoration:none}
p{color:#8b9bb4;font-size:14px}
</style></head><body>
<h1>Realsies clips</h1>
<p>Tap Download. On iPhone, if the video opens instead: tap the share icon, then Save Video. On Android: long-press the video or the button, then Download.</p>
$items
</body></html>
EOF
ssh -o BatchMode=yes "$HOST" "mkdir -p $DIR"
scp -q -o BatchMode=yes "$TMP/index.html" "${files[@]}" "$HOST:$DIR/"
ssh -o BatchMode=yes "$HOST" "chmod 644 $DIR/*"
curl -s -o /dev/null -w "https://realsies.lol/trailer/clips/ -> %{http_code}\n" https://realsies.lol/trailer/clips/
