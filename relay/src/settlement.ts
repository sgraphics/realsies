// Settlement math per docs/spec.md section 3, in exact integer base units (BigInt).
// The mock chain uses it, results use it to cross-check chain views, tests pin it.

export interface SettleParams {
  feeBps: bigint; // 500 = 5% of every play to the bot fund
  rightBps: bigint; // 7000 = 70% of wrong coins to the right callers
  characterBps: bigint; // 2000 = 20% of wrong coins to the character's payout account
}

export const DEFAULT_PARAMS: SettleParams = { feeBps: 500n, rightBps: 7000n, characterBps: 2000n };
const BPS = 10000n;

/** A play of `coins × coinUnit`: the fee goes to the fund, the rest is locked. */
export function splitPlay(amount: bigint, feeBps = DEFAULT_PARAMS.feeBps): { fee: bigint; locked: bigint } {
  const fee = (amount * feeBps) / BPS;
  return { fee, locked: amount - fee };
}

export interface SettlePlay {
  key: string; // handle
  account: string;
  locked: bigint;
  /** true = called human, false = called bot, null = no call (counts as wrong). */
  call: boolean | null;
}

export interface CharacterSettlement {
  rightCoins: bigint;
  wrongCoins: bigint;
  /** Credit per play key (locked returned plus reward, or 0 for a wrong play). */
  credits: Map<string, bigint>;
  payoutCredit: bigint;
  houseCredit: bigint;
}

export function isRight(kind: 'bot' | 'human', call: boolean | null): boolean {
  return call !== null && call === (kind === 'human');
}

/** Settle the plays assigned to one opened character. */
export function settleCharacter(kind: 'bot' | 'human', plays: SettlePlay[], p: SettleParams = DEFAULT_PARAMS): CharacterSettlement {
  let R = 0n;
  let W = 0n;
  for (const pl of plays) {
    if (isRight(kind, pl.call)) R += pl.locked;
    else W += pl.locked;
  }
  const credits = new Map<string, bigint>();
  if (W === 0n) {
    for (const pl of plays) credits.set(pl.key, pl.locked);
    return { rightCoins: R, wrongCoins: 0n, credits, payoutCredit: 0n, houseCredit: 0n };
  }
  if (R === 0n) {
    for (const pl of plays) credits.set(pl.key, 0n);
    const payoutCredit = (W * (p.rightBps + p.characterBps)) / BPS;
    return { rightCoins: 0n, wrongCoins: W, credits, payoutCredit, houseCredit: W - payoutCredit };
  }
  // Same two-step floor as contracts/game/src/lib.rs settle_character:
  // right_pot = floor(W * right_bps / BPS); share = floor(right_pot * locked / R).
  const rightPot = (W * p.rightBps) / BPS;
  let paidOut = 0n;
  for (const pl of plays) {
    if (isRight(kind, pl.call)) {
      const reward = (rightPot * pl.locked) / R;
      credits.set(pl.key, pl.locked + reward);
      paidOut += reward;
    } else {
      credits.set(pl.key, 0n);
    }
  }
  const payoutCredit = (W * p.characterBps) / BPS;
  return { rightCoins: R, wrongCoins: W, credits, payoutCredit, houseCredit: W - paidOut - payoutCredit };
}
