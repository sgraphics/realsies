// Display helpers shared by screens (no framework imports).

import type { PublicConfig } from '../../../shared/protocol.ts';

/** Coins rounded to 2 decimals, trailing zeros dropped. */
export function coins2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fmtCoins(n: number, signed = false): string {
  const v = coins2(n);
  const s = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v > 0) return (signed ? '+' : '') + s;
  if (v < 0) return '−' + s;
  return s;
}

export function fmtSigned(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0';
}

export function fmtPct(x: number | null | undefined): string {
  return x == null ? '–' : `${Math.round(x * 100)}%`;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDateTime(at: number): string {
  const d = new Date(at);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${fmtTime(at)}`;
}

export function txUrl(cfg: PublicConfig | undefined, hash: string | undefined): string | undefined {
  if (!cfg || !hash) return undefined;
  return cfg.explorerTx.replace('{hash}', encodeURIComponent(hash));
}

export function accountUrl(cfg: PublicConfig | undefined, account: string | undefined): string | undefined {
  if (!cfg || !account) return undefined;
  return cfg.explorerAccount.replace('{account}', encodeURIComponent(account));
}

export function shortHash(h: string, n = 8): string {
  if (!h) return '';
  return h.length > 2 * n + 1 ? `${h.slice(0, n)}…${h.slice(-n)}` : h;
}
