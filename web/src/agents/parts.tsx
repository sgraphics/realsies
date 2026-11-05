// Shared pieces of the AI-builder pages: the top bar, the footer, the fooled-share bar, the hero lineup
// of characters, form fields, the builder terms and the page scale.

import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ThemeId } from '../../../shared/protocol.ts';
import { Logo } from '../ui/Logo.tsx';
import { Button, Icon, Panel, type IconName } from '../ui/kit.tsx';
import { Portrait } from '../ui/Portrait.tsx';
import { useEscape, useRigs } from '../ui/hooks.ts';
import { gamertag } from '../../../shared/names.ts';
import { sha256Hex } from '../verify/crypto.ts';
import { prefersReducedMotion } from '../../../art/src/browser/index.ts';
import { DOCS_AGENTS_URL, DOCS_BOT_API_URL, REPO_URL, keepMock } from './route.ts';

// ---------------------------------------------------------------- page scale

/**
 * The UI pixel for the theme kit's 9-slice panels and buttons on these pages: whole device pixels, 1 CSS px
 * on most screens, 2 on very wide ones (the game derives it from the room's scale instead).
 */
export function pageUpx(w: number, dpr: number): number {
  const want = w >= 1800 ? 2 : 1;
  return Math.max(1, Math.round(want * dpr)) / dpr;
}

export function applyPageScale(): void {
  const set = () => {
    const dpr = window.devicePixelRatio || 1;
    const root = document.documentElement.style;
    root.setProperty('--upx', pageUpx(window.innerWidth, dpr) + 'px');
    root.setProperty('--px', (window.innerWidth >= 1800 ? 4 : 3) + 'px');
  };
  set();
  window.addEventListener('resize', set);
}

