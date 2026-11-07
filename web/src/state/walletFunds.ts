// What a wallet can deposit (protocol v1.5 WalletInfo.walletBalance): the coins screen shows it and never
// offers a deposit that can only fail, and the store refuses one before any wallet popup.

import type { PublicConfig, WalletInfo } from '../../../shared/protocol.ts';

/** The coin's symbol as the coins screen says it: tREAL on testnet, REAL on mainnet. */
export function symbolOf(cfg: PublicConfig | undefined): string {
  return cfg?.network === 'testnet' ? cfg?.tokenSymbol ?? 'tREAL' : 'REAL';
}

/** Token base units as a short amount: 200, 3.5, 1,250.25 (at most 4 decimals, trailing zeros dropped). */
export function fmtTokens(units: bigint, decimals: number): string {
  const one = 10n ** BigInt(decimals);
  const whole = units / one;
  const frac4 = ((units % one) * 10_000n) / one;
  const fracText = frac4 > 0n ? '.' + frac4.toString().padStart(4, '0').replace(/0+$/, '') : '';
  return whole.toLocaleString('en-US') + fracText;
}

export interface DepositCheck {
  /** false: the deposit can only fail, do not send it */
  ok: boolean;
  /** 'empty': no coin in the wallet at all; 'short': less than the coins asked for */
  reason?: 'empty' | 'short';
  /** null when the relay could not say (an older relay, or the read failed): then nothing is blocked */
  walletUnits: bigint | null;
  /** whole coins the wallet can deposit */
  fits: bigint | null;
}

export function depositCheck(info: WalletInfo | undefined, coins: number, coinUnit: string | undefined): DepositCheck {
  if (!info || info.walletBalance === undefined || !coinUnit) return { ok: true, walletUnits: null, fits: null };
  let units: bigint;
  let unit: bigint;
  try {
    units = BigInt(info.walletBalance);
    unit = BigInt(coinUnit);
  } catch {
    return { ok: true, walletUnits: null, fits: null };
  }
  const fits = unit > 0n ? units / unit : 0n;
  if (units === 0n) return { ok: false, reason: 'empty', walletUnits: units, fits };
  const need = BigInt(Math.max(0, Math.floor(coins))) * unit;
  if (need > units) return { ok: false, reason: 'short', walletUnits: units, fits };
  return { ok: true, walletUnits: units, fits };
}

export function emptyWalletText(symbol: string): string {
  return `Your wallet has no ${symbol} yet.`;
}

export function shortWalletText(symbol: string, units: bigint, decimals: number, fits: bigint): string {
  return `Your wallet holds ${fmtTokens(units, decimals)} ${symbol}, enough for ${fits.toLocaleString('en-US')} coin${fits === 1n ? '' : 's'}.`;
}
