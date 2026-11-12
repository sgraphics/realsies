"""The README's "Numbers so far" table, counted from the game's own records and the chain.

    python -I scripts/stats.py --x 67 --telegram 11            print the table
    python -I scripts/stats.py --x 67 --telegram 11 --write    and put it into README.md between the stats markers

Where the numbers come from:
  the relays' databases on the server (through ssh, read-only): rounds, chats, players, free chats, bot replies and
    their enclave signatures, the relay's own transactions;
  the web server's log: how many different browsers loaded the game (by user agent: an estimate; crawlers left out);
  the relays' health pages: what NEAR AI has cost;
  the chain: the REAL pool on Rhea (what was bought out of it, the NEAR in it);
  this repository: commits; the test counts below are typed in.
The followers and members of X and Telegram are given on the command line: nothing here can read them.
Settings: SERVER (an ssh host alias), OWN and scripts/own-accounts.txt (the owner's accounts, as in join-watch.py).
"""
import base64
import datetime
import json
import os
import subprocess
import sys
import urllib.request

# an ssh host alias (Host realsies-server in ~/.ssh/config), so the server's address is not in the repository
SERVER = os.environ.get('SERVER', 'root@realsies-server')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RPC = 'https://rpc.mainnet.fastnear.com'
POOL_CONTRACT = 'dclv2.ref-labs.near'
POOL = 'real.realsies.near|wrap.near|2000'
IN_POOL_AT_LAUNCH = 800_000_000
TESTS = 'relay 136 tests, web 587 checks, vault 19 tests'
START, END = '<!-- stats:start -->', '<!-- stats:end -->'


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
const own = new Set(OWN_LIST);
const out = {};
for (const net of ['mainnet', 'realsies']) {
  const db = new DatabaseSync('data/' + net + '.db', { readOnly: true });
  const one = (q) => { try { return Object.values(db.prepare(q).get())[0]; } catch (e) { return null; } };
  const players = db.prepare('SELECT DISTINCT account FROM results').all().map((r) => r.account);
  const calls = { right: 0, wrong: 0 };
  for (const r of db.prepare('SELECT account, data FROM results').all()) {
    if (own.has(r.account)) continue;
    for (const c of (JSON.parse(r.data).chats || [])) if (c.right === true) calls.right++; else if (c.right === false) calls.wrong++;
  }
  let practice = 0;
  for (const r of db.prepare("SELECT data FROM practice_chats WHERE status != 'aborted'").all()) {
    practice++;
    const res = JSON.parse(r.data).result;
    if (res && res.right === true) calls.right++; else if (res && res.right === false) calls.wrong++;
  }
  out[net] = {
    rounds: one("SELECT COUNT(*) FROM rounds WHERE status = 'settled'"),
    chats: one('SELECT COUNT(DISTINCT conv_id) FROM chats'),
    players: players.length, outside: players.filter((a) => !own.has(a)).length,
    practice, calls,
    replies: one('SELECT COUNT(*) FROM completions'), signed: one('SELECT COUNT(*) FROM completions WHERE signature IS NOT NULL'),
    attestations: one('SELECT COUNT(*) FROM attestations'),
    txs: one('SELECT COUNT(*) FROM txs WHERE ok = 1'), txsFailed: one('SELECT COUNT(*) FROM txs WHERE ok = 0'),
  };
}
console.log(JSON.stringify(out));
"""

SH = r"""
cd /opt/realsies/relay && sudo -u realsies node --disable-warning=ExperimentalWarning - <<'JS_END'
__JS__
JS_END
echo "BROWSERS $(zcat -f /var/log/nginx/access.log* 2>/dev/null | grep 'GET /api/config' | grep 'realsies.lol/' | grep -v 'testnet.realsies' | grep -v -i -E 'bot|crawl|spider|curl|Headless|preview' | awk -F'"' '{print $6}' | sort -u | wc -l)"
T=$(grep -E '^ADMIN_TOKEN=' /opt/realsies/.env | cut -d= -f2-)
for p in 3961 3960; do echo "SPEND $p $(curl -s -m 10 -H "Authorization: Bearer $T" http://127.0.0.1:$p/api/admin/health | grep -o '"spendUsd":[0-9.]*' | head -1 | cut -d: -f2)"; done
"""


def server():
    script = SH.replace('__JS__', JS.replace('OWN_LIST', json.dumps(sorted(own_accounts()))).strip())
    # as bytes: text mode on Windows would send CRLF line ends, which the server's shell does not take
    r = subprocess.run(['ssh', '-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', SERVER, 'bash -s'], input=script.encode('utf-8'),
                       capture_output=True, timeout=120)
    stdout, stderr = r.stdout.decode('utf-8', 'replace'), r.stderr.decode('utf-8', 'replace')
    if r.returncode != 0:
        raise SystemExit('could not read the server: ' + (stderr or stdout).strip()[:300])
    out = {'spend': {}}
    for line in stdout.splitlines():
        if line.startswith('{'):
            out['db'] = json.loads(line)
        elif line.startswith('BROWSERS '):
            out['browsers'] = int(line.split()[1])
        elif line.startswith('SPEND '):
            parts = line.split()
            out['spend'][parts[1]] = float(parts[2]) if len(parts) > 2 else 0.0
    return out


def pool():
    args = base64.b64encode(json.dumps({'pool_id': POOL}).encode()).decode()
    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'query', 'params': {'request_type': 'call_function', 'finality': 'final', 'account_id': POOL_CONTRACT, 'method_name': 'get_pool', 'args_base64': args}}).encode()
    req = urllib.request.Request(RPC, data=body, headers={'content-type': 'application/json', 'user-agent': 'stats'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(bytes(json.load(r)['result']['result']).decode())


def arg(name):
    return sys.argv[sys.argv.index('--' + name) + 1] if '--' + name in sys.argv else None


def main():
    s = server()
    m, t = s['db']['mainnet'], s['db']['realsies']
    p = pool()
    bought = IN_POOL_AT_LAUNCH - int(p['total_x']) / 1e18
    near_in_pool = int(p['total_y']) / 1e24
    near_in, near_out = int(p['volume_y_in']) / 1e24, int(p['volume_y_out']) / 1e24
    commits = subprocess.run(['git', 'rev-list', '--count', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    calls = m['calls']['right'] + m['calls']['wrong']
    now = datetime.datetime.now(datetime.timezone.utc)
    spend = s['spend'].get('3961', 0) + s['spend'].get('3960', 0)
    x, tg = arg('x'), arg('telegram')
    rows = [
        ('Mainnet game (since Nov 9)', f"{m['rounds']} rounds settled on chain, {m['chats']} chats in rounds, {m['practice']} free chats by guests"),
        ('Players', f"{m['players']} wallets have played ({m['outside']} of them outside the team); about {s.get('browsers', '?')} different browsers have opened realsies.lol (counted by user agent, an estimate)"),
        ('Can people tell?', f"visitors called it right {m['calls']['right']} times out of {calls}" if calls else 'no calls by visitors yet'),
        ('Bots', f"{m['replies']} bot replies on mainnet, {m['signed']} of them signed in a NEAR AI enclave; {m['attestations']} enclave attestations checked; NEAR AI has cost ${spend:.2f} so far, testnet included"),
        ('Chain', f"{m['txs']} transactions by the mainnet relay, {m['txsFailed']} failed. Testnet since Nov 4: {t['rounds']} rounds settled, {t['txs']:,} transactions"),
        ('REAL', f"{bought / 1e6:.1f} million REAL ({bought / 1e7:.1f}% of the supply) bought out of the pool; {near_in:.2f} NEAR paid in, {near_out:.2f} NEAR paid out, {near_in_pool:.2f} NEAR in the pool. Most of it is the team's own play so far"),
        ('Community', ', '.join(v for v in [f'X @realsieslol: {x} followers' if x else '', f'Telegram t.me/realsieslol: {tg} members' if tg else ''] if v) or 'not given'),
        ('Code', f'{commits} commits since Nov 4; {TESTS}'),
    ]
    table = [f'Counted on {now:%Y-%m-%d} at {now:%H:%M} UTC by `scripts/stats.py`, from the game\'s own records and the chain.', '', '| | |', '|---|---|']
    table += [f'| {k} | {v} |' for k, v in rows]
    text = '\n'.join(table)
    print(text)
    if '--write' in sys.argv:
        path = os.path.join(ROOT, 'README.md')
        doc = open(path, encoding='utf-8').read()
        if START not in doc or END not in doc:
            raise SystemExit('README.md has no stats markers')
        doc = doc[:doc.index(START) + len(START)] + '\n' + text + '\n' + doc[doc.index(END):]
        open(path, 'w', encoding='utf-8', newline='\n').write(doc)
        print('\nwritten into README.md')


if __name__ == '__main__':
    main()
