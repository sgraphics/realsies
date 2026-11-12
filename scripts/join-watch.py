"""Tells the owner when people join realsies.lol.

Reads what is new in the mainnet relay's log (on the server, through ssh) and prints a short report when someone
who is not the owner signs in, gets coins for the first time, plays a chat, or tries the free practice chat.
The chat hub runs it as a job every two minutes; printing wakes the chat, silence means nobody new.

    python -I scripts/join-watch.py                  the job: only what is new since the last run
    python -I scripts/join-watch.py --since 19:00    a dry look at the log since a time today; changes no state
    python -I scripts/join-watch.py --selftest       checks the reading and the wording on canned log lines

The first line of a report says who did what. The chat shows that line on its own, and it has to be enough: the
assistant's reply to it may not come (the account can be out of usage for hours).

A wallet player is reported at once, so the owner can go into the room and meet them. A guest's free chat is
reported when it has ended, or after five minutes, so the line can say how it went.

State: a journal cursor on the server (/var/tmp/realsies-join-watch.cursor), so no line is ever reported twice,
and a small folder here for what is waiting to be reported. Reports are at least six minutes apart, so a busy
hour arrives in a few batches rather than in dozens of messages. Settings: SERVER, OWN (the owner's own
accounts, never reported), STATE.
"""
import copy
import json
import os
import re
import subprocess
import sys
import time

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


OWN = own_accounts()
STATE = os.environ.get('STATE') or os.path.join(os.environ.get('TEMP') or '/tmp', 'realsies-join-watch')
CURSOR = '/var/tmp/realsies-join-watch.cursor'
UNIT = 'realsies-mainnet'
MIN_GAP_S = 360
GUEST_WAIT_S = 300
ACCOUNT = r'(?:[a-z0-9_-]+\.)+(?:near|tg)|[0-9a-f]{64}'
ENDS = {'the bot fooled the guest': 'fooled', 'the guest spotted the bot': 'spotted', 'no call': 'nocall'}


def blank():
    # guests: practice chat id -> how it ended (None while it runs); ended: endings seen, by chat id
    return {'signins': [], 'coins': [], 'chats': {}, 'met': [], 'guests': {}, 'ended': {}, 'guest_since': 0}


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
    ev = blank()
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
        m = re.search(r'\[practice\] practice ([0-9a-z]+): (.*)$', line)
        if m:
            if m.group(2).startswith('a guest with'):
                ev['guests'].setdefault(m.group(1), None)
            elif m.group(2).strip() in ENDS:
                ev['ended'][m.group(1)] = ENDS[m.group(2).strip()]
    return settle(ev)


def settle(ev):
    """Puts each ending on its chat. An ending whose chat is not waiting here was reported before: dropped."""
    for chat, how in ev['ended'].items():
        if chat in ev['guests']:
            ev['guests'][chat] = how
    return ev


def merge(a, b):
    """Adds what is new (b) to what is waiting (a). b keeps its own endings for chats that started earlier."""
    a = copy.deepcopy({**blank(), **a})
    if not isinstance(a['guests'], dict):  # the state file of an older version
        a['guests'] = {}
    for k in ('signins', 'coins', 'met'):
        for x in b[k]:
            if x not in a[k]:
                a[k].append(x)
    for acct, c in b['chats'].items():
        t = a['chats'].setdefault(acct, {'n': 0, 'paid': 0})
        t['n'] += c['n']
        t['paid'] += c['paid']
    for chat, how in b['guests'].items():
        a['guests'].setdefault(chat, how)
    a['ended'] = dict(b['ended'])
    settle(a)
    a['ended'] = {}
    return a


def empty(ev):
    return not (ev['signins'] or ev['coins'] or ev['chats'] or ev['guests'])


def ready(ev, now, last):
    """Whether to report now. Never two reports within six minutes. Players at once; guests alone only when every
    free chat has ended or the oldest has waited five minutes."""
    if now - last < MIN_GAP_S:
        return False
    if ev['signins'] or ev['coins'] or ev['chats']:
        return True
    return all(ev['guests'].values()) or now - ev['guest_since'] >= GUEST_WAIT_S


def plural(n, one, many):
    return f'{n} {one if n == 1 else many}'


def did_what(ev, a):
    did = []
    if a in ev['signins']:
        did.append('signed in')
    if a in ev['coins']:
        did.append('got coins')
    c = ev['chats'].get(a)
    if c:
        did.append(plural(c['n'], 'chat', 'chats') + (f" ({c['paid']} paid)" if c['paid'] else ' (free)'))
    return ', '.join(did)


def guests_line(ev):
    hows = list(ev['guests'].values())
    n = {k: hows.count(k) for k in ('fooled', 'spotted', 'nocall')}
    if len(hows) == 1:
        return 'A guest tried the free chat' + {'fooled': ': the bot fooled them', 'spotted': ' and spotted the bot',
                                                'nocall': ' and left without a call', None: ''}[hows[0]]
    ends = [s for s in (plural(n['fooled'], 'was fooled by the bot', 'were fooled by the bot') if n['fooled'] else '',
                        plural(n['spotted'], 'spotted the bot', 'spotted the bot') if n['spotted'] else '',
                        plural(n['nocall'], 'left without a call', 'left without a call') if n['nocall'] else '') if s]
    return f'{len(hows)} guests tried the free chat' + (': ' + ', '.join(ends) if ends else '')


