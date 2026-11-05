// Realsies relay <-> web protocol, v1.2 (2026-11-05: chat countdown, persona cards, AI builders; all additive).
// Authoritative. Owned by the lead; workstreams import it and do not edit it.
// Spec: docs/spec.md

export type Level = 1 | 2 | 3;
export const LEVELS: Level[] = [1, 2, 3];

export type ThemeId = 'castle' | 'jungle' | 'desert' | 'cave' | 'space';
export const THEMES: ThemeId[] = ['castle', 'jungle', 'desert', 'cave', 'space'];
export const THEME_NAMES: Record<ThemeId, string> = {
  castle: 'Castle Dungeon',
  jungle: 'Lost Jungle',
  desert: 'Desert Tomb',
  cave: 'Crystal Cave',
  space: 'Star Station',
};

/** Theme of a level in a round. Round 1: level 1 castle, level 2 jungle, level 3 desert; rotates each round. */
export function themeFor(level: Level, roundId: number): ThemeId {
  const i = (((roundId - 1) + (level - 1)) % THEMES.length + THEMES.length) % THEMES.length;
  return THEMES[i];
}

export type Mode = 'free' | 'paid';
export type Truth = 'human' | 'bot';

/** What a viewer sees of a character. The look is derived from `seed` by the art engine. */
export interface Skin {
  seed: string; // 64 lowercase hex chars
  name: string; // gamertag, see shared/names.ts
}

export type SeatState = 'open' | 'searching' | 'chatting' | 'called' | 'unavailable';

export interface Seat {
  index: number; // 0..9
  skin: Skin;
  state: SeatState;
  myCall?: boolean | null; // true = called human, false = called bot, null = missed
  chatId?: string;
  mode?: Mode;
  coins?: number;
}

export type RoundStatus = 'open' | 'closing' | 'settling' | 'settled';

export interface RoundState {
  roundId: number;
  startedAt: number; // ms epoch
  endsAt: number; // ms epoch
  acceptingUntil: number; // ms epoch; no new searches after this
  status: RoundStatus;
  themes: Record<Level, ThemeId>;
  chain?: { startTx?: string; commitTxs?: string[] };
}

export interface PublicConfig {
  testMode: boolean;
  network: 'testnet' | 'mainnet';
  contractId: string;
  tokenId: string;
  tokenSymbol: string; // "tREAL" on testnet
  coinUnit: string; // token base units per coin, decimal string
  usdPerCoin: number; // display constant, e.g. 0.01
  presets: Record<Level, [number, number, number]>; // coins
  minCoins: number;
  maxCoins: number;
  chatSeconds: number;
  callSeconds: number;
  roundMinutes: number;
  feeBps: number; // 500 = 5% to the bot fund
  freeChatsPerDay: number; // 0 = unlimited
  countdownSeconds?: number; // full-screen 3-2-1 before every chat; default 3
  explorerTx: string; // template containing {hash}
  explorerAccount: string; // template containing {account}
}

export interface PlayerStats {
  chats: number;
  right: number;
  wrong: number;
  streak: number;
  bestStreak: number;
}

export interface Me {
  accountId: string;
  label?: string;
  balanceCoins: number; // available in the game contract
  lockedCoins: number; // in plays of unsettled rounds
  rating: number;
  stats: PlayerStats;
  levelUnlocked: Level;
  lockedBonusCoins: number; // Turing bonus earned as a free human, paid on first deposit
  freeChatsLeft: number | null; // null = unlimited
}

export interface TestUser {
  accountId: string;
  label: string;
  seed: string; // avatar seed for the selection screen
  balanceCoins: number;
  rating: number;
  chats: number;
  online: boolean;
}

export interface ChatInfo {
  chatId: string;
  roundId: number;
  level: Level;
  seatIndex: number;
  theme: ThemeId;
  partner: Skin; // the seat's skin
  mode: Mode; // this viewer's side
  coins: number; // 0 when free
  startedAt?: number;
  endsAt?: number;
}

export interface ChatMessage {
  id: string;
  from: 'me' | 'them';
  text: string;
  at: number;
}

export type ChatPhase = 'searching' | 'placing' | 'chatting' | 'calling' | 'called' | 'missed';

export interface ActiveChat extends ChatInfo {
  phase: ChatPhase;
  messages: ChatMessage[];
  callDeadline?: number;
  myCall?: boolean | null;
}

// ---------- results ----------

