"""The best callers of a Turing Hour, for its prize (rules: realsies.lol/prize.html).

Counts, on the mainnet relay's records (through ssh, read-only), every call in a chat that started inside the hour,
by accounts that are not the team's: right calls first, then fewer wrong calls, then whoever reached the score first.

    python -I scripts/turing-winners.py                    today's hour (20:00 to 21:00 UTC)
    python -I scripts/turing-winners.py --day 2026-11-12   another day
    python -I scripts/turing-winners.py --from 20:00 --to 21:00

A call counts once its round has settled (the round that ends at 21:00 settles a few minutes later). Prints the full
table and the top three with their prizes. It decides nothing about several accounts of one person: look at the
table (accounts created minutes apart, the same moves) before paying. Settings: SERVER (an ssh host alias), OWN and
scripts/own-accounts.txt (the team's accounts), PRIZES (default "3 1.5 0.5", NEAR).
"""
import datetime
import json
import os
import subprocess
import sys

# an ssh host alias (Host realsies-server in ~/.ssh/config), so the server's address is not in the repository
SERVER = os.environ.get('SERVER', 'root@realsies-server')
PRIZES = [float(x) for x in os.environ.get('PRIZES', '3 1.5 0.5').split()]


def own_accounts():
    names = set(os.environ.get('OWN', '').split()) | {'realsies.near'}
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'own-accounts.txt'), encoding='utf-8') as f:
            names |= {l.strip() for l in f if l.strip() and not l.startswith('#')}
    except OSError:
        pass
    return names


JS = """
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('data/mainnet.db', { readOnly: true });
const [from, to] = [FROM_MS, TO_MS];
const own = new Set(OWN_LIST);
const started = new Map();
for (const r of db.prepare('SELECT chat_id, viewer, data FROM chats').all()) {
  const d = JSON.parse(r.data);
  const at = d.startedAt || d.createdAt;
  if (at >= from && at < to && !own.has(r.viewer)) started.set(r.chat_id, { viewer: r.viewer, at, callAt: d.callAt || d.endedAt || at });
}
const out = {};
let pending = 0;
for (const [chatId, c] of started) {
  const rows = db.prepare('SELECT data FROM results WHERE account = ?').all(c.viewer);
  let found = null;
  for (const r of rows) for (const x of (JSON.parse(r.data).chats || [])) if (x.chatId === chatId) found = x;
  const p = out[c.viewer] || (out[c.viewer] = { right: 0, wrong: 0, none: 0, chats: 0, lastRightAt: 0 });
  p.chats++;
  if (!found) { pending++; continue; }
  if (found.right === true) { p.right++; p.lastRightAt = Math.max(p.lastRightAt, c.callAt); }
  else if (found.right === false) p.wrong++;
  else p.none++;
}
console.log(JSON.stringify({ players: out, pending }));
"""


def main():
    day = sys.argv[sys.argv.index('--day') + 1] if '--day' in sys.argv else f'{datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d}'
    t_from = sys.argv[sys.argv.index('--from') + 1] if '--from' in sys.argv else '20:00'
    t_to = sys.argv[sys.argv.index('--to') + 1] if '--to' in sys.argv else '21:00'
    utc = datetime.timezone.utc
    a = datetime.datetime.fromisoformat(f'{day}T{t_from}:00').replace(tzinfo=utc)
    b = datetime.datetime.fromisoformat(f'{day}T{t_to}:00').replace(tzinfo=utc)
    js = (JS.replace('FROM_MS', str(int(a.timestamp() * 1000))).replace('TO_MS', str(int(b.timestamp() * 1000)))
          .replace('OWN_LIST', json.dumps(sorted(own_accounts()))))
    r = subprocess.run(['ssh', '-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', SERVER,
                        'cd /opt/realsies/relay && sudo -u realsies node --disable-warning=ExperimentalWarning -'],
                       input=js.encode('utf-8'), capture_output=True, timeout=120)
    if r.returncode != 0:
        raise SystemExit('could not read the server: ' + r.stderr.decode('utf-8', 'replace').strip()[:300])
    res = json.loads(r.stdout.decode('utf-8', 'replace').strip().splitlines()[-1])
    players = res['players']
    order = sorted(players.items(), key=lambda kv: (-kv[1]['right'], kv[1]['wrong'], kv[1]['lastRightAt'] or 9e15))
    print(f'Turing Hour {day}, {t_from} to {t_to} UTC: {len(players)} players outside the team')
    if res['pending']:
        print(f"  {res['pending']} chats not settled yet: run it again after the round has settled")
    for i, (acct, p) in enumerate(order, 1):
        print(f"  {i:>2}. {acct}: {p['right']} right, {p['wrong']} wrong, {p['none']} without a call ({p['chats']} chats)")
    winners = [(acct, p) for acct, p in order if p['right'] > 0][:len(PRIZES)]
    print('Prizes:' if winners else 'No right calls by anyone outside the team: no winners.')
    for (acct, p), prize in zip(winners, PRIZES):
        print(f'  {prize:g} NEAR to {acct} ({p["right"]} right)')


if __name__ == '__main__':
    main()
