// NEAR amounts as the screens read and show them (yoctoNEAR, 24 decimals), and what coins are worth: in NEAR at the
// current price when the relay buys and sells coins on Rhea (PublicConfig.nearPerCoin, protocol v1.12), in dollars
// from the display constant otherwise (usdPerCoin).

import type { PublicConfig } from '../../../shared/protocol.ts';

export const ONE_NEAR = 10n ** 24n;

/** "1.25" -> yocto; null when it is not an amount. */
export function parseNear(s: string): bigint | null {
  const t = s.trim().replace(',', '.');
  if (!/^\d+(\.\d{0,24})?$/.test(t) && !/^\.\d{1,24}$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return BigInt(w || '0') * ONE_NEAR + BigInt((f + '0'.repeat(24)).slice(0, 24));
}

/** yocto -> "1.2345" (at most `digits` decimals, trailing zeros dropped). */
export function fmtNear(yocto: bigint, digits = 4): string {
  const neg = yocto < 0n;
  const v = neg ? -yocto : yocto;
  const scale = 10n ** BigInt(24 - digits);
  const r = (v + scale / 2n) / scale;
  const whole = r / 10n ** BigInt(digits);
  const frac = (r % 10n ** BigInt(digits)).toString().padStart(digits, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + whole.toLocaleString('en-US') + (frac ? '.' + frac : '');
}

/** A NEAR amount as a short number: 1,250 / 12.5 / 0.11 / 0.0025 (two significant digits under 1). */
export function fmtNearNum(near: number): string {
  const v = Math.abs(near);
  if (v === 0) return '0';
  if (v >= 1000) return Math.round(v).toLocaleString('en-US');
  if (v >= 1) return String(Number(v.toFixed(2)));
  return String(Number(v.toPrecision(2)));
}

/**
 * What `coins` are worth, the way the screens say it: "0.25 NEAR" at the current price when the coin trades on Rhea,
 * else "$2.50" from the display constant. One helper, so every screen says the same.
 */
export function coinValue(cfg: Pick<PublicConfig, 'nearPerCoin' | 'usdPerCoin'> | undefined, coins: number): string {
  const n = Math.abs(coins);
  if (cfg?.nearPerCoin) return `${fmtNearNum(n * cfg.nearPerCoin)} NEAR`;
  return `$${(n * (cfg?.usdPerCoin ?? 0.01)).toFixed(2)}`;
}