/** Who a demo bot was playing, revealed after settlement. Demo bots only; remote brains may omit it. */
export interface PersonaCard {
  age: number;
  gender: string; // independent of the avatar's look
  mbti: string; // e.g. "ENFP"
  temperament: string; // e.g. "shy introvert", "loud extrovert"
  home: string; // e.g. "Leeds, UK"
  job: string; // e.g. "barista"
  style: string; // one line, e.g. "all lowercase, no punctuation, lots of lol, 😭 and 💀"
  emoji: 'none' | 'rare' | 'often';
  name?: string; // the persona's own first name in its backstory, e.g. "Lucía"
  mood?: string; // today's mood, e.g. "hyper"
}

export interface ChatResult {
  chatId: string;
  level: Level;
  seatIndex: number;
  partner: Skin;
  truth: Truth;
  model?: string; // bots
  partnerAccount?: string; // humans, revealed after settlement
  mode: Mode;
  coins: number;
  myCall: boolean | null;
  right: boolean | null; // null = missed call
  coinsDelta: number; // paid: credited minus played (fee included); free: 0
  wouldHaveCoins?: number; // free only
  ratingDelta: number;
  roomSplit: { paidCalls: number; paidHumanShare: number | null }; // coin-weighted share of paid calls that said human
  verifiable: boolean; // bot chat with stored signatures
  persona?: PersonaCard; // bots, after settlement
}

export interface RoundResults {
  roundId: number;
  status: RoundStatus;
  settledAt?: number;
  chats: ChatResult[];
  calledRight: number;
  calledTotal: number;
  coinsDelta: number; // net over paid chats
  turingBonusCoins: number; // credited to this account as a character
  lockedBonusCoins: number; // earned as a free human this round
  wouldHaveCoins: number; // free chats total
  ratingBefore: number;
  ratingAfter: number;
  chain: { revealTx?: string; openTxs: string[]; settleTx?: string };
}

export interface RoundSummary {
  roundId: number;
  startedAt: number;
  endsAt: number;
  status: RoundStatus;
  characters: number;
  chats: number;
  paidPlays: number;
  settleTx?: string;
}

export interface LeaderRow {
  label: string;
  accountId?: string;
  rating: number;
  chats: number;
  accuracy: number; // 0..1
}

// ---------- verification ----------

export interface SignaturePayload {
  text: string;
  signature: string; // 0x + 130 hex
  signing_address: string;
  signing_algo: string;
  signature_kind?: string;
}

export interface VerifyCompletion {
  index: number;
  completionId: string;
  request: string; // exact request bytes, UTF-8
  response: string; // exact response bytes, UTF-8
  signature: SignaturePayload | null;
  displayed: string[]; // bubbles shown to the player from this completion
  at: number;
}

export interface VerifyMessage {
  from: 'player' | 'bot';
  text: string;
  at: number;
  completionIndex?: number;
}

export interface VerifyBundle {
  roundId: number;
  chatId: string;
  characterId: string;
  model: string;
  commitment: { preimage: string; hash: string; commitTx?: string };
  opening: { salt: string; promptHash: string; signers: string[]; payout: string; openTx?: string };
  personaPrompt: string; // message 0; sha256 must equal opening.promptHash
  skinMessage: string; // message 1
  attestation: {
    nonce: string; // = round secret_hash
    fetchedAt: number;
    model: string;
    signers: { address: string; reportDataOk: boolean; nonceOk: boolean }[];
    gatewaySigner?: string;
    note?: string;
  };
  completions: VerifyCompletion[];
  transcript: VerifyMessage[];
  roundSecret: string; // revealed; lets anyone recompute handles
  persona?: PersonaCard;
  viewer: string;
  handle: string;
  chain: { revealTx?: string; openTx?: string; settleTx?: string; playTx?: string; callTx?: string };
}

// ---------- AI builders: LLM operators, chat and voice vendors ----------
// They apply for access, get a botmaster token, enter agents, earn the Turing bonus on chats their agents win,
// and read every settled transcript plus a scorecard. HTTP only (see docs/agents.md); not part of GameClient.

export type BuilderKind = 'llm_operator' | 'chat_vendor' | 'voice_vendor' | 'researcher' | 'other';

/** POST /api/agents/request */
export interface AgentAccessRequest {
  name: string;
  email: string;
  company?: string;
  website?: string;
  kind: BuilderKind;
  models: string; // models and stack they want to enter, free text
  goal: string; // what they want to learn or test, free text
  volume?: string; // expected chats per day, free text
  payoutAccount?: string; // NEAR account that receives the Turing bonus
  agreeTerms: boolean;
}

export interface AgentRequestReceipt {
  id: string;
  status: 'pending';
  createdAt: number;
}

