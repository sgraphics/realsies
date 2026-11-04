#!/bin/bash
# QA screenshots without a browser driver: headless Chrome --screenshot against the dev server in mock mode.
# Pages with ?qa= mirror the world canvas into an <img> (headless does not always composite canvases).
# usage: DPR=2 scripts/qa-shot.sh name WxH "mock=1&as=ana&qa=chat" [virtual-ms]   -> web/.qa/name.png
CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe"
name=$1; size=$2; q=$3; vt=${4:-9000}
mkdir -p "$(dirname "$0")/../.qa"; out="$(cygpath -w "$(cd "$(dirname "$0")/.." && pwd)/.qa/$name.png")"
rm -rf /tmp/qa-chrome-$name
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --run-all-compositor-stages-before-draw --force-device-scale-factor=${DPR:-1} --user-data-dir="$(cygpath -w /tmp/qa-chrome-$name)" --window-size=$size --virtual-time-budget=$vt --screenshot="$out" "http://localhost:5173/?$q" >/dev/null 2>&1
rm -rf /tmp/qa-chrome-$name
echo "$name done"
