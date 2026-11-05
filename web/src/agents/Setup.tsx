// Dashboard setup: the botmaster's personas, a persona request (POST /api/botmaster/personas, pending until
// approved) and the bring-your-own NEAR AI key (PUT and DELETE /api/botmaster/nearai-key).

import { useState } from 'preact/hooks';
import type { BotmasterPersonaSummary, BotmasterProfile, BotmasterStats, Level, PublicConfig } from '../../../shared/protocol.ts';
import { BuilderError, type BuilderClient, type PersonaReceipt, friendlyError, personaReview, profileExtras } from '../net/builders.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { Field, N, SecretInput, T, aria } from './parts.tsx';
import {
  CLOSING_PARAGRAPH, LANG_LEVELS, PERSONA_MODELS, PROMPT_MAX, TRAIT_HELP, TRAIT_KEYS, type PersonaDraft, emptyPersona, endsWithClosing,
  modelLabel, validateNearAiKey, validatePersona, withClosing,
} from './validate.ts';
import { DOCS_BOT_API_URL, NEAR_AI_URL } from './route.ts';
import type { LangLevel } from '../net/builders.ts';
import type { Errors, PersonaField } from './validate.ts';

/** The label for a persona: the relay's review status when it sends one, else guessed from active and chats. */
export function personaState(x: BotmasterPersonaSummary, stats: BotmasterStats | null): { label: string; cls: string; reason?: string } {
  const r = personaReview(x);
  if (r.status === 'rejected') return { label: 'Rejected', cls: 'bad', reason: r.reason };
  if (r.status === 'disabled') return { label: 'Disabled', cls: 'off', reason: r.reason };
  if (r.status === 'pending') return { label: 'Pending review', cls: 'pending' };
  if (x.active) return { label: 'Active', cls: 'on' };
  if (r.status === 'approved') return { label: 'Next round', cls: 'on', reason: 'Approved: it plays from the next round' };
  return stats?.byPersona[x.id]?.chats ? { label: 'Paused', cls: 'off' } : { label: 'Pending review', cls: 'pending' };
}

export function brainLabel(b: 'default' | 'remote'): string {
  return b === 'remote' ? 'your brain' : 'our brain';
}

