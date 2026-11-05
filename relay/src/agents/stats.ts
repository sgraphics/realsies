// What an AI builder learns from its settled chats (docs/agents.md): one record per chat, built at
// settlement from the relay's chat records and the chain's plays (before the round's storage is pruned),
// with the player anonymised; and the scorecard over them, per persona, per round and in total.
//
// Per chat: the player's call (true = called it human: fooled), the mode and coins, and the chat's share of
// its character's Turing bonus: the character's payout account receives 20% of the coins of every paid play
// it won (90% when nobody called it right), paid on chain at settlement; a chat's share is its locked coins
// over the character's wrong coins. A missed paid call counts as wrong on chain, so it earns the bonus too.
import crypto from 'node:crypto';
import type { BotmasterChat, BotmasterRoundStats, BotmasterScore, BotmasterStats } from '../../../shared/protocol.js';
import type { ChainPlay } from '../chain/types.js';
import type { CharacterRec, ChatSide, RoundRec } from '../game/types.js';
import type { StoredMsg } from '../bot/session.js';
import { DEFAULT_PARAMS, isRight, settleCharacter, type SettleParams } from '../settlement.js';
import { ownerOf } from '../personas.js';
import { unitsToCoins } from '../util.js';
import type { AgentChatRec } from './store.js';

/**
 * A player's anonymous id for one botmaster in one round: a keyed hash (HMAC-SHA256 with a secret kept in the
 * relay's DB), so the same player in two chats of the round has the same id, and nobody can link it to an
 * account, to another round, or to the id another botmaster sees.
 */
export function anonPlayer(secret: string, botmaster: string, roundId: number, account: string): string {
  return 'p_' + crypto.createHmac('sha256', secret).update(`realsies:anon:v1|${botmaster}|${roundId}|${account}`).digest('hex').slice(0, 12);
}

export interface AgentChatsInput {
  round: RoundRec;
  characters: CharacterRec[];
  sides: ChatSide[];
  chainPlays: ChainPlay[];
  coinUnit: bigint;
  anonSecret: string;
  params?: SettleParams;
}

/** The settled chats of every AI builder's (and every remote-brain botmaster's) persona in a round. */
export function agentChatsOf(a: AgentChatsInput): AgentChatRec[] {
  const params = a.params ?? DEFAULT_PARAMS;
  const chars = new Map(a.characters.map((c) => [c.id, c]));
  const playByHandle = new Map(a.chainPlays.map((p) => [p.handle, p]));
  const payout = new Map<string, { credit: bigint; wrong: bigint }>();
  for (const c of a.characters) {
    if (c.kind !== 'bot' || !ownerOf(c.persona)) continue;
    const assigned = a.chainPlays.filter((p) => p.characterId === c.id);
    let wrong = 0n;
    for (const p of assigned) if (!isRight('bot', p.call)) wrong += p.locked;
    const st = settleCharacter('bot', assigned.map((p) => ({ key: p.handle, account: p.account, locked: p.locked, call: p.call })), params);
    payout.set(c.id, { credit: st.payoutCredit, wrong });
  }
  const settledAt = a.round.settledAt ?? Date.now();
  const out: AgentChatRec[] = [];
  for (const s of a.sides) {
    if (s.partnerKind !== 'bot' || s.aborted) continue;
    const c = chars.get(s.characterId);
    const owner = ownerOf(c?.persona);
    if (!c || !owner) continue;
    const paid = s.playStatus === 'placed';
    const call = s.myCall === true || s.myCall === false ? s.myCall : null;
    let bonus = 0n;
    const pl = paid ? playByHandle.get(s.handle) : undefined;
    const po = payout.get(c.id);
    if (pl && po && pl.characterId === c.id && !isRight('bot', pl.call) && po.wrong > 0n) bonus = (po.credit * pl.locked) / po.wrong;
    out.push({
      roundId: a.round.id,
      chatId: s.chatId,
      personaId: c.personaId ?? s.personaId ?? '',
      model: c.model ?? s.model ?? '',
      level: s.level,
      startedAt: s.startedAt ?? s.createdAt,
      player: anonPlayer(a.anonSecret, owner, a.round.id, s.viewer),
      playerMode: paid ? 'paid' : 'free',
      coins: paid ? s.coins : 0,
      playerCall: call,
      fooled: call,
      turingBonusCoins: unitsToCoins(bonus, a.coinUnit),
      transcript: ((s.messages ?? []) as StoredMsg[]).map((m) => ({ from: m.from === 'me' ? ('player' as const) : ('bot' as const), text: m.text, at: m.at })),
      botmaster: owner,
      turingBonusUnits: bonus.toString(),
      settledAt,
    });
  }
  return out;
}

