#!/usr/bin/env bash
# Sets up the Realsies E2E test environment on NEAR testnet. Idempotent where it can be.
# Needs: near-cli-rs (near), node, the owner's full-access key for realsies.testnet in the legacy keychain
# (~/.near-credentials/testnet/realsies.testnet.json), and contracts/game/realsies_game.wasm.
# Writes relay/.secrets/testnet.json (gitignored).
set -u
cd "$(dirname "$0")/.."
NEAR="${NEAR:-near}"
NET=testnet
CONN="${CONN:-testnet-fast}"
OWNER=realsies.testnet
TOKEN=real.realsies.testnet
GAME=game.realsies.testnet
WASM=contracts/game/realsies_game.wasm
SECRETS=relay/.secrets/testnet.json
KEYS=relay/.secrets/fc-keys.json
LOG=relay/.secrets/setup.log
USERS="ana ben cleo dex eve finn"
mkdir -p relay/.secrets
: > "$LOG"

say() { printf '\n== %s\n' "$*" | tee -a "$LOG"; }
run() { sleep "${PACE:-1.5}"; "$NEAR" "$@" >>"$LOG" 2>&1; local rc=$?; tail -n 3 "$LOG" | grep -E "successfully|Error|error|exists|Transaction ID" | head -2; return $rc; }
exists() { curl -s -m 20 -X POST https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" | grep -q '"amount"'; }
balance() { curl -s -m 20 -X POST https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((Number(BigInt(JSON.parse(s).result.amount)/10n**20n)/10000).toFixed(3))}catch{console.log("0")}})'; }

# 1. More testnet NEAR for the owner from the faucet (each faucet account gets 10 NEAR).
if [ "${SKIP_FAUCET:-0}" != "1" ]; then
  for i in 1 2; do
    BANK="realsies-bank-$i.$NET"
    if ! exists "$BANK"; then
      say "faucet account $BANK"
      run account create-account sponsor-by-faucet-service "$BANK" autogenerate-new-keypair save-to-legacy-keychain network-config $CONN create
      sleep 3
    fi
    B=$(balance "$BANK")
    if node -e "process.exit(Number('$B') > 2 ? 0 : 1)"; then
      AMT=$(node -e "console.log((Number('$B') - 0.1).toFixed(2))")
      say "move $AMT NEAR from $BANK to $OWNER"
      run tokens "$BANK" send-near "$OWNER" "$AMT NEAR" network-config $CONN sign-with-legacy-keychain send
    fi
  done
fi
say "owner balance: $(balance $OWNER) NEAR"

# 2. Function-call keys we hold for the relay.
if [ ! -f "$KEYS" ]; then
  node scripts/keygen.mjs ops promo $USERS > "$KEYS"
fi
pub() { node -e "console.log(require('./$KEYS')['$1'].publicKey)"; }

# 3. Accounts.
create() { # name amount
  local A="$1.$OWNER"
  if exists "$A"; then echo "   $A exists"; return; fi
  say "create $A with $2 NEAR"
  run account create-account fund-myself "$A" "$2 NEAR" autogenerate-new-keypair save-to-legacy-keychain sign-as $OWNER network-config $CONN sign-with-legacy-keychain send
}
create game 5
create ops 3
create faucet 0.5
create fund 0.1
create house 0.1
create promo 0.3
create bots 0.1
for u in $USERS; do create "$u" 0.3; done

# 4. Function-call keys, scoped to the game contract, no deposits possible.
addkey() { # account methods keyname
  say "function-call key on $1 for [$2]"
  run account add-key "$1" grant-function-call-access --allowance '2 NEAR' --contract-account-id $GAME --function-names "$2" \
    use-manually-provided-public-key "$(pub $3)" network-config $CONN sign-with-legacy-keychain send
}
if [ "${SKIP_KEYS:-0}" != "1" ]; then
  addkey "ops.$OWNER" "start_round, commit_characters, end_round_now, reveal_round, open_characters, settle_round" ops
  addkey "promo.$OWNER" "transfer, withdraw" promo
  for u in $USERS; do addkey "$u.$OWNER" "play, call, withdraw, transfer" "$u"; done
