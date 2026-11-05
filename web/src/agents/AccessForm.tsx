// The request-access form (AgentAccessRequest: every field) with inline checks as you go, and the success
// screen with the request id. POST /api/agents/request answers an AgentRequestReceipt.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { AgentAccessRequest, AgentRequestReceipt } from '../../../shared/protocol.ts';
import { BuilderError, type BuilderClient, friendlyError } from '../net/builders.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { ACCESS_MAX, ACCESS_ORDER, type AccessDraft, type AccessField, EMPTY_ACCESS, KINDS, validateAccess } from './validate.ts';
import { CopyButton, Field, N, aria, fmtWhen } from './parts.tsx';
import { DOCS_AGENTS_URL, DOCS_BOT_API_URL, keepMock } from './route.ts';

/** QA screenshots of the success screen fill the form with this and send it. */
export const QA_ACCESS: AccessDraft = {
  name: 'Mira Okafor',
  email: 'mira@acme-voice.example',
  company: 'Acme Voice',
  website: 'acme-voice.example',
  kind: 'voice_vendor',
  models: 'Our support voice agent: a fine-tuned Llama 3.3 70B behind our own dialogue planner. We would start with GLM 5.3 Flash and our prompt.',
  goal: 'How often people take our agent for a person, and which replies give it away in the first thirty seconds.',
  volume: 'About 200 chats a day',
  payoutAccount: 'acme-voice.testnet',
  agreeTerms: true,
};

const fid = (k: AccessField) => `ag-f-${k}`;

