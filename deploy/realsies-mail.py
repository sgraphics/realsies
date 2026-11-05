#!/usr/bin/env python3
"""Root-only sender for the relay's operator emails (relay/src/agents/notify.ts).

The relay runs as `realsies` and holds no mail credentials: it drops JSON files into the outbox. This script, run by
realsies-mail.service whenever realsies-mail.path sees a file, sends each through Amazon SES with root's AWS CLI
profile. A file can only mail AGENT_NOTIFY_EMAIL (read from /opt/realsies/.env, never sourced) from an address at
@realsies.lol, with bounded size and count, so a compromised relay cannot use SES for anything else.
"""
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time

APP = "/opt/realsies"
# root:realsies 1730: the relay can drop files in but cannot list, replace or symlink the directory (deploy.sh makes it)
OUTBOX = "/var/spool/realsies-mail"
ENV_FILE = f"{APP}/.env"
FROM_DOMAIN = "@realsies.lol"
MAX_PER_RUN = 20
MAX_SUBJECT = 200
MAX_TEXT = 20000


def operator_address() -> str:
    try:
        for line in open(ENV_FILE, encoding="utf-8"):
            m = re.match(r"\s*AGENT_NOTIFY_EMAIL\s*=\s*(\S+)\s*$", line)
            if m:
                return m.group(1).strip("'\"")
    except OSError:
        pass
    return ""


def address_of(field: str) -> str:
    m = re.search(r"<([^<>\s]+)>\s*$", field)
    return (m.group(1) if m else field).strip().lower()


def send(mail: dict, to: str) -> str:
    sender = str(mail.get("from", ""))
    if not address_of(sender).endswith(FROM_DOMAIN):
        raise ValueError(f"sender {sender!r} is not at {FROM_DOMAIN}")
    if address_of(str(mail.get("to", ""))) != to.lower():
        raise ValueError("recipient is not the operator address")
    subject = str(mail.get("subject", ""))[:MAX_SUBJECT].replace("\n", " ")
    text = str(mail.get("text", ""))[:MAX_TEXT]
    if not subject or not text:
        raise ValueError("empty subject or text")
    content = {"Simple": {"Subject": {"Data": subject, "Charset": "UTF-8"}, "Body": {"Text": {"Data": text, "Charset": "UTF-8"}}}}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(content, f)
        content_path = f.name
    try:
        args = ["aws", "sesv2", "send-email", "--from-email-address", sender, "--destination", json.dumps({"ToAddresses": [to]}),
                "--content", f"file://{content_path}", "--query", "MessageId", "--output", "text"]
        reply_to = str(mail.get("replyTo", "")).strip()
        if reply_to and re.fullmatch(r"[^@\s<>,]+@[^@\s<>,]+\.[^@\s<>,]+", reply_to):
            args += ["--reply-to-addresses", reply_to]
        out = subprocess.run(args, capture_output=True, text=True, timeout=30)
        if out.returncode != 0:
            raise RuntimeError(out.stderr.strip().splitlines()[-1] if out.stderr.strip() else f"aws exit {out.returncode}")
        return out.stdout.strip()
    finally:
        os.unlink(content_path)


def main() -> int:
    to = operator_address()
    if not os.path.isdir(OUTBOX):
        return 0
    for sub in ("sent", "failed"):  # root-only, made by deploy.sh; refuse anything else
        st = os.lstat(f"{OUTBOX}/{sub}")
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0:
            print(f"{OUTBOX}/{sub} is not a root-owned directory; not sending", file=sys.stderr)
            return 1
    files = sorted(n for n in os.listdir(OUTBOX) if n.endswith(".json") and not n.startswith("."))
    for n, name in enumerate(files):
        src = f"{OUTBOX}/{name}"
        if n >= MAX_PER_RUN:
            print(f"more than {MAX_PER_RUN} emails queued; the rest wait for the next run")
            time.sleep(60)  # the path unit fires again while files remain; this paces a flood
            break
        try:
            if not to:
                raise ValueError(f"AGENT_NOTIFY_EMAIL is not set in {ENV_FILE}")
            st = os.lstat(src)
            if not stat.S_ISREG(st.st_mode):
                raise ValueError("not a regular file")
            if st.st_size > 64 * 1024:
                raise ValueError("file too large")
            fd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, encoding="utf-8") as f:
                mail = json.load(f)
            msg_id = send(mail, to)
            os.replace(src, f"{OUTBOX}/sent/{name}")
            print(f"sent {name} to {to}: SES message {msg_id}")
        except Exception as e:  # one bad file never blocks the rest
            os.replace(src, f"{OUTBOX}/failed/{name}")
            print(f"failed {name}: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
