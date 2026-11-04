// Round results, ratings and bonuses after settlement (spec section 4, "Scoring and rating").
// Pure: takes the relay's records plus the chain's play views, returns results and user updates.
import type { ChatResult, Level, RoundResults } from '../../../shared/protocol.js';
import type { ChainPlay } from '../chain/types.js';
import { settleCharacter, type SettleParams, DEFAULT_PARAMS, isRight } from '../settlement.js';
import { applyRating, pRight, ratingDelta, wouldHaveCoins, applyOutcome } from '../scoring.js';
import { unitsToCoins } from '../util.js';
import type { CharacterRec, ChatSide, RoundRec, UserRec } from './types.js';

export interface ResultsInput {
  round: RoundRec;
  characters: CharacterRec[];
  sides: ChatSide[];
  chainPlays: ChainPlay[];
  users: Map<string, UserRec>;
  coinUnit: bigint;
  presets: Record<Level, [number, number, number]>;
  promo: string;
  verifiable: Set<string>; // chatIds of bot chats with stored valid signatures
  params?: SettleParams;
}

export interface ResultsOutput {
  results: Map<string, RoundResults>;
  users: Map<string, UserRec>;
  ratingRows: { account: string; chatId: string; before: number; after: number; at: number }[];
  lockedBonusAdded: Map<string, bigint>;
}

const isCall = (c: boolean | null | undefined): c is boolean => c === true || c === false;