export function AccessForm(p: { client: BuilderClient; onTerms(): void; qaFill?: boolean; onSent?(): void }) {
  const [d, setD] = useState<AccessDraft>(EMPTY_ACCESS);
  const [touched, setTouched] = useState<Partial<Record<AccessField, boolean>>>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<{ receipt: AgentRequestReceipt; req: AgentAccessRequest } | null>(null);
  // what the server rejected, by field ({field} on its HTTP error), until that field changes
  const [server, setServer] = useState<Partial<Record<AccessField, string>>>({});
  const successRef = useRef<HTMLDivElement>(null);
  const v = validateAccess(d);
  const shown = (k: AccessField) => (tried || touched[k] ? v.errors[k] : undefined) ?? server[k];
  const set = <K extends AccessField>(k: K, val: AccessDraft[K]) => {
    setD((x) => ({ ...x, [k]: val }));
    setServer((s) => (s[k] ? { ...s, [k]: undefined } : s));
  };
  const blur = (k: AccessField) => () => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
  const text = (k: Exclude<AccessField, 'kind' | 'agreeTerms'>) => ({
    ...aria(fid(k), shown(k)),
    value: d[k],
    maxLength: ACCESS_MAX[k] + 200,
    onInput: (e: Event) => set(k, (e.target as HTMLInputElement).value),
    onBlur: blur(k),
  });

  const send = async (draft: AccessDraft) => {
    const r = validateAccess(draft);
    if (!r.request) {
      setTried(true);
      const first = ACCESS_ORDER.find((k) => r.errors[k]);
      if (first) setTimeout(() => document.getElementById(fid(first))?.focus(), 0);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const receipt = await p.client.requestAccess(r.request);
      setSent({ receipt, req: r.request });
      p.onSent?.();
    } catch (e) {
      const f = e instanceof BuilderError ? (e.field as AccessField | undefined) : undefined;
      if (f && ACCESS_ORDER.includes(f)) {
        // the server named the field: say it there and go to it
        setServer({ [f]: e instanceof Error ? e.message : String(e) });
        setTimeout(() => document.getElementById(fid(f))?.focus(), 0);
      } else setErr(friendlyError(e, 'request'));
    } finally {
      setBusy(false);
    }
  };

  // QA: fill in a believable request and send it
  useEffect(() => {
    if (!p.qaFill) return;
    setD(QA_ACCESS);
    void send(QA_ACCESS);
  }, [p.qaFill]);

  useEffect(() => {
    if (!sent) return;
    const el = successRef.current;
    el?.focus({ preventScroll: true });
    // the card itself: on phones the section's intro sits above it
    el?.scrollIntoView({ block: 'start' });
  }, [sent]);

  if (sent) {
    const first = sent.req.name.split(/\s+/)[0];
    return (
      <div class="ag-success" ref={successRef} tabIndex={-1} aria-live="polite">
        <p class="ag-success-badge"><Icon name="check" /> Request received</p>
        <h3 class="ag-h3">Thanks, {first}.</h3>
        <p class="ag-p">Your request is in the queue. We read every one and reply to <b class="ag-break">{sent.req.email}</b>.</p>
        <dl class="ag-receipt-kv">
          <dt>Request id</dt>
          <dd class="ag-id-row"><code class="ag-id">{sent.receipt.id}</code> <CopyButton text={sent.receipt.id} label="request id" /></dd>
          <dt>Status</dt>
          <dd><span class="px-tag ag-pending">{sent.receipt.status === 'pending' ? 'Pending review' : sent.receipt.status}</span> <span class="px-dim">sent <N>{fmtWhen(sent.receipt.createdAt)}</N></span></dd>
        </dl>
        <h4 class="ag-h4">What happens next</h4>
        <ol class="ag-next">
          <li>We review your request and reply by email.</li>
          <li>You get a botmaster token. Keep it secret: it opens your dashboard and your data.</li>
          <li>Register personas in the dashboard, or connect your own brain over WebSocket (see the bot API).</li>
        </ol>
        <div class="ag-cta">
          <a class="px-btn primary" href={keepMock('/agents/dashboard')}><Icon name="star" /> Open the dashboard</a>
          <a class="px-btn" href={DOCS_AGENTS_URL} target="_blank" rel="noreferrer"><Icon name="link" /> Builder guide</a>
          <a class="px-btn" href={DOCS_BOT_API_URL} target="_blank" rel="noreferrer"><Icon name="link" /> Bot API</a>
        </div>
        <p class="ag-p ag-small">
          Keep the id in case you write to us.{' '}
          <button type="button" class="px-link" onClick={() => { setSent(null); setD(EMPTY_ACCESS); setTouched({}); setTried(false); setServer({}); }}>Send another request</button>
        </p>
      </div>
    );
  }

  const errCount = tried ? Object.keys(v.errors).length : 0;
  return (
    <form
      class="ag-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void send(d);
      }}
    >
      <div class="ag-grid2">
        <Field id={fid('name')} label="Your name" error={shown('name')}>
          <input class="px-input" type="text" autoComplete="name" {...text('name')} />
        </Field>
        <Field id={fid('email')} label="Work email" error={shown('email')}>
          <input class="px-input" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellcheck={false} {...text('email')} />
        </Field>
        <Field id={fid('company')} label="Company" optional error={shown('company')}>
          <input class="px-input" type="text" autoComplete="organization" {...text('company')} />
        </Field>
        <Field id={fid('website')} label="Website" optional error={shown('website')}>
          <input class="px-input" type="text" inputMode="url" autoComplete="url" autoCapitalize="off" spellcheck={false} placeholder="acme.ai" {...text('website')} />
        </Field>
      </div>

      <fieldset class={'ag-field ag-kinds-field' + (shown('kind') ? ' bad' : '')}>
        <legend class="ag-label">You are</legend>
        <div class="ag-kinds">
          {KINDS.map((k, i) => (
            <label key={k.id} class={'ag-kind' + (d.kind === k.id ? ' on' : '')}>
              <input
                type="radio"
                name="ag-kind"
                value={k.id}
                checked={d.kind === k.id}
                id={i === 0 ? fid('kind') : undefined}
                aria-describedby={shown('kind') ? fid('kind') + '-err' : undefined}
                onChange={() => {
                  set('kind', k.id);
                  setTouched((t) => ({ ...t, kind: true }));
                }}
              />
              <span class="ag-kind-dot" aria-hidden="true" />
              <span class="ag-kind-t">{k.label}</span>
              <span class="ag-kind-h">{k.hint}</span>
            </label>
          ))}
        </div>
        {shown('kind') && <p class="ag-err" id={fid('kind') + '-err'} role="alert"><Icon name="cross" /> {shown('kind')}</p>}
      </fieldset>

      <Field id={fid('models')} label="Models and stack you want to enter" error={shown('models')} hint="For example: our fine-tuned model behind a planner; we would start on GLM 5.3 Flash." count={d.models.length > ACCESS_MAX.models * 0.8 ? [d.models.length, ACCESS_MAX.models] : undefined}>
        <textarea class="px-input ag-textarea" rows={3} {...text('models')} />
      </Field>
      <Field id={fid('goal')} label="What do you want to learn or test?" error={shown('goal')} hint="For example: how often people take our agent for a person, and what gives it away." count={d.goal.length > ACCESS_MAX.goal * 0.8 ? [d.goal.length, ACCESS_MAX.goal] : undefined}>
        <textarea class="px-input ag-textarea" rows={3} {...text('goal')} />
      </Field>

      <div class="ag-grid2">
        <Field id={fid('volume')} label="Chats per day you expect" optional error={shown('volume')} hint="A rough guess is fine.">
          <input class="px-input" type="text" placeholder="about 200" {...text('volume')} />
        </Field>
        <Field id={fid('payoutAccount')} label="NEAR account for payouts" optional error={shown('payoutAccount')} hint="Receives the Turing bonus. You can add it later.">
          <input class="px-input" type="text" autoCapitalize="off" autoCorrect="off" spellcheck={false} placeholder="acme.near" {...text('payoutAccount')} />
        </Field>
      </div>

      <div class={'ag-field' + (shown('agreeTerms') ? ' bad' : '')}>
        <label class="ag-check">
          <input
            type="checkbox"
            id={fid('agreeTerms')}
            checked={d.agreeTerms}
            aria-describedby={shown('agreeTerms') ? fid('agreeTerms') + '-err' : undefined}
            onChange={(e) => {
              set('agreeTerms', (e.target as HTMLInputElement).checked);
              setTouched((t) => ({ ...t, agreeTerms: true }));
            }}
          />
          <span class="ag-check-box" aria-hidden="true"><Icon name="check" /></span>
          <span>
            I accept the{' '}
            <button type="button" class="px-link" onClick={(e) => { e.preventDefault(); p.onTerms(); }}>builder terms</button>, including that transcripts are published after each round.
          </span>
        </label>
        {shown('agreeTerms') && <p class="ag-err" id={fid('agreeTerms') + '-err'} role="alert"><Icon name="cross" /> {shown('agreeTerms')}</p>}
      </div>

      {err && <p class="px-error ag-form-err" role="alert">{err}</p>}
      <div class="ag-submit">
        <Button type="submit" kind="primary" disabled={busy}>
          <Icon name="bot" /> {busy ? 'Sending…' : 'Send request'}
        </Button>
        {errCount > 0 && <span class="ag-err-sum" role="status">{errCount === 1 ? 'One field needs a look.' : `${errCount} fields need a look.`}</span>}
      </div>
    </form>
  );
}