/** The BotmasterChat a botmaster sees (the stored record without the relay's bookkeeping). */
export function publicChat(r: AgentChatRec): BotmasterChat {
  return {
    roundId: r.roundId, chatId: r.chatId, personaId: r.personaId, model: r.model, level: r.level, startedAt: r.startedAt, player: r.player,
    playerMode: r.playerMode, coins: r.coins, playerCall: r.playerCall, fooled: r.fooled, turingBonusCoins: r.turingBonusCoins, transcript: r.transcript,
  };
}

const share = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * The scorecard of a set of settled chats. chats = calledHuman + calledBot + missed (every settled chat ends
 * with a call window); fooledShare = calledHuman / (calledHuman + calledBot); coinFooledShare is the same over
 * paid chats with a call, weighted by their coins; turingBonusCoins is exact (summed in base units).
 */
export function scoreOf(chats: AgentChatRec[], coinUnit: bigint): BotmasterScore {
  let calledHuman = 0;
  let calledBot = 0;
  let missed = 0;
  let paidChats = 0;
  let paidCalled = 0;
  let paidHuman = 0;
  let bonus = 0n;
  for (const c of chats) {
    if (c.playerCall === true) calledHuman++;
    else if (c.playerCall === false) calledBot++;
    else missed++;
    if (c.playerMode === 'paid') {
      paidChats++;
      if (c.playerCall !== null) {
        paidCalled += c.coins;
        if (c.playerCall) paidHuman += c.coins;
      }
    }
    bonus += BigInt(c.turingBonusUnits || '0');
  }
  return {
    chats: chats.length,
    paidChats,
    calledHuman,
    calledBot,
    missed,
    fooledShare: calledHuman + calledBot > 0 ? share(calledHuman / (calledHuman + calledBot)) : null,
    coinFooledShare: paidCalled > 0 ? share(paidHuman / paidCalled) : null,
    turingBonusCoins: unitsToCoins(bonus, coinUnit),
  };
}

/** Totals, every persona (the ones listed, with or without chats yet), and every round newest first. */
export function statsOf(chats: AgentChatRec[], coinUnit: bigint, personaIds: string[] = []): BotmasterStats {
  const byPersona: Record<string, BotmasterScore> = {};
  const ids = [...new Set([...personaIds, ...chats.map((c) => c.personaId)])];
  for (const id of ids) byPersona[id] = scoreOf(chats.filter((c) => c.personaId === id), coinUnit);
  const rounds = new Map<number, AgentChatRec[]>();
  for (const c of chats) {
    const list = rounds.get(c.roundId) ?? [];
    list.push(c);
    rounds.set(c.roundId, list);
  }
  const perRound: BotmasterRoundStats[] = [...rounds.entries()]
    .sort((x, y) => y[0] - x[0])
    .map(([roundId, list]) => ({ roundId, settledAt: Math.max(...list.map((c) => c.settledAt ?? 0)) || undefined, ...scoreOf(list, coinUnit) }));
  return { totals: scoreOf(chats, coinUnit), byPersona, rounds: perRound };
}