export function computeResults(inp: ResultsInput): ResultsOutput {
  const params = inp.params ?? DEFAULT_PARAMS;
  const toCoins = (u: bigint) => unitsToCoins(u, inp.coinUnit);
  const playByHandle = new Map(inp.chainPlays.map((p) => [p.handle, p]));
  const charById = new Map(inp.characters.map((c) => [c.id, c]));

  // per character: p (coin-weighted right share of paid calls), room split, W and R, payout credit
  interface CharStat {
    p: number;
    paidCalls: number;
    paidHumanShare: number | null;
    W: number;
    R: number;
    payoutCredit: bigint;
  }
  const stat = new Map<string, CharStat>();
  for (const c of inp.characters) {
    const truthHuman = c.kind === 'human';
    const paid = inp.sides.filter((s) => s.characterId === c.id && s.playStatus === 'placed');
    const coinsTotal = paid.reduce((n, s) => n + s.coins, 0);
    const humanCoins = paid.filter((s) => s.myCall === true).reduce((n, s) => n + s.coins, 0);
    const assigned = inp.chainPlays.filter((pl) => pl.characterId === c.id);
    let W = 0n;
    let R = 0n;
    for (const pl of assigned) {
      if (isRight(c.kind, pl.call)) R += pl.locked;
      else W += pl.locked;
    }
    const settled = settleCharacter(
      c.kind,
      assigned.map((pl) => ({ key: pl.handle, account: pl.account, locked: pl.locked, call: pl.call })),
      params,
    );
    stat.set(c.id, {
      p: pRight(paid.map((s) => ({ coins: s.coins, right: isCall(s.myCall) && s.myCall === truthHuman }))),
      paidCalls: paid.length,
      paidHumanShare: coinsTotal > 0 ? humanCoins / coinsTotal : null,
      W: toCoins(W),
      R: toCoins(R),
      payoutCredit: settled.payoutCredit,
    });
  }

  const users = new Map([...inp.users].map(([k, v]) => [k, { ...v }]));
  const results = new Map<string, RoundResults>();
  const ratingRows: ResultsOutput['ratingRows'] = [];
  const lockedBonusAdded = new Map<string, bigint>();

  const viewers = new Set(inp.sides.map((s) => s.viewer));
  for (const c of inp.characters) if (c.kind === 'human' && c.account) viewers.add(c.account);

  for (const account of viewers) {
    const user = users.get(account);
    if (!user) continue;
    const ratingBefore = user.rating;
    let rating = user.rating;
    let stats = { chats: user.chats, right: user.right, wrong: user.wrong, streak: user.streak, bestStreak: user.bestStreak };
    const mine = inp.sides
      .filter((s) => s.viewer === account)
      .sort((a, b) => (a.endedAt ?? a.createdAt) - (b.endedAt ?? b.createdAt));
    const chats: ChatResult[] = [];
    let calledRight = 0;
    let calledTotal = 0;
    let coinsDelta = 0;
    let wouldHave = 0;
    for (const s of mine) {
      const st = stat.get(s.characterId);
      const truthHuman = s.partnerKind === 'human';
      const paid = s.playStatus === 'placed';
      const called = isCall(s.myCall);
      const right = called ? s.myCall === truthHuman : null;
      let delta = 0;
      const counts = paid || called;
      if (counts) {
        const r = right === true; // a missed paid call counts as wrong
        const proposed = ratingDelta(r, st?.p ?? 0.5);
        const next = applyRating(rating, proposed);
        delta = next - rating;
        ratingRows.push({ account, chatId: s.chatId, before: rating, after: next, at: s.endedAt ?? s.createdAt });
        rating = next;
        stats = applyOutcome(stats, r);
        calledTotal++;
        if (r) calledRight++;
      }
      stats.chats++;
      let cd = 0;
      if (paid) {
        const pl = playByHandle.get(s.handle);
        if (pl && pl.credited !== null) cd = toCoins(pl.credited - pl.amount);
        coinsDelta += cd;
      }
      let wh: number | undefined;
      if (!paid && called && st) {
        wh = wouldHaveCoins(inp.presets[s.level][0], st.W, st.R, right === true);
        wouldHave += wh;
      }
      const ch = charById.get(s.characterId);
      chats.push({
        chatId: s.chatId,
        level: s.level,
        seatIndex: s.seatIndex,
        partner: s.skin,
        truth: s.partnerKind,
        model: s.partnerKind === 'bot' ? ch?.model ?? s.model : undefined,
        partnerAccount: s.partnerKind === 'human' ? s.partnerAccount : undefined,
        mode: paid ? 'paid' : 'free',
        coins: paid ? s.coins : 0,
        myCall: called ? (s.myCall as boolean) : null,
        right,
        coinsDelta: Math.round(cd * 1e6) / 1e6,
        wouldHaveCoins: wh === undefined ? undefined : Math.round(wh * 1e4) / 1e4,
        ratingDelta: delta,
        roomSplit: { paidCalls: st?.paidCalls ?? 0, paidHumanShare: st?.paidHumanShare ?? null },
        verifiable: s.partnerKind === 'bot' && inp.verifiable.has(s.chatId),
      });
    }

    // the account's own human character: Turing bonus (own payout) or locked bonus (promo payout)
    let turing = 0n;
    let locked = 0n;
    for (const c of inp.characters) {
      if (c.kind !== 'human' || c.account !== account) continue;
      const credit = stat.get(c.id)?.payoutCredit ?? 0n;
      if (credit <= 0n) continue;
      if (c.payout === account) turing += credit;
      else if (c.payout === inp.promo) locked += credit;
    }
    if (locked > 0n) {
      lockedBonusAdded.set(account, locked);
      user.lockedBonus = (BigInt(user.lockedBonus || '0') + locked).toString();
    }

    user.rating = rating;
    user.chats = stats.chats;
    user.right = stats.right;
    user.wrong = stats.wrong;
    user.streak = stats.streak;
    user.bestStreak = stats.bestStreak;

    results.set(account, {
      roundId: inp.round.id,
      status: 'settled',
      settledAt: inp.round.settledAt,
      chats,
      calledRight,
      calledTotal,
      coinsDelta: Math.round(coinsDelta * 1e6) / 1e6,
      turingBonusCoins: toCoins(turing),
      lockedBonusCoins: toCoins(locked),
      wouldHaveCoins: Math.round(wouldHave * 1e4) / 1e4,
      ratingBefore,
      ratingAfter: rating,
      chain: { revealTx: inp.round.revealTx, openTxs: inp.round.openTxs, settleTx: inp.round.settleTx },
    });
  }
  return { results, users, ratingRows, lockedBonusAdded };
}