function useViewport(): { w: number; h: number } {
  const get = () => ({ w: typeof window !== 'undefined' ? window.innerWidth : 1280, h: typeof window !== 'undefined' ? window.innerHeight : 720 });
  const [v, setV] = useState(get);
  useEffect(() => {
    const on = () => setV(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

// ---------------------------------------------------------------- top bar and footer

export function TopBar(p: { label: string; testnet?: boolean; children?: ComponentChildren }) {
  const { w } = useViewport();
  return (
    <header class="ag-top">
      <div class="ag-wrap ag-top-in">
        <a class="ag-brand" href={keepMock('/')} title="Play Realsies">
          <Logo height={w >= 1800 ? 44 : w >= 700 ? 30 : 24} title="Realsies" />
        </a>
        <span class="ag-tag">{p.label}</span>
        {p.testnet && <span class="hud-net ag-net" title="Test network: test coins, no real value">TESTNET</span>}
        <nav class="ag-nav" aria-label="Pages">{p.children}</nav>
      </div>
    </header>
  );
}

export function Footer(p: { onTerms(): void }) {
  return (
    <footer class="ag-foot">
      <div class="ag-wrap ag-foot-in">
        <p class="ag-foot-brand">
          <b>Realsies</b> <span class="px-dim">· an 8-bit chat game on NEAR where people and AI agents meet and nobody knows who is who</span>
        </p>
        <ul class="ag-foot-links">
          <li><a class="px-link" href={keepMock('/')}>Play Realsies</a></li>
          <li><a class="px-link" href={keepMock('/agents')}>For AI builders</a></li>
          <li><a class="px-link" href={keepMock('/agents/dashboard')}>Dashboard</a></li>
          <li><a class="px-link" href={DOCS_AGENTS_URL} target="_blank" rel="noreferrer">Builder guide</a></li>
          <li><a class="px-link" href={DOCS_BOT_API_URL} target="_blank" rel="noreferrer">Bot API</a></li>
          <li><a class="px-link" href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a></li>
          <li><button type="button" class="px-link" onClick={p.onTerms}>Builder terms</button></li>
        </ul>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------- bars and numbers

export type BarTone = 'calls' | 'coins';

/**
 * A share from 0 to 1 as a thin bar with its value at the tip (one hue per measure: blue for calls,
 * clay for coin-weighted calls). `title` is the hover text, e.g. "12 of 31 calls said human".
 */
export function ShareBar(p: { value: number | null | undefined; tone?: BarTone; title?: string; small?: boolean }) {
  const v = p.value == null || !Number.isFinite(p.value) ? null : Math.max(0, Math.min(1, p.value));
  return (
    <span class={`ag-bar ${p.tone ?? 'calls'}${p.small ? ' small' : ''}${v === null ? ' none' : ''}`} title={p.title}>
      <span class="ag-bar-track" aria-hidden="true">
        {v !== null && v > 0 && <span class="ag-bar-fill" style={{ width: `${v * 100}%` }} />}
      </span>
      <span class="ag-bar-v">{v === null ? '–' : `${Math.round(v * 100)}%`}</span>
    </span>
  );
}

export function fmtShareOf(n: number, of: number, what: string): string {
  return of ? `${n} of ${of} ${what}` : `no ${what} yet`;
}

/** A number in running text, in the pixel font like the HUD's numbers (see .ag-n in agents.css). */
export function N(p: { children: ComponentChildren }) {
  return <span class="ag-n">{p.children}</span>;
}

/** Text whose numbers ("GLM 5.3 Flash", "5% of every play") are set in the pixel font, so 5 never reads as S. */
export function T(p: { text: string }) {
  const parts = p.text.split(/(\$?\d+(?:[.,:]\d+)*%?)/);
  return <>{parts.map((s, i) => (i % 2 ? <N key={i}>{s}</N> : s))}</>;
}

/** "52 of 127 calls" with legible numbers. */
export function ShareOf(p: { n: number; of: number; what: string }) {
  return p.of ? <><N>{p.n}</N> of <N>{p.of}</N> {p.what}</> : <>no {p.what} yet</>;
}

// ---------------------------------------------------------------- the hero lineup

const LINEUP_SIZE = 5;
/** Each character stands in a different room of the game; space is third, so every size shows it. */
const LINEUP_THEMES: ThemeId[] = ['jungle', 'castle', 'space', 'desert', 'cave'];

/** Five generated characters with short gamertags (so the tags fit under the smallest portraits). */
export function lineupSeeds(): { seed: string; name: string }[] {
  const out: { seed: string; name: string }[] = [];
  for (let i = 0; out.length < LINEUP_SIZE && i < 200; i++) {
    const seed = sha256Hex(`realsies:agents:lineup:${i}`);
    const name = gamertag(seed);
    if (name.length <= 8) out.push({ seed, name });
  }
  return out;
}

/** How many portraits fit and at what scale (device pixels per art pixel): five, else four, else three. */
export function lineupFit(w: number, vh: number, dpr: number): { n: number; k: number; gap: number } {
  const gap = w < 520 ? 6 : 14;
  const byH = Math.floor((Math.max(320, vh) * 0.3 * dpr) / 76);
  for (const n of [5, 4, 3]) {
    const byW = Math.floor(((w - (n - 1) * gap) * dpr) / (n * 64));
    const k = Math.min(byW, byH, Math.round(4 * dpr));
    if (k >= Math.max(2, Math.ceil(0.9 * dpr))) return { n, k, gap };
  }
  return { n: 3, k: Math.max(2, Math.ceil(0.9 * dpr)), gap };
}

export function Lineup() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const { h: vh } = useViewport();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => setW(el.clientWidth);
    on();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(on) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const seeds = useMemo(lineupSeeds, []);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const fit = lineupFit(w || 320, vh, dpr);
  const shown = seeds.slice(0, fit.n);
  const rigs = useRigs(shown.map((s) => s.seed));
  // now and then somebody waves or nods, like in the room
  useEffect(() => {
    if (prefersReducedMotion() || document.documentElement.classList.contains('qa')) return;
    const kinds = ['wave', 'nod', 'shrug', 'nod'] as const;
    let i = 0;
    const t = setInterval(() => {
      const r = rigs[Math.floor(Math.random() * rigs.length)];
      r?.react(kinds[i++ % kinds.length]);
    }, 2600);
    return () => clearInterval(t);
  }, [rigs.map((r) => r?.seed).join()]);
  const cssW = (64 * fit.k) / dpr;
  return (
    <figure class="ag-lineup-fig">
      <div ref={ref} class="ag-lineup" style={{ gap: fit.gap + 'px' }}>
        {w > 0 &&
          shown.map((s, i) => (
            <div key={s.seed} class="ag-lineup-item" style={{ width: cssW + 'px' }}>
              <Portrait theme={LINEUP_THEMES[i % LINEUP_THEMES.length]} rig={rigs[i]} height={(76 * fit.k) / dpr} class="ag-portrait" />
              <span class="name-tag ag-lineup-tag" style={{ fontSize: Math.max(11, Math.min(20, cssW / 6.2)) + 'px' }}>{s.name}</span>
            </div>
          ))}
      </div>
      <figcaption class="ag-caption">
        One of them is an AI agent. Players get two minutes with each, then call it: <b>real human?</b>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- forms

export function Field(p: { id: string; label: string; optional?: boolean; hint?: ComponentChildren; error?: string; children: ComponentChildren; class?: string; count?: [number, number] }) {
  return (
    <div class={'ag-field' + (p.error ? ' bad' : '') + (p.class ? ' ' + p.class : '')}>
      <label class="ag-label" for={p.id}>
        {p.label} {p.optional && <span class="ag-opt">optional</span>}
      </label>
      {p.children}
      {(p.hint || p.count) && !p.error && (
        <p class="ag-hint" id={p.id + '-hint'}>
          {p.hint && <span class="ag-hint-t">{p.hint}</span>}
          {p.count && <span class={'ag-count' + (p.count[0] > p.count[1] ? ' over' : '')}>{p.count[0]}/{p.count[1]}</span>}
        </p>
      )}
      {p.error && (
        <p class="ag-err" id={p.id + '-err'} role="alert">
          <Icon name="cross" /> {p.error}
        </p>
      )}
    </div>
  );
}

/** A token or key field with a Show/Hide toggle (monospace, no autofill, no autocorrect). */
export function SecretInput(p: { id: string; value: string; onValue(v: string): void; placeholder?: string; error?: string; hint?: boolean }) {
  const [show, setShow] = useState(false);
  // preact's input typings tie the attribute set to the type literal; both types take the same attributes here
  const type = (show ? 'text' : 'password') as 'text';
  return (
    <div class="ag-input-row">
      <input
        class="px-input ag-mono-input"
        type={type}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellcheck={false}
        {...aria(p.id, p.error, p.hint ?? true)}
        value={p.value}
        placeholder={p.placeholder}
        onInput={(e) => p.onValue((e.target as HTMLInputElement).value)}
      />
      <Button small onClick={() => setShow(!show)} title={show ? 'Hide' : 'Show what you typed'}>{show ? 'Hide' : 'Show'}</Button>
    </div>
  );
}

/** aria attributes for an input inside <Field>. */
export function aria(id: string, error?: string, hint = true): Record<string, string | boolean> {
  return { id, 'aria-invalid': error ? 'true' : 'false', 'aria-describedby': error ? id + '-err' : hint ? id + '-hint' : '' };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton(p: { text: string; label?: string }) {
  const [done, setDone] = useState<null | boolean>(null);
  return (
    <Button
      small
      onClick={() => {
        void copyText(p.text).then((ok) => {
          setDone(ok);
          setTimeout(() => setDone(null), 1800);
        });
      }}
      title={`Copy ${p.label ?? ''}`.trim()}
    >
      {done && <Icon name="check" />} {done === true ? 'Copied' : done === false ? 'Select and copy' : 'Copy'}
    </Button>
  );
}

// ---------------------------------------------------------------- builder terms

const TERMS: [IconName, string][] = [
  ['bot', 'Your agents play as characters in Realsies, a game: players chat with a character for two minutes and then call it, real human or bot. Nobody is told who was a bot until the round ends.'],
  ['shield', 'When a round settles its transcripts are public, so anyone can check who was a bot. Players are anonymised. A persona prompt is part of the proof, so it is published with the chats of that persona.'],
  ['check', 'We review every persona before it plays, and may pause it or revoke its botmaster if it harasses players, asks them for personal data, money or links, impersonates a real person or tries to break the game.'],
  ['chat', 'Your agents’ transcripts and scorecards are yours to use to improve your own agents and products.'],
  ['coin', 'The Turing bonus is paid in the game’s coins to your payout account when each round settles. On testnet they are test coins with no value.'],
  ['lock', 'Your botmaster token and your NEAR AI key are yours to keep secret. You can remove the key at any time.'],
  ['user', 'You are 18 or older and allowed to enter agents for the organisation you name.'],
];

export function BuilderTerms(p: { onClose(): void }) {
  useEscape(p.onClose);
  return (
    <div class="scrim ag-scrim" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <Panel class="modal narrow sheet-enter px-terms ag-terms" >
        <div class="px-row px-head">
          <h2 class="px-title">Builder terms, short version</h2>
          <Button small kind="ghost" onClick={p.onClose}>Back</Button>
        </div>
        <ul class="px-terms-list">
          {TERMS.map(([icon, text]) => (
            <li key={icon}><Icon name={icon} /> {text}</li>
          ))}
        </ul>
        <div class="px-row center">
          <Button kind="primary" onClick={p.onClose}>Got it</Button>
        </div>
      </Panel>
    </div>
  );
}

/** "5 Nov 14:05" */
export function fmtWhen(at: number | undefined): string {
  if (!at) return '–';
  const d = new Date(at);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "3 h ago", "2 d ago" */
export function fmtAgo(at: number | undefined, now = Date.now()): string {
  if (!at) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
