#!/usr/bin/env bash
# Mainnet setup for Realsies under realsies.near. Idempotent where it can be. Spends real NEAR.
# Needs: near-cli-rs (near) with a key for realsies.near in the legacy keychain
# (~/.near-credentials/mainnet/realsies.near.json) and contracts/game/realsies_game.wasm.
# Creates game, ops, fund, house, promo, bots; function-call keys for ops and promo; deploys the
# game contract without a token (set at the meme.cooking finalize) and with test mode off.
# Writes relay/.secrets/mainnet.json (gitignored). Run with DRY=1 to print the plan only.
set -u
cd "$(dirname "$0")/.."
NEAR="${NEAR:-near}"
CONN="${CONN:-mainnet-fast}"
OWNER=realsies.near
GAME=game.$OWNER
WASM=contracts/game/realsies_game.wasm
SECRETS=relay/.secrets/mainnet.json
KEYS=relay/.secrets/mainnet-fc-keys.json
LOG=relay/.secrets/setup-mainnet.log
RPC=https://rpc.mainnet.fastnear.com
mkdir -p relay/.secrets
touch "$LOG"

say() { printf '\n== %s\n' "$*" | tee -a "$LOG"; }
run() { sleep "${PACE:-2}"; "$NEAR" "$@" >>"$LOG" 2>&1; local rc=$?; tail -n 4 "$LOG" | grep -E "successfully|Error|error|expired|Transaction ID" | head -2; return $rc; }
view() { curl -s -m 20 -X POST $RPC -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}"; }
exists() { view "$1" | grep -q '"amount"'; }
code_of() { view "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result.code_hash)}catch{console.log("")}})'; }

ACCOUNTS="game:4.5 ops:1 fund:0.1 house:0.1 promo:0.15 bots:0.1"
if [ "${DRY:-0}" = "1" ]; then
  echo "plan for $OWNER:"; for a in $ACCOUNTS; do echo "  create ${a%%:*}.$OWNER with ${a##*:} NEAR"; done
  echo "  function-call keys: ops (operator methods), promo (transfer, withdraw)"
  echo "  deploy $WASM to $GAME: owner $OWNER, operator ops.$OWNER, token and coin unit unset, test_mode false"
  exit 0
fi

# 1. accounts
for a in $ACCOUNTS; do
  name=${a%%:*}; amt=${a##*:}; A="$name.$OWNER"
  if exists "$A"; then echo "   $A exists"; continue; fi
  say "create $A with $amt NEAR"
  run account create-account fund-myself "$A" "$amt NEAR" autogenerate-new-keypair save-to-legacy-keychain sign-as $OWNER network-config $CONN sign-with-legacy-keychain send
done

# 2. function-call keys held by the relay
[ -f "$KEYS" ] || node scripts/keygen.mjs ops promo > "$KEYS"
pub() { node -e "console.log(require('./$KEYS')['$1'].publicKey)"; }
haskey() { curl -s -m 20 -X POST $RPC -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$1\"}}" | grep -q "$2"; }
addkey() { # account methods keyname
  if haskey "$1" "$(pub $3)"; then echo "   $1 already has the $3 key"; return; fi
  say "function-call key on $1 for [$2]"
  run account add-key "$1" grant-function-call-access --allowance unlimited --contract-account-id $GAME --function-names "$2" \
    use-manually-provided-public-key "$(pub $3)" network-config $CONN sign-with-legacy-keychain send
}
addkey "ops.$OWNER" "start_round, commit_characters, reveal_round, open_characters, settle_round, prune_round" ops
addkey "promo.$OWNER" "transfer, withdraw" promo

# 3. deploy and initialise
CODE=$(code_of $GAME)
INIT='{"owner":"'$OWNER'","operator":"ops.'$OWNER'","fund":"fund.'$OWNER'","house":"house.'$OWNER'","token":null,"coin_unit":null,"test_mode":false,"params":null}'
if [ -z "$CODE" ] || [ "$CODE" = "11111111111111111111111111111111" ]; then
  say "deploy $GAME"
  run contract deploy $GAME use-file "$WASM" with-init-call new json-args "$INIT" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config $CONN sign-with-legacy-keychain send
else
  echo "   $GAME already has code $CODE"
fi

# 4. secrets for a mainnet relay
node - "$KEYS" "$SECRETS" <<'EOF'
const fs = require('fs');
const [keysPath, outPath] = process.argv.slice(2);
const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
const out = {
  network: 'mainnet',
  rpc: ['https://rpc.mainnet.fastnear.com', 'https://rpc.mainnet.near.org'],
  contractId: 'game.realsies.near',
  tokenId: null,
  tokenDecimals: 18,
  operator: { accountId: 'ops.realsies.near', privateKey: keys.ops.privateKey },
  promo: { accountId: 'promo.realsies.near', privateKey: keys.promo.privateKey },
  accounts: { fund: 'fund.realsies.near', house: 'house.realsies.near', bots: 'bots.realsies.near' },
  testUsers: [],
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('wrote', outPath);
EOF
say "done; log in $LOG"