fi

# 5. Deploy and initialise the game contract.
CODE=$(curl -s -m 20 -X POST https://rpc.testnet.fastnear.com -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$GAME\"}}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result.code_hash)}catch{console.log("")}})')
INIT='{"owner":"'$OWNER'","operator":"ops.'$OWNER'","fund":"fund.'$OWNER'","house":"house.'$OWNER'","token":"'$TOKEN'","coin_unit":"1000000000000000000","test_mode":true,"params":null}'
if [ "$CODE" = "11111111111111111111111111111111" ] || [ -z "$CODE" ]; then
  say "deploy $GAME"
  run contract deploy $GAME use-file "$WASM" with-init-call new json-args "$INIT" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config $CONN sign-with-legacy-keychain send
else
  echo "   $GAME already has code $CODE (redeploy with REDEPLOY=1, state is kept)"
  if [ "${REDEPLOY:-0}" = "1" ]; then
    say "redeploy $GAME code only"
    run contract deploy $GAME use-file "$WASM" without-init-call network-config $CONN sign-with-legacy-keychain send
  fi
fi

# 6. Register every account on the token, and fund the faucet with tREAL.
for a in $GAME faucet.$OWNER fund.$OWNER house.$OWNER promo.$OWNER bots.$OWNER $(for u in $USERS; do echo "$u.$OWNER"; done); do
  run contract call-function as-transaction $TOKEN storage_deposit json-args "{\"account_id\":\"$a\",\"registration_only\":true}" prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as $OWNER network-config $CONN sign-with-legacy-keychain send >/dev/null
  echo "   registered $a on $TOKEN"
done
FAUCET_BAL=$("$NEAR" contract call-function as-read-only $TOKEN ft_balance_of json-args "{\"account_id\":\"faucet.$OWNER\"}" network-config $CONN now 2>/dev/null | grep -E '^"' | tr -d '"')
if [ "${FAUCET_BAL:-0}" = "0" ]; then
  say "send 10,000,000 tREAL to faucet.$OWNER"
  run contract call-function as-transaction $TOKEN ft_transfer json-args "{\"receiver_id\":\"faucet.$OWNER\",\"amount\":\"10000000000000000000000000\",\"memo\":\"realsies test faucet\"}" prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as $OWNER network-config $CONN sign-with-legacy-keychain send
fi

# 7. Secrets for the relay.
node - "$KEYS" "$SECRETS" "$USERS" <<'EOF'
const fs = require('fs'); const os = require('os'); const path = require('path');
const [keysPath, outPath, users] = process.argv.slice(2);
const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.near-credentials', 'testnet', 'faucet.realsies.testnet.json'), 'utf8'));
const label = (u) => u[0].toUpperCase() + u.slice(1);
const out = {
  network: 'testnet',
  rpc: ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'],
  contractId: 'game.realsies.testnet',
  tokenId: 'real.realsies.testnet',
  tokenDecimals: 18,
  operator: { accountId: 'ops.realsies.testnet', privateKey: keys.ops.privateKey },
  faucet: { accountId: 'faucet.realsies.testnet', privateKey: cred.private_key },
  promo: { accountId: 'promo.realsies.testnet', privateKey: keys.promo.privateKey },
  accounts: { fund: 'fund.realsies.testnet', house: 'house.realsies.testnet', bots: 'bots.realsies.testnet' },
  testUsers: users.split(' ').map((u) => ({ accountId: `${u}.realsies.testnet`, label: label(u), privateKey: keys[u].privateKey })),
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('wrote', outPath, 'with', out.testUsers.length, 'test users');
EOF
say "done; owner balance $(balance $OWNER) NEAR; log in $LOG"
