// Verify drawer: every check recomputed in this browser from the bundle's raw bytes, and at the top
// the persona card of who the bot was playing when the bundle carries one.

import { useEffect, useMemo, useState } from 'preact/hooks';
import type { VerifyBundle } from '../../../shared/protocol.ts';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { accountUrl, fmtDateTime, shortHash, txUrl } from '../state/format.ts';
import { loadTranscript } from '../net/transcript.ts';
import { type CheckGroup, type CheckStatus, analyzeCompletion, runChecks, summarize } from '../verify/checks.ts';
import { sha256Hex } from '../verify/crypto.ts';
import { Button, Icon, Panel } from '../ui/kit.tsx';
import { PersonaReveal } from '../ui/PersonaCard.tsx';

export interface VerifyProps {
  store: Store;
  chatId: string;
  onClose(): void;
}

const MARK: Record<CheckStatus, string> = { pass: 'pass', fail: 'fail', na: 'n/a' };

function StatusMark({ s }: { s: CheckStatus }) {
  return (
    <span class={'px-check-mark ' + s} aria-label={MARK[s]}>
      {s === 'pass' ? <Icon name="check" /> : s === 'fail' ? <Icon name="cross" /> : '–'}
    </span>
  );
}

function Group({ g }: { g: CheckGroup }) {
  return (
    <section class={'px-check-group ' + g.status}>
      <h3 class="px-row">
        <StatusMark s={g.status} /> {g.title}
      </h3>
      <ul>
        {g.checks.map((c) => (
          <li key={c.id} class={'px-check ' + c.status}>
            <StatusMark s={c.status} />
            <span class="px-check-label">{c.label}</span>
            {c.detail && <span class="px-check-detail px-dim">{c.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TxLink({ label, tx, cfgUrl }: { label: string; tx?: string; cfgUrl?: string }) {
  if (!tx) return null;
  return (
    <a class="px-link" href={cfgUrl} target="_blank" rel="noreferrer">
      {label} {shortHash(tx, 5)} <Icon name="link" />
    </a>
  );
}

function KV({ k, children }: { k: string; children: preact.ComponentChildren }) {
  return (
    <div class="px-kv">
      <span class="px-dim">{k}</span>
      <span class="px-mono px-break">{children}</span>
    </div>
  );
}

export function VerifyDrawer(p: VerifyProps) {
  const st = useStore(p.store);
  const cfg = st.config;
  const [bundle, setBundle] = useState<VerifyBundle | null>(null);
  const [err, setErr] = useState('');
  const [raw, setRaw] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setBundle(null);
    setErr('');
    p.store.actions
      .getVerify(p.chatId)
      .then((b) => live && setBundle(b))
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [p.chatId, p.store]);

  const local = useMemo(() => loadTranscript(p.chatId), [p.chatId]);
  const groups = useMemo(() => (bundle ? runChecks(bundle, { localTranscript: local }) : []), [bundle, local]);
  const reports = useMemo(() => (bundle ? bundle.completions.map((c) => analyzeCompletion(c, bundle)) : []), [bundle]);
  const sum = summarize(groups);
  const tx = (h?: string) => txUrl(cfg, h);

  return (
    <div class="px-drawer px-verify" role="dialog" aria-modal="true" aria-label="Verify this chat">
      <Panel class="px-drawer-panel">
        <div class="px-row px-head">
          <h2 class="px-title">
            <Icon name="shield" /> Verify this chat
          </h2>
          <Button small kind="ghost" onClick={p.onClose}>
            Close
          </Button>
        </div>
        {bundle?.persona && (
          <section class="px-verify-section px-verify-persona">
            <h3>Who you talked to</h3>
            <div class="px-row px-wrap">
              <span class="px-tag bot">BOT</span>
              <span class="px-mono">{bundle.model}</span>
            </div>
            <PersonaReveal p={bundle.persona} />
          </section>
        )}
        <p class="px-sub">
          Every bot reply was signed inside a NEAR AI enclave. Your browser now re-checks each signature, the hashes of the exact
          request and reply bytes, the commitment the game put on chain before you played, and your own copy of the chat. Nothing on
          this page is taken on trust from the game.
        </p>
        {err && <p class="px-error">{err}</p>}
        {!bundle && !err && <p class="px-dim">Fetching the signed record…</p>}
        {bundle && (
          <>
            <div class={'px-verdict ' + (sum.fail ? 'fail' : 'pass')}>
              {sum.fail ? <Icon name="cross" /> : <Icon name="check" />}{' '}
              {sum.fail ? `${sum.fail} check${sum.fail === 1 ? '' : 's'} failed` : `All ${sum.pass} checks pass`}
              {sum.na ? <span class="px-dim"> · {sum.na} not applicable</span> : null}
            </div>
            {bundle.attestation.note && <p class="px-note px-small">{bundle.attestation.note}</p>}

            <div class="px-check-groups">
              {groups.map((g) => (
                <Group key={g.id} g={g} />
              ))}
            </div>

            <section class="px-verify-section">
              <h3>Model and enclave</h3>
              <KV k="Model">{bundle.model}</KV>
              {bundle.attestation.signers.map((s) => (
                <KV key={s.address} k="Enclave signer">
                  {s.address}
                </KV>
              ))}
              {bundle.attestation.gatewaySigner && <KV k="Gateway signer">{bundle.attestation.gatewaySigner}</KV>}
              <KV k="Attestation nonce">{bundle.attestation.nonce}</KV>
              <KV k="Fetched">{fmtDateTime(bundle.attestation.fetchedAt)}</KV>
            </section>

            <section class="px-verify-section">
              <h3>Commitment</h3>
              <p class="px-dim px-small">Put on chain at round start, before any play counted. Opened at round end.</p>
              <pre class="px-pre">{bundle.commitment.preimage}</pre>
              <KV k="sha256">{bundle.commitment.hash}</KV>
              <KV k="Payout">
                <a class="px-link" href={accountUrl(cfg, bundle.opening.payout)} target="_blank" rel="noreferrer">
                  {bundle.opening.payout}
                </a>
              </KV>
              <div class="px-row px-wrap px-small">
                <TxLink label="commit" tx={bundle.commitment.commitTx} cfgUrl={tx(bundle.commitment.commitTx)} />
                <TxLink label="open" tx={bundle.opening.openTx} cfgUrl={tx(bundle.opening.openTx)} />
              </div>
            </section>

            <section class="px-verify-section">
              <h3>System prompt</h3>
              <pre class="px-pre">{bundle.personaPrompt}</pre>
              <KV k="sha256">{sha256Hex(bundle.personaPrompt)}</KV>
              <KV k="Committed">{bundle.opening.promptHash}</KV>
              {bundle.skinMessage && (
                <>
                  <p class="px-dim px-small">Message 1, written for you only:</p>
                  <pre class="px-pre">{bundle.skinMessage}</pre>
                </>
              )}
              {bundle.handle && <KV k="Your handle">{bundle.handle}</KV>}
              {bundle.roundSecret && <KV k="Round secret">{bundle.roundSecret}</KV>}
            </section>

            <section class="px-verify-section">
              <h3>Every signed reply</h3>
              {reports.map((r, i) => {
                const c = bundle.completions[i];
                return (
                  <div key={r.completionId} class={'px-completion ' + (r.ok ? 'pass' : 'fail')}>
                    <div class="px-row">
                      <StatusMark s={r.ok ? 'pass' : 'fail'} />
                      <b>Reply {r.index + 1}</b>
                      <span class="px-dim px-small">{c.displayed.map((d) => `“${d}”`).join(' ') || '(nothing shown)'}</span>
                    </div>
                    <KV k="Request sha256">{r.requestHash}</KV>
                    <KV k="Response sha256">{r.responseHash}</KV>
                    <KV k="Signed text">{c.signature?.text ?? '(no signature)'}</KV>
                    <KV k="Signature">{c.signature ? shortHash(c.signature.signature, 14) : '–'}</KV>
                    <KV k="Recovered signer">{r.recovered ?? '–'}</KV>
                    <Button small kind="ghost" onClick={() => setRaw(raw === i ? null : i)}>
                      {raw === i ? 'Hide raw bytes' : 'Show raw bytes'}
                    </Button>
                    {raw === i && (
                      <>
                        <p class="px-dim px-small">Request, exactly as sent to the enclave:</p>
                        <pre class="px-pre px-raw">{c.request}</pre>
                        <p class="px-dim px-small">Response, exactly as received:</p>
                        <pre class="px-pre px-raw">{c.response}</pre>
                      </>
                    )}
                  </div>
                );
              })}
              {!reports.length && <p class="px-dim">The bot never replied in this chat.</p>}
            </section>

            <section class="px-verify-section">
              <h3>On chain</h3>
              <div class="px-row px-wrap px-small">
                <TxLink label="play" tx={bundle.chain.playTx} cfgUrl={tx(bundle.chain.playTx)} />
                <TxLink label="call" tx={bundle.chain.callTx} cfgUrl={tx(bundle.chain.callTx)} />
                <TxLink label="reveal" tx={bundle.chain.revealTx} cfgUrl={tx(bundle.chain.revealTx)} />
                <TxLink label="open" tx={bundle.chain.openTx} cfgUrl={tx(bundle.chain.openTx)} />
                <TxLink label="settle" tx={bundle.chain.settleTx} cfgUrl={tx(bundle.chain.settleTx)} />
                {cfg && (
                  <a class="px-link" href={accountUrl(cfg, cfg.contractId)} target="_blank" rel="noreferrer">
                    contract {cfg.contractId} <Icon name="link" />
                  </a>
                )}
              </div>
              {!bundle.chain.playTx && !bundle.chain.settleTx && <p class="px-dim px-small">No transactions are linked to this chat.</p>}
            </section>
          </>
        )}
      </Panel>
    </div>
  );
}
