#!/usr/bin/env bash
# On-chain smoke round on a throwaway copy of the game contract (smoke.realsies.testnet), then delete it.
# Proves the deployed wasm runs a full round on the real testnet runtime, ecrecover included.
set -u
cd "$(dirname "$0")/.."
NEAR="${NEAR:-near}"; C=testnet-fast; S=smoke.realsies.testnet; T=real.realsies.testnet; O=realsies.testnet
PY=.tooling/venv/Scripts/python.exe
q() { sleep 1.5; "$NEAR" "$@" network-config $C sign-with-legacy-keychain send 2>&1 | grep -E "Transaction ID|Error|panicked|Smart contract panicked|Logs" | head -3; }
view() { "$NEAR" contract call-function as-read-only "$1" "$2" json-args "$3" network-config $C now 2>/dev/null | sed -n '/^[{["0-9]/,$p'; }

echo "== create and deploy $S"
q account create-account fund-myself $S '3.6 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as $O
sleep 2
"$NEAR" contract deploy $S use-file contracts/game/realsies_game.wasm with-init-call new json-args "{\"owner\":\"$O\",\"operator\":\"$O\",\"fund\":\"fund.$O\",\"house\":\"house.$O\",\"token\":\"$T\",\"coin_unit\":\"1000000000000000000\",\"test_mode\":true,\"params\":null}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config $C sign-with-legacy-keychain send 2>&1 | grep -E "Transaction ID|Error" | head -2
q contract call-function as-transaction $T storage_deposit json-args "{\"account_id\":\"$S\",\"registration_only\":true}" prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as $O

echo "== deposits for ana and ben through the faucet"
for u in ana ben; do
  q contract call-function as-transaction $T ft_transfer_call json-args "{\"receiver_id\":\"$S\",\"amount\":\"50000000000000000000\",\"msg\":\"{\\\"for\\\":\\\"$u.$O\\\"}\"}" prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as faucet.$O
done
echo "   ana: $(view $S balance_of '{"account_id":"ana.realsies.testnet"}')"

NOW=$(node -e 'console.log(Date.now())'); ENDS=$((NOW + 600000))
V=$($PY -I scripts/smoke_vectors.py 1 $ENDS)
j() { node -e "const v=JSON.parse(process.argv[1]); console.log(JSON.stringify(eval('v.'+process.argv[2])))" "$V" "$1"; }
HA=$(j 'handles["ana.realsies.testnet"]' | tr -d '"'); HB=$(j 'handles["ben.realsies.testnet"]' | tr -d '"')

echo "== round: start, commit, plays, calls"
q contract call-function as-transaction $S start_round json-args "{\"round_id\":1,\"secret_hash\":$(j secret_hash),\"ends_at_ms\":$ENDS}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as $O
q contract call-function as-transaction $S commit_characters json-args "{\"round_id\":1,\"items\":$(j commit)}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as $O
sleep 2
q contract call-function as-transaction $S play json-args "{\"round_id\":1,\"handle\":\"$HA\",\"coins\":10}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as ana.$O
q contract call-function as-transaction $S play json-args "{\"round_id\":1,\"handle\":\"$HB\",\"coins\":10}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as ben.$O
q contract call-function as-transaction $S call json-args "{\"round_id\":1,\"handle\":\"$HA\",\"human\":true}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as ana.$O
q contract call-function as-transaction $S call json-args "{\"round_id\":1,\"handle\":\"$HB\",\"human\":false}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as ben.$O

echo "== end now, reveal, open (ecrecover on chain), settle"
q contract call-function as-transaction $S end_round_now json-args '{"round_id":1}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as $O
sleep 3
q contract call-function as-transaction $S reveal_round json-args "{\"round_id\":1,\"secret\":$(j secret)}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as $O
sleep 1.5
"$NEAR" contract call-function as-transaction $S open_characters json-args "{\"round_id\":1,\"openings\":$(j opening)}" prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as $O network-config $C sign-with-legacy-keychain send 2>&1 | sed -n '/Function execution return value/,/^\s*$/p;/Gas burned/p;/panicked/p' | head -25
q contract call-function as-transaction $S settle_round json-args '{"round_id":1}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as $O
echo "== balances (base units): ana should be 40, ben 56.15, bots 1.9, house 0.95, fund 1.0"
for a in ana ben bots house fund; do echo "   $a: $(view $S balance_of "{\"account_id\":\"$a.realsies.testnet\"}" | tr -d '\n')"; done
echo "== withdraw: ben takes 6 tREAL back to his wallet"
q contract call-function as-transaction $S withdraw json-args '{"amount":"6000000000000000000"}' prepaid-gas '50 Tgas' attached-deposit '0 NEAR' sign-as ben.$O
echo "   ben in game: $(view $S balance_of '{"account_id":"ben.realsies.testnet"}' | tr -d '\n')  ben wallet: $(view $T ft_balance_of '{"account_id":"ben.realsies.testnet"}' | tr -d '\n')"
if [ "${KEEP:-0}" != "1" ]; then
  echo "== delete $S, NEAR back to $O"
  sleep 2
  "$NEAR" account delete-account $S beneficiary $O network-config $C sign-with-legacy-keychain send 2>&1 | grep -E "successfully|Error" | head -2
fi
