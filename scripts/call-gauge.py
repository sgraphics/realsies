"""How often do people call it right on realsies.lol? Counts it from the game's own records and renders the gauge.

Reads the mainnet relay's database on the server (through ssh, read-only): every call in a settled round by an
account that is not the owner's, and every call that ended a guest's free practice chat. A chat without a call is not
counted. Then renders the still with that share and the time of counting:

    python -I scripts/call-gauge.py            count, render, copy into .bl0x/topics/near-hackathon/promo/
    python -I scripts/call-gauge.py --count    count only
    python -I scripts/call-gauge.py --all      count the owner's own calls too

The still shows the percentage and no count of calls (the owner's choice while there are few); the counts are
printed here so that whoever posts it knows what it stands on. Settings: SERVER, OWN (the owner's accounts).
A guest is anonymous, so a free chat the owner plays as a guest cannot be told apart and is counted.
"""
import datetime
import json
import os
import shutil
import subprocess
import sys

# an ssh host alias (Host realsies-server in ~/.ssh/config), so the server's address is not in the repository
SERVER = os.environ.get('SERVER', 'root@realsies-server')
def own_accounts():
    """The owner's own accounts, never counted as visitors: realsies.near, OWN from the environment, and the lines of
    scripts/own-accounts.txt (a local file, not in the repository)."""
    names = set(os.environ.get('OWN', '').split()) | {'realsies.near'}
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'own-accounts.txt'), encoding='utf-8') as f:
            names |= {l.strip() for l in f if l.strip() and not l.startswith('#')}
    except OSError:
        pass
    return names


OWN = sorted(own_accounts())
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

JS = """
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('data/mainnet.db', { readOnly: true });
const own = new Set(OWN_LIST);
const out = { visitors: { right: 0, wrong: 0, none: 0 }, owner: { right: 0, wrong: 0, none: 0 }, accounts: [] };
const add = (g, right) => { out[g][right === null || right === undefined ? 'none' : right ? 'right' : 'wrong']++; };
const seen = new Set();
for (const r of db.prepare('SELECT account, data FROM results').all()) {
  for (const c of (JSON.parse(r.data).chats || [])) add(own.has(r.account) ? 'owner' : 'visitors', c.right);
  if (!own.has(r.account)) seen.add(r.account);
}
out.accounts = [...seen];
for (const r of db.prepare("SELECT data FROM practice_chats WHERE status != 'aborted'").all()) {
  const d = JSON.parse(r.data);
  add('visitors', d.result ? d.result.right : null);
}
console.log(JSON.stringify(out));
"""


def count():
    js = JS.replace('OWN_LIST', json.dumps(OWN))
    r = subprocess.run(['ssh', '-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', SERVER,
                        'cd /opt/realsies/relay && sudo -u realsies node --disable-warning=ExperimentalWarning -'],
                       input=js, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=90)
    if r.returncode != 0:
        raise SystemExit('could not count on the server: ' + (r.stderr or r.stdout).strip()[:300])
    return json.loads(r.stdout.strip().splitlines()[-1])


def main():
    c = count()
    v, o = c['visitors'], c['owner']
    right, wrong = v['right'], v['wrong']
    if '--all' in sys.argv:
        right, wrong = right + o['right'], wrong + o['wrong']
    n = right + wrong
    print(f"visitors: {v['right']} right, {v['wrong']} fooled, {v['none']} without a call (wallet players among them: {', '.join(c['accounts']) or 'none'})")
    print(f"the owner's accounts ({', '.join(OWN)}): {o['right']} right, {o['wrong']} fooled, {o['none']} without a call")
    if n == 0:
        raise SystemExit('no calls yet')
    pct = int(100 * right / n + 0.5)
    now = datetime.datetime.now(datetime.timezone.utc)
    as_of = f'{now:%b} {now.day}, {now:%H:%M} UTC'
    print(f"{pct}% called it right ({right} of {n}{', the owner included' if '--all' in sys.argv else ''}), as of {as_of}")
    if '--count' in sys.argv:
        return
    npx = shutil.which('npx')
    if not npx:
        raise SystemExit('npx not found: run in trailer/: npx tsx scripts/promo-gauge.ts --pct %d --asof "%s" --dashboard' % (pct, as_of))
    r = subprocess.run([npx, 'tsx', 'scripts/promo-gauge.ts', '--pct', str(pct), '--asof', as_of, '--dashboard'], cwd=os.path.join(ROOT, 'trailer'))
    sys.exit(r.returncode)


if __name__ == '__main__':
    main()