export interface BotmasterPersonaSummary {
  id: string;
  model: string;
  levels: Level[];
  brain: 'default' | 'remote';
  active: boolean;
}

/** GET /api/botmaster/me (Authorization: Bearer <botmaster token>) */
export interface BotmasterProfile {
  name: string;
  payoutAccount: string;
  personas: BotmasterPersonaSummary[];
  byok: boolean; // uses its own NEAR AI key
  createdAt: number;
}

export interface BotmasterScore {
  chats: number; // settled chats with a call
  paidChats: number;
  calledHuman: number; // players fooled
  calledBot: number;
  missed: number;
  fooledShare: number | null; // calledHuman / (calledHuman + calledBot)
  coinFooledShare: number | null; // coin-weighted, paid calls only
  turingBonusCoins: number;
}

export interface BotmasterRoundStats extends BotmasterScore {
  roundId: number;
  settledAt?: number;
}

/** GET /api/botmaster/stats */
export interface BotmasterStats {
  totals: BotmasterScore;
  byPersona: Record<string, BotmasterScore>;
  rounds: BotmasterRoundStats[]; // newest first
}

/** GET /api/botmaster/chats?round=&limit=  and one JSON object per line in GET /api/botmaster/export.jsonl */
export interface BotmasterChat {
  roundId: number;
  chatId: string;
  personaId: string;
  model: string;
  level: Level;
  startedAt: number;
  player: string; // anonymised, stable per player within a round
  playerMode: Mode;
  coins: number;
  playerCall: boolean | null; // true = called human
  fooled: boolean | null; // the player called this bot human
  turingBonusCoins: number;
  transcript: { from: 'player' | 'bot'; text: string; at: number }[];
}

// ---------- WebSocket ----------

export type ClientMsg =
  | { t: 'enter_room'; level: Level }
  | { t: 'pick_seat'; level: Level; seatIndex: number; mode: Mode; coins?: number }
  | { t: 'cancel_search' }
  | { t: 'say'; chatId: string; text: string }
  | { t: 'typing'; chatId: string; on: boolean }
  | { t: 'call'; chatId: string; human: boolean }
  | { t: 'dev_end_chat'; chatId: string }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; me: Me; round: RoundState; config: PublicConfig; activeChat?: ActiveChat }
  | { t: 'round'; round: RoundState }
  | { t: 'room'; level: Level; roundId: number; theme: ThemeId; seats: Seat[] }
  | { t: 'seat'; level: Level; roundId: number; seat: Seat }
  | { t: 'searching'; level: Level; seatIndex: number }
  | { t: 'matched'; chat: ChatInfo }
  | { t: 'placing'; chatId: string }
  | { t: 'placed'; chatId: string; tx: string }
  | { t: 'play_failed'; chatId: string; reason: string } // this side continues free
  // startedAt may lie in the future: show a full-screen countdown until then; the relay rejects `say` before
  // startedAt (error code chat_not_started), bots start their clocks at startedAt, endsAt = startedAt + chatSeconds.
  | { t: 'chat_started'; chatId: string; startedAt: number; endsAt: number }
  | { t: 'message'; chatId: string; msg: ChatMessage }
  | { t: 'typing'; chatId: string; on: boolean }
  | { t: 'chat_ended'; chatId: string; callDeadline: number; reason: 'time' | 'partner_left' | 'dev' | 'round_end' }
  | { t: 'call_recorded'; chatId: string; human: boolean; tx?: string }
  | { t: 'call_missed'; chatId: string }
  | { t: 'me'; me: Me }
  | { t: 'results_ready'; roundId: number }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' };

// ---------- client interface used by the web app ----------

export interface GameClient {
  getConfig(): Promise<PublicConfig>;
  listTestUsers(): Promise<TestUser[]>;
  faucet(accountId: string, coins?: number): Promise<{ tx: string; me: Me }>;
  withdraw(accountId: string, coins: number): Promise<{ tx: string; me: Me }>;
  getMe(accountId: string): Promise<Me>;
  listRounds(): Promise<RoundSummary[]>;
  getResults(roundId: number, accountId: string): Promise<RoundResults>;
  getVerify(chatId: string, accountId: string): Promise<VerifyBundle>;
  leaderboard(): Promise<LeaderRow[]>;
  devEndRound(): Promise<void>;

  connect(accountId: string): void;
  disconnect(): void;
  send(msg: ClientMsg): void;
  /** Subscribe to server messages and connection state. Returns an unsubscribe function. */
  on(handler: (msg: ServerMsg) => void): () => void;
  onStatus(handler: (status: 'connecting' | 'open' | 'closed') => void): () => void;
}
