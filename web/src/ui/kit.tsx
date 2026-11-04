// Pixel UI kit: thin components over the CSS classes in styles.css. Owner: UI shell.
// Class vocabulary (stable): .px-panel .px-btn .px-btn.primary .px-btn.danger .px-btn.small .px-btn.ghost
// .px-row .px-col .px-title .px-sub .px-dim .px-tag .px-check.pass/.fail/.na .px-mono .px-link .px-badge
import type { ComponentChildren, CSSProperties } from 'preact';
import { icon } from '../../../art/src/ui/icons.ts';
import { toDataURL } from '../../../art/src/browser/index.ts';

export function Panel(p: { children?: ComponentChildren; class?: string; style?: CSSProperties }) {
  return <div class={'px-panel ' + (p.class ?? '')} style={p.style}>{p.children}</div>;
}

export function Button(p: {
  children?: ComponentChildren;
  onClick?: () => void;
  kind?: 'primary' | 'danger' | 'good' | 'ghost' | 'default';
  small?: boolean;
  disabled?: boolean;
  class?: string;
  title?: string;
  type?: 'button' | 'submit';
}) {
  const k = p.kind && p.kind !== 'default' ? ' ' + p.kind : '';
  return (
    <button type={p.type ?? 'button'} class={'px-btn' + k + (p.small ? ' small' : '') + ' ' + (p.class ?? '')} disabled={p.disabled} title={p.title} onClick={p.onClick}>
      {p.children}
    </button>
  );
}

export type IconName = 'coin' | 'clock' | 'star' | 'check' | 'cross' | 'shield' | 'lock' | 'bolt' | 'chat' | 'user' | 'bot' | 'link' | 'flame' | 'trophy';

/** Pixel icon from the art engine, as a cached data URL background. */
export function Icon(p: { name: IconName; size?: number; class?: string; title?: string }) {
  const url = iconUrl(p.name);
  const style = p.size ? { width: p.size + 'px', height: p.size + 'px', backgroundImage: `url("${url}")` } : { backgroundImage: `url("${url}")` };
  return <span class={'px-icon ' + (p.class ?? '')} title={p.title} role={p.title ? 'img' : undefined} aria-label={p.title} aria-hidden={p.title ? undefined : 'true'} style={style} />;
}

const ICON_URLS = new Map<string, string>();
export function iconUrl(name: IconName): string {
  let u = ICON_URLS.get(name);
  if (!u) {
    u = toDataURL(icon(name), 'icon:' + name);
    ICON_URLS.set(name, u);
  }
  return u;
}

/** "12 coins" with the coin icon; optional dollar label from usdPerCoin. */
export function Coins(p: { n: number; usdPerCoin?: number; signed?: boolean; class?: string }) {
  const s = p.signed && p.n > 0 ? '+' : '';
  const usd = p.usdPerCoin ? ` ($${(Math.abs(p.n) * p.usdPerCoin).toFixed(2)})` : '';
  return <span class={'px-coins ' + (p.class ?? '')}><Icon name="coin" /> {s}{p.n.toLocaleString('en-US')}{usd}</span>;
}
