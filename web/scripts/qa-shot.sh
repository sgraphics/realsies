#!/bin/bash
# QA screenshots without a browser driver: Chrome's own --headless --screenshot --window-size
# against the local build (web/dist, served by scripts/qa-serve.mjs) in mock mode.
# Headless Chrome on Windows will not make a window narrower than 500 px and takes its frame off
# the viewport, so the page is shown through /__qa/frame.html: an iframe of exactly W x H CSS px
# (its own viewport, media queries and devicePixelRatio). The shot is then cropped to W x H.
# Pages with ?qa= mirror the world canvas into an <img> (headless does not always composite canvases).
#
# usage: scripts/qa-shot.sh <out.png> <WxH> <dpr> "<query or /path?query>" [virtual-ms]
#   e.g. scripts/qa-shot.sh qa-out/chat/390x844-dpr3.png 390x844 3 "mock=1&as=ana&qa=chat&long=1" 12000
#        scripts/qa-shot.sh qa-out/agents/390x844-dpr3.png 390x844 3 "/agents?mock=1&qa=top" 7000
CHROME="${CHROME:-C:/Program Files/Google/Chrome/Application/chrome.exe}"
PORT="${QA_PORT:-5173}"
out=$1; size=$2; dpr=${3:-1}; q=$4; vt=${5:-9000}
W=${size%x*}; H=${size#*x}
WW=$(( (W > 500 ? W : 500) + 40 )); WH=$(( H + 130 ))
here="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$(dirname "$out")"
raw="${out%.png}.raw.png"
# a page path (/agents?...) or a query for / ; MSYS_NO_PATHCONV keeps Git Bash from rewriting "/agents" into a Windows path
src=$(MSYS_NO_PATHCONV=1 node -e "const q = process.argv[1]; process.stdout.write(encodeURIComponent(q.startsWith('/') ? q : '/?' + q))" "$q")
prof="/tmp/qa-chrome-$$-$RANDOM"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --mute-audio --no-first-run --no-default-browser-check \
  --run-all-compositor-stages-before-draw --force-device-scale-factor="$dpr" \
  --user-data-dir="$(cygpath -w "$prof")" --window-size="$WW,$WH" --virtual-time-budget="$vt" \
  --screenshot="$(cygpath -w "$(cd "$(dirname "$raw")" && pwd)/$(basename "$raw")")" \
  "http://localhost:$PORT/__qa/frame.html?w=$W&h=$H&src=$src" >/dev/null 2>&1
rm -rf "$prof"
if [ -f "$raw" ]; then
  (cd "$here" && npx --no-install tsx scripts/qa-png.ts crop "$raw" "$out" $(( W * dpr )) $(( H * dpr )))
  echo "ok   $out"
else
  echo "FAIL $out"
fi
