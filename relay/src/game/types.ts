// Runtime state of rounds, characters and chats. Everything here is persisted as JSON documents.
import type { ChatMessage, ChatPhase, Level, Mode, RoundStatus, Skin, ThemeId, Truth } from '../../../shared/protocol.js';
import type { OpenReport } from '../chain/types.js';
import type { AttestedSigner } from '../nearai/verify.js';
import type { Persona } from '../personas.js';
import type { RevealCard } from '../persona/model.js';

export interface AttestInfo {
  model: string;
  nonce: string;
  fetchedAt: number;
  signers: AttestedSigner[];
  attested: string[];
  gatewaySigner?: string;
  gatewayOk: boolean;
  note: string;
  ok: boolean;
  error?: string;
}

export interface CharacterRec {
  id: string;
  roundId: number;
  kind: Truth;
  /** bots: the level the character serves */
  level?: Level;
  personaId?: string;
  model?: string;
  /** exact persona prompt committed by hash (message 0) */
  prompt?: string;
  promptHash?: string;
  /** bots: the persona this character plays, as committed (prompt and hash live in the two fields above) */
  persona?: Omit<Persona, 'prompt' | 'promptHash'>;
  /** demo bots: who the persona was, published with results and bundles after settlement, never before */
  card?: RevealCard;
  signers?: string[];
  /** humans: the player account */
  account?: string;
  payout: string;
  salt: string;
  preimage: string;
  commitment: string;
  commitStatus: 'pending' | 'sending' | 'committed' | 'failed';
  commitTx?: string;
  createdAt: number;
  openTx?: string;
  openReport?: OpenReport;
}

export type PlayStatus = 'none' | 'pending' | 'placed' | 'failed';
export type CallStatus = 'none' | 'pending' | 'ok' | 'failed' | 'stored';

export interface ChatSide {
  chatId: string;
  convId: string;
  roundId: number;
  viewer: string;
  level: Level;
  seatIndex: number;
  theme: ThemeId;
  skin: Skin;
  characterId: string;
  partnerKind: Truth;
  partnerAccount?: string;
  partnerChatId?: string;
  personaId?: string;
  model?: string;
  requestedMode: Mode;
  mode: Mode;
  coins: number;
  handle: string;
  tag: string;
  skinMessage?: string;
  phase: ChatPhase;
  createdAt: number;
  startedAt?: number;
  endsAt?: number;
  endedAt?: number;
  endReason?: 'time' | 'partner_left' | 'dev' | 'round_end';
  callDeadline?: number;
  myCall?: boolean | null;
  callAt?: number;
  callTx?: string;
  callStatus: CallStatus;
  callError?: string;
  playTx?: string;
  playStatus: PlayStatus;
  playError?: string;
  /**
   * a matched chat that never started: new chats were paused (no bot could talk) or its bot's NEAR AI key ran
   * out between the match and the start (bots_unavailable; a placed play is in no opening, so it is refunded at
   * settlement; no rating change)
   */
  aborted?: 'bots_unavailable';
  /** messages from this viewer's perspective; also stored row by row */
  messages: ChatMessage[];
  /** wallet accounts: the session (src/auth/service.ts) whose browser holds the play key that signs this chat's play and call */
  sessionId?: string;
}

export interface RoundRec {
  id: number;
  secret: string;
  secretHash: string;
  startedAt: number;
  endsAt: number;
  acceptingUntil: number;
  status: RoundStatus;
  ready: boolean;
  endedEarly: boolean;
  startTx?: string;
  startOk: boolean;
  commitTxs: string[];
  revealTx?: string;
  openTxs: string[];
  settleTx?: string;
  settledAt?: number;
  resultsDone: boolean;
  /** prune_round finished: the chain no longer stores this round's plays and characters */
  prunedAt?: number;
  lastError?: string;
  attest: Record<string, AttestInfo>;
  /** seed of this round's generated demo personas (src/persona/generate.ts); absent in rounds before them */
  castSeed?: string;
}

export interface UserRec {
  account: string;
  label: string;
  rating: number;
  chats: number;
  right: number;
  wrong: number;
  streak: number;
  bestStreak: number;
  /** base units, decimal string: Turing bonus held by promo until the next faucet deposit */
  lockedBonus: string;
  freeDay: string;
  freeUsed: number;
  /** 'wallet': signed in with a wallet (the browser signs its plays and calls); absent or 'test': a test user */
  kind?: 'test' | 'wallet';
}

export interface Search {
  account: string;
  roundId: number;
  level: Level;
  seatIndex: number;
  mode: Mode;
  coins: number;
  startedAt: number;
  deadline: number;
  timer: NodeJS.Timeout | null;
  resolving: boolean;
  /** the session that picked the seat (wallet accounts) */
  sessionId?: string;
}
