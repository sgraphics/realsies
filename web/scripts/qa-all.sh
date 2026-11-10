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
# the way in: a guest watches the room; a tap on a character opens "Before you play" (the terms with one checkbox,
# before and after ticking), then the sign-in (testnet: the wallet and the six test players; mainnet: the wallet),
# and once signed in the tapped character's seat opens
add guest          "mock=1&qa=guest" 8000
add guest-mainnet  "mock=1&wallet=1&qa=guest" 8000
add consent        "mock=1&qa=consent" 8000
add consent-ticked "mock=1&qa=consent&tick=1" 8000
add guest-tap      "mock=1&qa=guest-tap" 8000
add guest-tap-mainnet "mock=1&wallet=1&qa=guest-tap" 8000
add guest-seat     "mock=1&qa=guest-seat" 9000
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
# wallet sign-in (protocol v1.3): a relay without test mode (&wallet=1), the mock wallet signs as sam.testnet
add signin-wait    "mock=1&wallet=1&qa=signin-wait&hold=signIn" 8000
# the one approval a first paid play asks for (when no deposit brought the play key along), and waiting for it
add playkey        "mock=1&wallet=1&as=sam&qa=key" 8000
add playkey-wait   "mock=1&wallet=1&as=sam&qa=key&hold=key" 8000
add deposit-wallet "mock=1&wallet=1&as=sam&qa=deposit" 9000
add coins-wallet   "mock=1&wallet=1&as=sam&qa=coins" 10000
add deposit-closed "mock=1&wallet=1&as=sam&qa=deposit&coins=closed" 8000
# the coins screen of a wallet player on the testnet relay (test mode), 20 coins typed: an empty wallet, a short one, enough
add coins-empty    "mock=1&wallet=test&as=sam&qa=deposit&wcoins=0&dep=20" 9000
add coins-short    "mock=1&wallet=test&as=sam&qa=deposit&wcoins=3&dep=20" 9000
add coins-enough   "mock=1&wallet=test&as=sam&qa=deposit&wcoins=200&dep=20" 9000
# the testnet airdrop (protocol v1.6): the TESTNET panel above the room while a player holds nothing at all, for a
# wallet player (the tokens land in the wallet) and a test player (straight into the game balance); after the
# airdrop the panel is gone and a note says where the tokens are; the wait for the next one (one 3 minutes ago)
add testnet-wallet-before "mock=1&wallet=test&as=sam&level=1" 9000
add testnet-wallet-after  "mock=1&wallet=test&as=sam&level=1&qa=airdrop" 5000
add testnet-test-before   "mock=1&as=ben&level=1" 8000
add testnet-test-after    "mock=1&as=ben&level=1&qa=airdrop" 5000
add testnet-wait          "mock=1&as=dex&level=1&qa=airdrop-wait" 8000
# the coins screen: an empty wallet on testnet (the airdrop) and on mainnet (Buy REAL), the airdrop's 100 in the wallet
# before the first deposit (its one-line note about the one approval), and after it (the play key came along: no note)
add coins-testnet         "mock=1&wallet=test&as=sam&qa=deposit&wcoins=0" 9000
add coins-mainnet         "mock=1&wallet=1&net=mainnet&as=sam&qa=deposit&wcoins=0" 9000
add coins-airdropped      "mock=1&wallet=test&as=sam&qa=deposit&wcoins=100&dep=100" 9000
add coins-keyed           "mock=1&wallet=test&as=sam&qa=coins&wcoins=100" 10000
# coins for NEAR on Rhea (protocol v1.12, &swap=1): 0.5 NEAR typed and its quote (nothing held: the airdrop stays on
# testnet); a buy done; coins in the game with 40 typed to withdraw as NEAR and 30 in the wallet itself; a buy whose
# deposit did not follow (a wallet that sends the batch at once: the coins wait in the wallet); the price moved past a
# buy; a withdrawal as NEAR done; the mainnet look
SWAPSIZES="360x640:2 390x844:3 430x932:3 844x390:3 768x1024:2 1280x720:1 1920x1080:1"
add swap-quote    "mock=1&wallet=test&swap=1&as=sam&qa=swap&near=0.5" 9000 "$SWAPSIZES"
add swap-done     "mock=1&wallet=test&swap=1&as=sam&qa=swap-done" 12000 "$SWAPSIZES"
add swap-withdraw "mock=1&wallet=test&swap=1&as=sam&qa=swap&game=120&wcoins=30&withdraw=40" 11000 "$SWAPSIZES"
add swap-left     "mock=1&wallet=test&swap=1&as=sam&qa=swap-done&nowait=1&game=45" 13000 "$SWAPSIZES"
add swap-moved    "mock=1&wallet=test&swap=1&as=sam&qa=swap-done&moved=1" 12000 "$SWAPSIZES"
add swap-sold     "mock=1&wallet=test&swap=1&as=sam&qa=swap-sold&game=120" 13000 "$SWAPSIZES"
add swap-mainnet  "mock=1&wallet=1&net=mainnet&swap=1&as=sam&qa=swap&near=1&game=200&withdraw=50" 11000 "$SWAPSIZES"
# with the coin on Rhea (config.nearPerCoin) coin values read in NEAR: the seat's presets, the round's results
add swap-seat     "mock=1&swap=1&as=ana&qa=seat&level=1" 8000 "$SWAPSIZES"
add swap-results  "mock=1&swap=1&as=ana&qa=results" 10000 "$SWAPSIZES"
# the launch (protocol v1.4), a mainnet-like mock (wallet sign-in, no coin yet): the coming-soon page until REAL's
# (its video card opens the launch tweet; -account: no tweet yet, the account; -nox: no X link, no card)
# auction and the game open (Get REAL, or the time without a token page), the moment it goes live (CHAT!, then the
# game in place), then the game with its banner: the auction, finalizing, gone once coins open; and /play before
add launch-soon          "mock=1&launch=soon&qa=top" 6000
add launch-soon-account  "mock=1&launch=soon&tweet=0&qa=top" 6000
add launch-soon-nox      "mock=1&launch=soon&nox=1&qa=top" 6000 "360x640:2 390x844:3 844x390:3 1280x720:1"
add launch-auction       "mock=1&launch=auction&qa=top" 6000
add launch-finalizing    "mock=1&launch=finalizing&qa=top" 6000
add launch-soon-notoken  "mock=1&launch=soon&notoken=1&qa=top" 6000 "360x640:2 390x844:3 844x390:3 1280x720:1"
add launch-golive        "mock=1&launch=soon&startin=1&qa=top" 2300 "360x640:2 390x844:3 844x390:3 1280x720:1 1920x1080:1"
add launch-handover      "mock=1&launch=soon&startin=1&qa=top" 6000 "390x844:3 1280x720:1"
add launch-lobby         "mock=1&launch=auction&as=sam&level=1" 8000 "360x640:2 390x844:3 844x390:3 1280x720:1 1920x1080:1"
add launch-chat          "mock=1&launch=auction&as=sam&qa=chat&long=1&level=1" 16000 "360x640:2 390x844:3 844x390:3 768x1024:2 1280x720:1"
add launch-chat-keyboard "mock=1&launch=auction&as=sam&qa=chat&long=1&level=1&kb={kb}" 16000 "$PHONES"
add launch-open          "mock=1&launch=finalizing&opens=3&as=sam&level=1" 9000 "390x844:3 1280x720:1"
add launch-play          "/play?mock=1&launch=soon&qa=top" 6000 "390x844:3 1280x720:1"
# Turing Hour (protocol v1.13): the line above the room from 6 hours before the hour (3 h 12 min to go) and during it,
# for a player and a guest; with the launch's auction banner up only the auction shows; nothing in a chat
TURINGSIZES="360x640:2 390x844:3 844x390:3 768x1024:2 1280x720:1 1920x1080:1"
add turing-soon        "mock=1&as=ana&level=1&turing=soon" 8000 "$TURINGSIZES"
add turing-on          "mock=1&as=ana&level=1&turing=on" 8000 "$TURINGSIZES"
add turing-guest       "mock=1&qa=guest&turing=on" 8000 "360x640:2 1280x720:1"
add turing-launch      "mock=1&launch=auction&turing=on&as=sam&level=1" 8000 "360x640:2 1280x720:1"
add turing-chat        "mock=1&as=ana&qa=chat&long=1&level=1&turing=on" 16000 "360x640:2 1280x720:1"
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