def report(ev):
    """The first line says who did what (the chat shows it on its own); then one line per player when several."""
    people = list(dict.fromkeys(ev['signins'] + ev['coins'] + list(ev['chats'])))
    head = []
    if ev['met']:
        head.append('Two real people met in a chat: ' + ev['met'][0])
    if len(people) == 1:
        head.append(f'{people[0]} {did_what(ev, people[0])}')
    elif people:
        head.append(f'{len(people)} players: ' + ', '.join(people[:3]) + (f' and {len(people) - 3} more' if len(people) > 3 else ''))
    if ev['guests']:
        head.append(guests_line(ev))
    out = ['. '.join(head)]
    if len(people) > 1:
        out += [f'{a}: {did_what(ev, a)}' for a in people]
    out += [f'Two real people met in a chat: {pair}' for pair in ev['met'][1:]]
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


def selftest():
    def line(text):
        return '01:14:27.958 INFO  ' + text

    start = line('[practice] practice 4c530eadb10d8b7dc6cc: a guest with house bot sophie-melbourne (z-ai/glm-5.3-flash)')
    fooled = line('[practice] practice 4c530eadb10d8b7dc6cc: the bot fooled the guest')
    other = line('[practice] practice aaaa1111bbbb2222cccc: the guest spotted the bot')
    signin = line('[auth] session for alice.near (157f2f46)')
    match = line('[game] match 2338f268c512cebe8e37: alice.near (free) with bot g872a90-6-jake at L1')
    met = line('[game] match 9f8e7d6c5b4a39281706: alice.near (paid) with realsies.near (paid) at L1')
    mine = line('[game] match 1111222233334444aaaa: realsies.near (paid) with owner-two.near (paid) at L1')
    own = {'realsies.near', 'owner-two.near'}
    checks = []

    def check(name, got, want):
        checks.append((name, got == want, got, want))

    check('the owner alone is nobody', empty(events_of([mine, line('[auth] session for realsies.near (ab)')], own)), True)
    check('one player', report(events_of([signin, match], own)), 'alice.near signed in, 1 chat (free)')
    check('a meeting leads',
          report(events_of([signin, met], own)).split('\n')[0],
          'Two real people met in a chat: alice.near with realsies.near. alice.near signed in, 1 chat (1 paid)')
    two = report(events_of([signin, match, line('[auth] play key for anna.near (x)')], own)).split('\n')
    check('several players', two, ['2 players: alice.near, anna.near', 'alice.near: signed in, 1 chat (free)', 'anna.near: got coins'])
    check('a guest, ended', report(events_of([start, fooled], own)), 'A guest tried the free chat: the bot fooled them')
    check('a guest and a player',
          report(events_of([start, signin], own)), 'alice.near signed in. A guest tried the free chat')

    # a guest's chat is held until it has ended, across runs
    waiting = merge(blank(), events_of([start], own))
    waiting['guest_since'] = 1000
    check('a running free chat waits', ready(waiting, 1100, 0), False)
    check('but not for ever', ready(waiting, 1000 + GUEST_WAIT_S, 0), True)
    check('nor does it hold a player back', ready(merge(waiting, events_of([signin], own)), 1100, 0), True)
    later = merge(waiting, events_of([other, fooled], own))
    check('the ending arrives in a later run', (ready(later, 1100, 0), report(later)), (True, 'A guest tried the free chat: the bot fooled them'))
    check('six minutes between reports', ready(later, 1100, 1100 - MIN_GAP_S + 1), False)
    check('an ending without its chat is dropped', empty(merge(blank(), events_of([other], own))), True)
    several = events_of([start, fooled, other.replace('the guest spotted the bot', 'a guest with house bot mia-leeds (m)'), other,
                         line('[practice] practice dddd: a guest with house bot x (m)'), line('[practice] practice dddd: no call'),
                         line('[practice] practice eeee: a guest with house bot x (m)')], own)
    check('several guests', report(several), '4 guests tried the free chat: 1 was fooled by the bot, 1 spotted the bot, 1 left without a call')
    check('an older state file still loads', empty(merge({'signins': [], 'coins': [], 'chats': {}, 'met': [], 'guests': 0, 'fooled': 0, 'spotted': 0}, blank())), True)
    check('blank states do not share lists', (merge(blank(), events_of([signin], own))['signins'], blank()['signins']), (['alice.near'], []))

    for name, ok, got, want in checks:
        print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else f'\n        got  {got!r}\n        want {want!r}'))
    bad = sum(not ok for _, ok, _, _ in checks)
    print(f'{len(checks) - bad} of {len(checks)} pass')
    sys.exit(1 if bad else 0)


def main():
    if '--selftest' in sys.argv:
        selftest()
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
    pending = merge(load('pending.json', blank()), events_of(lines, OWN))
    if empty(pending):
        return
    now = time.time()
    if pending['guests'] and not pending['guest_since']:
        pending['guest_since'] = now
    if not ready(pending, now, load('last.json', 0)):
        save('pending.json', pending)  # held for the next report
        return
    print(report(pending))
    save('pending.json', blank())
    save('last.json', now)


if __name__ == '__main__':
    main()
