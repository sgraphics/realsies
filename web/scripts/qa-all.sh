#!/bin/bash
# Every screen at every QA size: builds the matrix, runs scripts/qa-shot.sh in parallel against the
# qa server (start it first: node scripts/qa-serve.mjs), then one contact sheet per screen.
#   scripts/qa-all.sh [screen-filter] [parallel=6]
# Output: web/qa-out/<screen>/<WxH>-dpr<N>.png and web/qa-out/sheets/<screen>.png
cd "$(dirname "$0")/.."
filter=${1:-}; par=${2:-6}
SIZES="360x640:2 390x844:3 430x932:3 844x390:3 768x1024:2 1024x768:2 1280x720:1 1440x900:1 1920x1080:1 2560x1440:1"
jobs=$(mktemp)
add() { # screen query vt [sizes]
  local screen=$1 q=$2 vt=$3 sizes=${4:-$SIZES}
  [ -n "$filter" ] && [[ "$screen" != *$filter* ]] && return
  for sd in $sizes; do
    local size=${sd%:*} dpr=${sd#*:}
    local qq=${q//\{kb\}/$(kb "$size")}
    echo "qa-out/$screen/$size-dpr$dpr.png|$size|$dpr|$qq|$vt" >> "$jobs"
  done
}
kb() { # a plausible on-screen keyboard height for the size
  local W=${1%x*} H=${1#*x}
  if [ "$W" -gt "$H" ]; then echo $(( H / 2 )); elif [ "$W" -ge 700 ]; then echo $(( H * 32 / 100 )); else echo $(( H * 40 / 100 )); fi
}
PHONES="360x640:2 390x844:3 430x932:3 844x390:3 768x1024:2 1024x768:2"
add who            "mock=1&qa=who" 6000
add lobby-jungle   "mock=1&as=ana&level=1" 8000
add lobby-desert   "mock=1&as=ana&level=2" 8000
add lobby-cave     "mock=1&as=ana&level=3" 8000
add lobby-space    "mock=1&as=ana&level=1&round=10" 8000
add lobby-castle   "mock=1&as=ana&level=2&round=10" 8000
add lobby-longnames "mock=1&as=cleo&level=1&longnames=1" 8000
add seat           "mock=1&as=ana&qa=seat&level=1" 8000
add search         "mock=1&as=ana&qa=search&level=2&searchms=60000" 7000
add countdown-3    "mock=1&as=ana&qa=countdown&cd=3&level=1&searchms=300" 7000
add countdown-2    "mock=1&as=ana&qa=countdown&cd=2&level=1&searchms=300" 7000
add countdown-1    "mock=1&as=ana&qa=countdown&cd=1&level=1&searchms=300" 7000
add countdown-chat "mock=1&as=ana&qa=countdown&cd=go&level=1&searchms=300" 7000
add countdown-castle "mock=1&as=ana&qa=countdown&cd=2&level=2&round=10&searchms=300" 7000 "390x844:3 1280x720:1"
add countdown-desert "mock=1&as=ana&qa=countdown&cd=2&level=2&searchms=300" 7000 "390x844:3 1280x720:1"
add countdown-cave   "mock=1&as=ana&qa=countdown&cd=2&level=3&searchms=300" 7000 "390x844:3 1280x720:1"
add countdown-space  "mock=1&as=ana&qa=countdown&cd=go&level=1&round=10&searchms=300" 7000 "390x844:3 1280x720:1"
add chat           "mock=1&as=ana&qa=chat&long=1&level=1&mode=paid&coins=10" 16000
add chat-keyboard  "mock=1&as=ana&qa=chat&long=1&level=1&kb={kb}" 16000 "$PHONES"
add chat-castle    "mock=1&as=ana&qa=chat&long=1&level=2&round=10" 16000 "390x844:3 1280x720:1"
add chat-desert    "mock=1&as=ana&qa=chat&long=1&level=2" 16000 "390x844:3 1280x720:1"
add chat-cave      "mock=1&as=ana&qa=chat&long=1&level=3" 16000 "390x844:3 1280x720:1"
add chat-space     "mock=1&as=ana&qa=chat&long=1&level=1&round=10" 16000 "390x844:3 1280x720:1"
add call           "mock=1&as=ana&qa=call&long=1&level=2&mode=paid&coins=25" 18000
add locked         "mock=1&as=ana&qa=locked&long=1&level=3" 20000
add results        "mock=1&as=ana&qa=results" 10000
add results-persona "mock=1&as=ana&qa=results-persona" 10000
add verify         "mock=1&as=ana&qa=verify" 14000
add verify-persona "mock=1&as=ana&qa=verify-persona" 14000
add rounds         "mock=1&as=ana&qa=rounds" 9000
add menu           "mock=1&as=ana&menu=1" 8000
add terms          "mock=1&qa=terms" 5000
add deposit        "mock=1&as=ben&qa=deposit" 8000
add lobby-napping  "mock=1&as=ana&qa=search&level=1&nobots=1" 4500
# the pages for AI builders (a path instead of a query: qa-shot.sh loads it as is)
add agents          "/agents?mock=1&qa=top" 7000
add agents-form     "/agents?mock=1&qa=form" 7000
add agents-success  "/agents?mock=1&qa=success" 9000
add dashboard       "/agents/dashboard?mock=1&qa=dashboard" 9000
add dashboard-token "/agents/dashboard?mock=1&qa=token" 6000
add dashboard-chats "/agents/dashboard?mock=1&qa=chats" 10000
add dashboard-setup "/agents/dashboard?mock=1&qa=setup" 10000
n=$(wc -l < "$jobs")
echo "$n shots, $par at a time"
tr '\n' '\0' < "$jobs" | xargs -0 -P "$par" -I{} bash -c 'IFS="|" read -r out size dpr q vt <<< "{}"; bash scripts/qa-shot.sh "$out" "$size" "$dpr" "$q" "$vt"'
rm -f "$jobs"
for d in qa-out/*/; do
  s=$(basename "$d"); [ "$s" = sheets ] && continue
  [ -n "$filter" ] && [[ "$s" != *$filter* ]] && continue
  npx --no-install tsx scripts/qa-png.ts sheet "$d" "qa-out/sheets/$s.png" "$s"
done
