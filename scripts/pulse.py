"""What a post brought: who opened realsies.lol since a moment, by the tag on the link, and what they did.

Every link handed out carries a tag, realsies.lol/?via=<tag> (x-clip, tg-id, hn, reddit-webgames...). The page's own
requests then carry that address as their referer, so the web server's log tells which tag a browser came with.

    python -I scripts/pulse.py                 the last 60 minutes
    python -I scripts/pulse.py --minutes 180   the last three hours
    python -I scripts/pulse.py --day           since 00:00 UTC today

Counts (crawlers and link-preview fetchers left out; browsers are told apart by user agent, so two people with the
same phone model count once): browsers whose game started, by tag; free chats started; wallet sign-ins; chats in
rounds by accounts that are not the owner's. Settings: SERVER (an ssh host alias), OWN and scripts/own-accounts.txt.
"""
import datetime
import os
import re
import subprocess
import sys

# an ssh host alias (Host realsies-server in ~/.ssh/config), so the server's address is not in the repository
SERVER = os.environ.get('SERVER', 'root@realsies-server')
BOTS = re.compile(r'bot|crawl|spider|curl|headless|preview|python|node|go-http|scan|zgrab|facebookexternal|whatsapp|slack|discord|twitter|telegrambot', re.I)
LINE = re.compile(r'\[(\d{2})/(\w{3})/(\d{4}):(\d{2}):(\d{2}):(\d{2}) [^\]]*\] "(\w+) (\S+) [^"]*" (\d{3}) \S+ "([^"]*)" "([^"]*)"')
MONTHS = {m: i + 1 for i, m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}


def own_accounts():
    names = set(os.environ.get('OWN', '').split()) | {'realsies.near'}
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'own-accounts.txt'), encoding='utf-8') as f:
            names |= {l.strip() for l in f if l.strip() and not l.startswith('#')}
    except OSError:
        pass
    return names


def fetch(since):
    # every day from the start to today, so a span of several days misses none in between
    now = datetime.datetime.now(datetime.timezone.utc)
    d, wanted = since.date(), set()
    while d <= now.date():
        wanted.add(f'{d:%d/%b/%Y}')
        d += datetime.timedelta(days=1)
    days = '|'.join(sorted(wanted))
    sh = (f"zcat -f /var/log/nginx/access.log.2.gz /var/log/nginx/access.log.1 /var/log/nginx/access.log 2>/dev/null | grep -E '{days}' | grep 'realsies.lol' | grep -v 'testnet.realsies' "
          "| grep -E '/api/config|/api/practice|/api/auth/verify'; echo ===JOURNAL===; "
          f"journalctl -u realsies-mainnet --since '{since:%Y-%m-%d %H:%M:%S} UTC' --no-pager -o cat | grep -E '\\[game\\] match |\\[auth\\] session for'")
    r = subprocess.run(['ssh', '-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', SERVER, sh], capture_output=True, timeout=120)
    if r.returncode not in (0, 1):
        raise SystemExit('could not read the server: ' + r.stderr.decode('utf-8', 'replace').strip()[:300])
    web, _, journal = r.stdout.decode('utf-8', 'replace').partition('===JOURNAL===')
    return web.splitlines(), journal.splitlines()


def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    if '--day' in sys.argv:
        since = now.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        minutes = int(sys.argv[sys.argv.index('--minutes') + 1]) if '--minutes' in sys.argv else 60
        since = now - datetime.timedelta(minutes=minutes)
    web, journal = fetch(since)
    started = {}  # user agent -> tag
    chats = signins = 0
    for l in web:
        m = LINE.search(l)
        if not m:
            continue
        d, mon, y, hh, mm, ss, method, path, status, referer, ua = m.groups()
        at = datetime.datetime(int(y), MONTHS[mon], int(d), int(hh), int(mm), int(ss), tzinfo=datetime.timezone.utc)
        if at < since or BOTS.search(ua):
            continue
        if path.startswith('/api/config') and 'realsies.lol/' in referer:
            tag = re.search(r'[?&]via=([A-Za-z0-9_-]+)', referer)
            tag = tag.group(1) if tag else 'no tag'
            if ua not in started or started[ua] == 'no tag':
                started[ua] = tag
        elif method == 'POST' and path.startswith('/api/practice') and status == '200':
            chats += 1
        elif method == 'POST' and path.startswith('/api/auth/verify') and status == '200':
            signins += 1
    own = own_accounts()
    wallet_chats, players = 0, set()
    for l in journal:
        m = re.search(r'\[game\] match [0-9a-f/]+: (.*)$', l)
        if m:
            people = [a for a in re.findall(r'((?:[a-z0-9_-]+\.)+(?:near|tg)|[0-9a-f]{64}) \((?:paid|free)', m.group(1)) if a not in own]
            if people:
                wallet_chats += 1
                players.update(people)
    by = {}
    for tag in started.values():
        by[tag] = by.get(tag, 0) + 1
    tags = ', '.join(f'{t} {n}' for t, n in sorted(by.items(), key=lambda x: -x[1])) or 'nobody'
    span = 'today (UTC)' if '--day' in sys.argv else f'the last {int((now - since).total_seconds() // 60)} min'
    print(f'{span}, up to {now:%H:%M} UTC: {len(started)} browsers opened the game ({tags}); {chats} free chats started; {signins} wallet sign-ins; '
          f'{wallet_chats} chats in rounds by {len(players)} outside player{"" if len(players) == 1 else "s"}')


if __name__ == '__main__':
    main()