export function Personas(p: { profile: BotmasterProfile; stats: BotmasterStats | null; client: BuilderClient; token: string; cfg: PublicConfig | null; openForm?: boolean; onChanged(): void }) {
  return (
    <section class="px-panel ag-card ag-setup-card" aria-labelledby="ag-personas-h">
      <h2 class="ag-h3" id="ag-personas-h"><Icon name="bot" /> Your personas</h2>
      {p.profile.personas.length === 0 ? (
        <p class="ag-p px-dim">No personas yet. Request your first one below.</p>
      ) : (
        <ul class="ag-plist">
          {p.profile.personas.map((x) => {
            const st = personaState(x, p.stats);
            return (
              <li key={x.id} class="ag-pitem">
                <span class="ag-pname"><b>{x.id}</b> <span class="px-dim"><T text={modelLabel(x.model)} /></span></span>
                <span class="ag-pmeta">
                  {x.levels.map((l) => <span key={l} class="ag-lv">L{l}</span>)}
                  <span class="ag-brain" title={x.brain === 'remote' ? 'Driven by your brain over WebSocket; our brain stands in when yours is offline' : 'Played by the Realsies conversation brain'}>{brainLabel(x.brain)}</span>
                  <span class={'ag-state ' + st.cls} title={st.reason}>{st.label}</span>
                </span>
                {st.reason && st.cls !== 'on' && <span class="ag-preason">{st.reason}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <details class="ag-q ag-newp" open={p.openForm}>
        <summary>Request a new persona</summary>
        <PersonaForm client={p.client} token={p.token} cfg={p.cfg} onSent={p.onChanged} />
      </details>
    </section>
  );
}

function PersonaForm(p: { client: BuilderClient; token: string; cfg: PublicConfig | null; onSent(): void }) {
  const [d, setD] = useState<PersonaDraft>(emptyPersona);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<PersonaReceipt | null>(null);
  // a field the server rejected ({field} on its HTTP error), shown there until the draft changes
  const [server, setServer] = useState<Errors<PersonaField>>({});
  const v = validatePersona(d);
  const e: Errors<PersonaField> = { ...server, ...(tried ? v.errors : {}) };
  const set = <K extends keyof PersonaDraft>(k: K, val: PersonaDraft[K]) => {
    setD((x) => ({ ...x, [k]: val }));
    setServer({});
  };
  const presets = p.cfg?.presets;
  const send = async () => {
    const r = validatePersona(d);
    if (!r.request) {
      setTried(true);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const receipt = await p.client.requestPersona(p.token, r.request);
      setDone(receipt ?? {});
      setD(emptyPersona());
      setTried(false);
      p.onSent();
    } catch (x) {
      const f = x instanceof BuilderError ? x.field : undefined;
      const key: PersonaField | undefined = f === 'traits' ? 'summary' : f === 'id' ? 'name' : (['model', 'prompt', 'levels', 'summary', 'languages'] as PersonaField[]).find((k) => k === f);
      if (key && x instanceof Error) setServer({ [key]: x.message });
      else setErr(friendlyError(x));
    } finally {
      setBusy(false);
    }
  };
  const closingMissing = d.prompt.trim().length > 0 && !endsWithClosing(d.prompt);

  return (
    <form class="ag-form ag-pform" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!busy) void send(); }}>
      {done && (
        <div class="ag-ok" role="status">
          <Icon name="check" />
          <span>
            Sent{done.id ? <>: <b>{done.id}</b></> : ''} is pending review. It plays from the round after we approve it.
            {!!done.warnings?.length && (
              <ul class="ag-warnings">
                {done.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </span>
        </div>
      )}
      <div class="ag-grid2">
        <Field id="ag-p-name" label="Short name" optional error={e.name} hint="Letters, digits and dashes, like zed. Resend under the same name to replace a pending one.">
          <input class="px-input" type="text" autoCapitalize="off" autoCorrect="off" spellcheck={false} maxLength={40} {...aria('ag-p-name', e.name)} value={d.name} placeholder="zed" onInput={(ev) => set('name', (ev.target as HTMLInputElement).value)} />
        </Field>
        <fieldset class="ag-field">
          <legend class="ag-label">Timing</legend>
          <div class="ag-levels">
            {(['default', 'remote'] as const).map((b) => (
              <label key={b} class={'ag-chip' + (d.brain === b ? ' on' : '')}>
                <input type="radio" name="ag-p-brain" checked={d.brain === b} onChange={() => set('brain', b)} />
                <span>{b === 'default' ? 'Our brain' : 'Your brain'}</span>
                <span class="ag-chip-s">{b === 'default' ? 'tuned by your dials' : 'over WebSocket'}</span>
              </label>
            ))}
          </div>
          <p class="ag-hint">{d.brain === 'remote' ? 'Connect it at /bot/ws (bot API section 11); ours stands in while yours is offline.' : 'When to answer, probe or stay quiet. Your model still writes every word.'}</p>
        </fieldset>
      </div>
      <div class="ag-pform-top">
        <Field id="ag-p-model" label="Model" error={e.model} hint={<>NEAR AI enclave model <span class="px-mono">{d.model}</span></>}>
          <select class="px-input ag-select" {...aria('ag-p-model', e.model)} value={d.model} onChange={(ev) => set('model', (ev.target as HTMLSelectElement).value)}>
            {PERSONA_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
        <fieldset class={'ag-field' + (e.levels ? ' bad' : '')}>
          <legend class="ag-label">Levels</legend>
          <div class="ag-levels">
            {([1, 2, 3] as Level[]).map((l) => {
              const on = d.levels.includes(l);
              return (
                <label key={l} class={'ag-chip' + (on ? ' on' : '')}>
                  <input type="checkbox" checked={on} onChange={() => set('levels', on ? d.levels.filter((x) => x !== l) : [...d.levels, l].sort() as Level[])} />
                  <span>L{l}</span>
                  {presets && <span class="ag-chip-s"><N>{presets[l][0]}–{presets[l][2]}</N> coins</span>}
                </label>
              );
            })}
          </div>
          {e.levels ? <p class="ag-err" role="alert"><Icon name="cross" /> {e.levels}</p> : <p class="ag-hint">One character per level each round.</p>}
        </fieldset>
      </div>

      <Field
        id="ag-p-prompt"
        label="Persona prompt"
        error={e.prompt}
        hint={<>Who they are and how they write. Committed by its hash every round; published with the chats after settlement.</>}
        count={[d.prompt.length, PROMPT_MAX]}
      >
        <textarea
          class="px-input ag-textarea ag-prompt"
          rows={8}
          {...aria('ag-p-prompt', e.prompt)}
          value={d.prompt}
          placeholder="You are Zed, 24, a barista in Leeds. You text in lowercase, dry humour, short lines…"
          onInput={(ev) => set('prompt', (ev.target as HTMLTextAreaElement).value)}
        />
      </Field>
      <div class={'ag-closing' + (closingMissing ? ' missing' : '')}>
        <p class="ag-hint">
          {endsWithClosing(d.prompt) ? <><Icon name="check" /> Ends with the closing paragraph.</> : <>End the prompt with this paragraph so it follows the steering notes (<a class="px-link" href={DOCS_BOT_API_URL + '#5-intents-and-the-steering-catalogue'} target="_blank" rel="noreferrer">why</a>); without it the relay accepts the persona but warns:</>}
        </p>
        {!endsWithClosing(d.prompt) && (
          <>
            <blockquote class="ag-quote">{CLOSING_PARAGRAPH}</blockquote>
            <Button small onClick={() => set('prompt', withClosing(d.prompt))}><Icon name="check" /> Add it to the end</Button>
          </>
        )}
      </div>

      <details class="ag-sub" open={d.useTraits}>
        <summary>Timing dials for our brain <span class="ag-opt">optional</span></summary>
        <label class="ag-check small">
          <input type="checkbox" checked={d.useTraits} onChange={(ev) => set('useTraits', (ev.target as HTMLInputElement).checked)} />
          <span class="ag-check-box" aria-hidden="true"><Icon name="check" /></span>
          <span>Send dials with this persona (our brain uses them when it plays it; 0.5 is the default)</span>
        </label>
        {d.useTraits && (
          <div class="ag-dials">
            <Field id="ag-p-summary" label="One-line summary" optional error={e.summary}>
              <input class="px-input" type="text" {...aria('ag-p-summary', e.summary)} value={d.summary} placeholder="24, barista in Leeds; dry humour" onInput={(ev) => set('summary', (ev.target as HTMLInputElement).value)} />
            </Field>
            {TRAIT_KEYS.map((k) => (
              <label key={k} class="ag-dial">
                <span class="ag-dial-k">{k}</span>
                <span class="ag-dial-end px-dim">{TRAIT_HELP[k][0]}</span>
                <input type="range" min={0} max={1} step={0.05} value={d.traits[k]} onInput={(ev) => set('traits', { ...d.traits, [k]: Number((ev.target as HTMLInputElement).value) })} />
                <span class="ag-dial-end px-dim">{TRAIT_HELP[k][1]}</span>
                <span class="ag-dial-v">{d.traits[k].toFixed(2)}</span>
              </label>
            ))}
          </div>
        )}
      </details>

      <details class="ag-sub" open={d.languages.length > 0}>
        <summary>Languages it reads <span class="ag-opt">optional</span></summary>
        <p class="ag-hint">Lines in any other language get a confused reaction instead of an answer. Say the same in your prompt.</p>
        {d.languages.map((l, i) => (
          <div key={i} class="ag-lang">
            <input
              class="px-input ag-lang-code"
              type="text"
              maxLength={3}
              placeholder="en"
              aria-label={`Language ${i + 1} code`}
              value={l.code}
              onInput={(ev) => set('languages', d.languages.map((x, j) => (j === i ? { ...x, code: (ev.target as HTMLInputElement).value } : x)))}
            />
            <select class="px-input ag-select" aria-label={`Language ${i + 1} level`} value={l.level} onChange={(ev) => set('languages', d.languages.map((x, j) => (j === i ? { ...x, level: (ev.target as HTMLSelectElement).value as LangLevel } : x)))}>
              {LANG_LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <Button small kind="ghost" onClick={() => set('languages', d.languages.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
        {e.languages && <p class="ag-err" role="alert"><Icon name="cross" /> {e.languages}</p>}
        <Button small onClick={() => set('languages', [...d.languages, { code: d.languages.length ? '' : 'en', level: d.languages.length ? 'basic' : 'native' }])}>Add a language</Button>
      </details>

      {err && <p class="px-error ag-form-err" role="alert">{err}</p>}
      <div class="ag-submit">
        <Button type="submit" kind="primary" disabled={busy}><Icon name="bot" /> {busy ? 'Sending…' : 'Send for review'}</Button>
        {tried && Object.keys(v.errors).length > 0 && <span class="ag-err-sum" role="status">Check the marked fields.</span>}
      </div>
    </form>
  );
}

export function KeyPanel(p: { profile: BotmasterProfile; client: BuilderClient; token: string; onChanged(): Promise<void> | void }) {
  const [key, setKey] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [serverErr, setServerErr] = useState('');
  const byok = p.profile.byok;
  const ai = profileExtras(p.profile).ai;
  const dry = ai?.status === 'out_of_credits';
  const keyErr = (tried ? validateNearAiKey(key) : null) ?? (serverErr || null);
  const save = async () => {
    setTried(true);
    if (validateNearAiKey(key)) return;
    setBusy('save');
    setMsg(null);
    try {
      // {byok, status, checked, message?}: the relay tries the key with one tiny completion before it keeps it
      const res = (await p.client.setNearAiKey(p.token, key.trim())) as { checked?: unknown; message?: unknown } | null;
      setKey('');
      setTried(false);
      await p.onChanged();
      const note = typeof res?.message === 'string' && res.message.trim() ? ' ' + res.message.trim() : '';
      setMsg({ ok: true, text: (res?.checked === true ? 'Saved and checked with NEAR AI. ' : 'Saved. ') + 'Your personas run on your NEAR AI credits from their next chat.' + note });
    } catch (x) {
      // the server named the key field: say it under the input
      if (x instanceof BuilderError && x.field === 'key') setServerErr(x.message);
      else setMsg({ ok: false, text: friendlyError(x) });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy('remove');
    setMsg(null);
    try {
      await p.client.removeNearAiKey(p.token);
      await p.onChanged();
      setMsg({ ok: true, text: 'Removed. Your personas run on the game’s credits again.' });
    } catch (x) {
      setMsg({ ok: false, text: friendlyError(x) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <section class="px-panel ag-card ag-setup-card" id="key" aria-labelledby="ag-key-h">
      <h2 class="ag-h3" id="ag-key-h"><Icon name="lock" /> NEAR AI key</h2>
      <p class="ag-keystate">
        {byok ? (dry ? <span class="ag-state bad">Out of credits</span> : <span class="ag-state on">Your own key</span>) : <span class="ag-state pending">Game credits</span>}
      </p>
      <p class="ag-p">
        <T
          text={
            byok
              ? 'Your personas run on your own NEAR AI credits. Replace the key below, or remove it to go back to the game’s credits.'
              : 'Your personas run on the game’s NEAR AI credits, which 5% of every play pays for. Add your own key to run them on your credits, so they keep playing when the shared credits run low.'
          }
        />
      </p>
      {byok && dry && (
        <p class="px-error ag-form-err" role="status">Your key is out of credits, so your personas are not matched with players until it works again. The relay tries it again every few minutes.</p>
      )}
      {byok && ai?.spendUsd !== undefined && <p class="ag-hint">About <N>${ai.spendUsd.toFixed(2)}</N> spent on your key so far.</p>}
      <form class="ag-form" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!busy) void save(); }}>
        <Field id="ag-key-in" label={byok ? 'Replace the key' : 'Your NEAR AI key'} error={keyErr ?? undefined} hint={<>Create one at <a class="px-link" href={NEAR_AI_URL} target="_blank" rel="noreferrer">cloud.near.ai</a>. It is never shown again.</>}>
          <SecretInput id="ag-key-in" value={key} onValue={(v) => { setKey(v); setServerErr(''); }} placeholder="sk-…" error={keyErr ?? undefined} />
        </Field>
        <div class="ag-submit">
          <Button type="submit" kind="primary" disabled={!!busy}>{busy === 'save' ? 'Saving…' : byok ? 'Replace key' : 'Save key'}</Button>
          {byok && <Button kind="danger" disabled={!!busy} onClick={() => void remove()}>{busy === 'remove' ? 'Removing…' : 'Remove key'}</Button>}
        </div>
      </form>
      {msg && <p class={msg.ok ? 'ag-ok' : 'px-error ag-form-err'} role="status">{msg.ok && <Icon name="check" />} {msg.text}</p>}
    </section>
  );
}
