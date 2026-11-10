"""Tells the owner when people join realsies.lol.

Reads what is new in the mainnet relay's log (on the server, through ssh) and prints a short report when someone
who is not the owner signs in, gets coins for the first time, plays a chat, or starts the free practice chat.
The chat hub runs it as a job every two minutes; printing wakes the chat, silence means nobody new.

    python -I scripts/join-watch.py                  the job: only what is new since the last run
    python -I scripts/join-watch.py --since 19:00    a dry look at the log since a time today; changes no state

State: a journal cursor on the server (/var/tmp/realsies-join-watch.cursor), so no line is ever reported twice,
and a small folder here for what is waiting to be reported. Reports are at least six minutes apart, so a busy
hour arrives in a few batches rather than in dozens of messages. Settings: SERVER, OWN (the owner's own
accounts, never reported), STATE.
"""
import json
import os
import re
import subprocess
import sys
import time

SERVER = os.environ.get('SERVER', 'root@realsies-server')
OWN = set(os.environ.get('OWN', 'realsies.near owner-two.near').split())
STATE = os.environ.get('STATE') or os.path.join(os.environ.get('TEMP') or '/tmp', 'realsies-join-watch')
CURSOR = '/var/tmp/realsies-join-watch.cursor'
UNIT = 'realsies-mainnet'
MIN_GAP_S = 360
ACCOUNT = r'(?:[a-z0-9_-]+\.)+(?:near|tg)|[0-9a-f]{64}'


def read_log(since):
    if since:
        cmd = f"journalctl -u {UNIT} --since '{since}' --no-pager -o cat"
    else:
        # first run: start from the newest line, so old history is not reported as new
        cmd = (f"[ -s {CURSOR} ] || journalctl -u {UNIT} -n 1 --cursor-file={CURSOR} -o cat >/dev/null; "
               f"journalctl -u {UNIT} --cursor-file={CURSOR} --no-pager -o cat")
    r = subprocess.run(['ssh', '-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', SERVER, cmd],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=90)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or f'ssh exit {r.returncode}').strip()[:200])
    return r.stdout.splitlines()


def events_of(lines, own):
    """What the lines say about people who are not the owner."""
    ev = {'signins': [], 'coins': [], 'chats': {}, 'met': [], 'guests': 0, 'fooled': 0, 'spotted': 0}
    for line in lines:
        m = re.search(r'\[auth\] session for (' + ACCOUNT + ')', line)
        if m and m.group(1) not in own and m.group(1) not in ev['signins']:
            ev['signins'].append(m.group(1))
        m = re.search(r'\[auth\] play key for (' + ACCOUNT + ')', line)
        if m and m.group(1) not in own and m.group(1) not in ev['coins']:
            ev['coins'].append(m.group(1))
        m = re.search(r'\[game\] match [0-9a-f/]+: (.*)$', line)
        if m:
            people = re.findall(r'(' + ACCOUNT + r') \((paid|free)', m.group(1))
            outside = [(a, kind) for a, kind in people if a not in own]
            for a, kind in outside:
                c = ev['chats'].setdefault(a, {'n': 0, 'paid': 0})
                c['n'] += 1
                c['paid'] += kind == 'paid'
            # two real people in one chat, at least one of them not the owner
            if len(people) == 2 and outside:
                ev['met'].append(' with '.join(a for a, _ in people))
        if re.search(r'\[practice\] practice [0-9a-z]+: a guest with', line):
            ev['guests'] += 1
        if 'the bot fooled the guest' in line:
            ev['fooled'] += 1
        if 'the guest spotted the bot' in line:
            ev['spotted'] += 1
    return ev


def merge(a, b):
    for k in ('signins', 'coins', 'met'):
        for x in b[k]:
            if x not in a[k]:
                a[k].append(x)
    for acct, c in b['chats'].items():
        t = a['chats'].setdefault(acct, {'n': 0, 'paid': 0})
        t['n'] += c['n']
        t['paid'] += c['paid']
    for k in ('guests', 'fooled', 'spotted'):
        a[k] += b[k]
    return a


def empty(ev):
    return not (ev['signins'] or ev['coins'] or ev['chats'] or ev['guests'])


def plural(n, one, many):
    return f'{n} {one if n == 1 else many}'


def report(ev):
    """Headline first: the chat shows it. Then one line per player and one for the guests."""
    people = list(dict.fromkeys(ev['signins'] + ev['coins'] + list(ev['chats'])))
    bits = []
    if people:
        bits.append((people[0] if len(people) == 1 else f'{len(people)} players') + ' on realsies.lol')
    if ev['guests']:
        bits.append(plural(ev['guests'], 'guest tried the free chat', 'guests tried the free chat'))
    out = ['New: ' + ', and '.join(bits)]
    for a in people:
        did = []
        if a in ev['signins']:
            did.append('signed in')
        if a in ev['coins']:
            did.append('got coins')
        c = ev['chats'].get(a)
        if c:
            did.append(plural(c['n'], 'chat', 'chats') + (f" ({c['paid']} paid)" if c['paid'] else ' (free)'))
        out.append(f"{a}: {', '.join(did)}")
    for pair in ev['met']:
        out.append(f'Two real people met in a chat: {pair}')
    if ev['guests']:
        calls = [s for s in (plural(ev['fooled'], 'was fooled by the bot', 'were fooled by the bot') if ev['fooled'] else '',
                             plural(ev['spotted'], 'spotted it', 'spotted it') if ev['spotted'] else '') if s]
        out.append('Guests: ' + plural(ev['guests'], 'free chat', 'free chats') + (', ' + ', '.join(calls) if calls else ''))
    return '\n'.join(out)


def load(name, default):
    try:
        with open(os.path.join(STATE, name), encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def save(name, value):
    with open(os.path.join(STATE, name), 'w', encoding='utf-8') as f:
        json.dump(value, f)


def main():
    if '--since' in sys.argv:
        since = sys.argv[sys.argv.index('--since') + 1]
        ev = events_of(read_log(since), set() if '--all' in sys.argv else OWN)
        print(report(ev) if not empty(ev) else f'nobody but the owner since {since}')
        return
    os.makedirs(STATE, exist_ok=True)
    try:
        lines = read_log(None)
        save('fails.json', 0)
    except Exception as e:  # the server or the network: say so once after twenty quiet minutes, not every run
        fails = load('fails.json', 0) + 1
        save('fails.json', fails)
        print(f'join-watch: {e}', file=sys.stderr)
        if fails == 10:
            print('The join watcher cannot reach the server\nssh to the server has failed ten times in a row: ' + str(e))
        return
    blank = {'signins': [], 'coins': [], 'chats': {}, 'met': [], 'guests': 0, 'fooled': 0, 'spotted': 0}
    pending = merge(load('pending.json', dict(blank)), events_of(lines, OWN))
    if empty(pending):
        return
    now = time.time()
    if now - load('last.json', 0) < MIN_GAP_S:
        save('pending.json', pending)  # held for the next report
        return
    print(report(pending))
    save('pending.json', blank)
    save('last.json', now)


if __name__ == '__main__':
    main()
