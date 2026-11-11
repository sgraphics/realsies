// Realsies relay <-> web protocol, v1.15 (2026-11-11: SwapQuote.swapIn, a buy's exact-input Swap, which chart sites count as a buy; additive).
// v1.14 (2026-11-10: the practice chat, one free try for a visitor without a wallet: PublicConfig.practice, GET and POST /api/practice, /ws?practice=, ServerMsg practice_result; additive).
// v1.13 (2026-11-10: PublicConfig.turingHour, the daily Turing Hour when real people are promised in the room; additive).
// v1.12 (2026-11-10: coins for NEAR and back on Rhea: PublicConfig.swap and nearPerCoin, GET /api/swap/quote and SwapQuote, WalletInfo.nearBalance, wrapRegistered, wnearBalance and wrapStorageDeposit; additive).
// v1.11 (2026-11-09: POST /api/auth/failed and AuthFailure, a browser's failed sign-in for the operator's log; additive).
// v1.10 (2026-11-09: GET /api/auction and AuctionInfo, the REAL auction on meme.cooking for a deposit from realsies.lol; additive).
// v1.9 (2026-11-08: PublicConfig.betaClosed, the testnet beta's end at its NEAR AI spend cap, and error beta_closed; BotmasterProfile.schedule, the builder slots; additive).
// v1.8 (2026-11-08): LaunchConfig.telegramUrl, the Telegram link in the coming-soon page's footer; additive.
// v1.7 (2026-11-08): GET /api/round, the current round for a guest without a session; additive.
// v1.6 (2026-11-07): the testnet airdrop, AirdropStatus and AirdropResult; additive.
// v1.5 (2026-11-07): WalletInfo.walletBalance, the coin in the wallet itself; additive.
// v1.4 (2026-11-06): PublicConfig.launch, the coming-soon page and the auction banner; additive.
// v1.3 (2026-11-05): wallet sign-in with NEP-413 sessions, play keys, player-signed plays and calls, wallet deposits; all additive.
// v1.2 (2026-11-05): chat countdown, persona cards, AI builders.
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
  // ----- v1.3, optional -----
  /** false while the game contract has no coin set (mainnet before REAL launches): free play only */
  coinsOpen?: boolean;
  /** "Buy REAL": the meme.cooking page before the launch finalizes, the Rhea swap after; absent = no link */
  buyUrl?: string;
  tokenDecimals?: number;
  /** wallet sign-in; absent on relays before v1.3 (test users only) */
  wallet?: WalletConfig;
  // ----- v1.4, optional -----
  /**
   * The launch of REAL and the mainnet game: sent by a relay without test mode that has LAUNCH_* settings, until
   * the coin is set on the contract (`coinsOpen`). A test relay never sends it, and the web ignores it on one.
   */
  launch?: LaunchConfig;
  // ----- v1.9, optional -----
  /**
   * The beta is over: the relay's NEAR AI spend reached its cap (BETA_SPEND_CAP_USD, the testnet relay). Sent in the
   * config and pushed to every connection (`config`) when it happens. No new chats (pick_seat: error beta_closed),
   * no new sign-ins (beta_closed) and no new rounds; running chats finish and the round settles. The web shows "The
   * beta test is over" and, after 5 s and once no chat is running, goes to `redirect` with ?beta=over.
   */
  betaClosed?: { redirect: string; reason: 'spend_cap' };
  // ----- v1.12, optional -----
  /** coins for NEAR and back on Rhea: sent when the relay has SWAP_DEX and SWAP_POOL and coins are open */
  swap?: SwapConfig;
  /** the price of one coin in NEAR at the pool's current point, refreshed at most once a minute; only with `swap` */
  nearPerCoin?: number;
  // ----- v1.13, optional -----
  /**
   * Turing Hour: every day from `startUtc` ("HH:MM", UTC) for `minutes`, real people are promised to be in the room.
   * Sent when the relay has TURING_HOUR_UTC. The web shows one line from 6 hours before the start until the end
   * (shared/turing.ts works out when), never while the launch banner shows.
   */
  turingHour?: { startUtc: string; minutes: number };
  // ----- v1.14, optional -----
  /**
   * The practice chat: a visitor without a wallet may try `perDay` chats a day (per device and per IP) with a house
   * bot, outside the rounds. Sent while GUEST_CHATS_PER_DAY and GUEST_CHATS_DAILY_CAP are above 0; absent = off.
   */
  practice?: { perDay: number };
}

// ---------- the practice chat (v1.14) ----------
// One free try for a visitor without a wallet, so the game can be felt before any sign-in. The partner is always one
// of the house bots (the same bot engine, models, typing, countdown, two minutes and call as in a round), never a
// character of the running round, and nothing of the round reaches the guest. No coins, no rating, nothing on chain,
// no round record: the relay keeps the transcript in its own table, flagged as practice, never public.
//   GET  /api/practice?device=<id>         may this browser have one now (PracticeStatus)
//   POST /api/practice {device, seed, level}  reserves it (the try counts from here) and returns a PracticeTicket
//   POST /api/practice {guest}             a new ticket for the same practice from the same IP (a reconnect)
//   /ws?practice=<ticket>                  one-time, bound to the IP that got it. The chat runs over it as any other
//                                          (matched, chat_started, message, typing, chat_ended, call_recorded or
//                                          call_missed); the guest may send say, typing, call and ping only (anything
//                                          else: error not_in_practice). Right after the call, or the missed call:
//                                          practice_result, the reveal.
// `device` is a random id the browser keeps (16 to 64 of A-Z a-z 0-9 _ -). Refusals (PracticeStatus.reason, and the
// code of a refused POST): practice_used (this device or this IP had its tries today, 429), practice_cap (every guest's
// tries for today are gone, 429), practice_off (404), bots_unavailable (503), beta_closed (403).

export type PracticeRefusal = 'practice_used' | 'practice_cap' | 'practice_off' | 'bots_unavailable' | 'beta_closed';

/** GET /api/practice?device= */
export interface PracticeStatus {
  ok: boolean;
  reason?: PracticeRefusal;
}

/** POST /api/practice: the character tapped (its look, and the level for the room's theme) */
export interface PracticeRequest {
  device: string;
  /** the skin seed of the character the guest tapped (64 hex): the partner looks like it */
  seed: string;
  level: Level;
}

export interface PracticeTicket {
  /** this practice's id: POST /api/practice {guest} from the same IP gets a new ticket while the chat runs */
  guest: string;
  /** one use, for /ws?practice= */
  ticket: string;
  expiresAt: number;
}

/** The reveal, right after the call: a practice partner is always a bot. */
export interface PracticeResult {
  chatId: string;
  truth: 'bot';
  /** true = called human, false = called bot, null = no call in time */
  myCall: boolean | null;
  right: boolean | null;
  model: string;
  /** who the bot was playing: the same card a round shows after it settles */
  persona?: PersonaCard;
}

// ---------- coins for NEAR, on Rhea (v1.12) ----------
// The coin trades in a Rhea (formerly Ref Finance) concentrated-liquidity pool against wrapped NEAR. A wallet player
// pays NEAR and gets coins in the game, or withdraws coins as NEAR, each in one wallet approval: the browser builds the
// transactions from the relay's quote (web/src/wallet/swap.ts) and the wallet sends them. The relay only reads.
// A buy is one transaction to the wrap contract (storage_deposit if needed, near_deposit for what the wallet's wNEAR
// does not cover, then ft_transfer_call of `swapIn` to the pool contract with {"Swap": ...}: at least `coins` whole
// coins out), then the usual deposit of exactly those coins into the game; the little more of the coin the swap gives
// stays in the wallet. Since v1.15 the buy is exact-input because the pool contract logs a Swap as the event `swap`,
// which chart sites (DexScreener, GeckoTerminal) count as a buy, and {"SwapByOutput": ...} (exactly `coins`, at most
// the NEAR offered, the rest back as wNEAR; still sent when an older relay's quote has no swapIn) as `swap_desire`,
// which they do not. A sale is `withdraw` on the game, then ft_transfer_call of the coin to the pool contract with
// {"Swap": ...} and skip_unwrap_near false: plain NEAR arrives.

/** What GET /api/swap/quote is asked: amounts as decimal strings of base units (yoctoNEAR, coin units) */
export type SwapQuestion = { side: 'buy'; near: string } | { side: 'buy'; coins: number } | { side: 'sell'; units: string };

export interface SwapConfig {
  /** the pool contract: dclv2.ref-labs.near on mainnet, dclv2.ref-dev.testnet on testnet */
  dex: string;
  /** "<token>|<token>|<fee>": the coin and the wrap contract, sorted as strings, e.g. "real.realsies.testnet|wrap.testnet|2000" */
  poolId: string;
  /** wrapped NEAR: wrap.near, wrap.testnet */
  wrapId: string;
  /** room for the price to move between the quote and the swap, in basis points (100 = 1%) */
  slippageBps: number;
}

/**
 * GET /api/swap/quote, public, the same question answered from a cache for a few seconds:
 *   ?side=buy&near=<yoctoNEAR>   what that NEAR buys
 *   ?side=buy&coins=<n>          the NEAR that surely buys n coins (amountIn), and what it buys
 *   ?side=sell&units=<base units> what those coins sell for
 * Refused with invalid_request (400) for a nonsense amount, swap_off (404) without swap settings, swap_unavailable
 * (502) when the pool contract does not answer.
 */
export interface SwapQuote {
  side: 'buy' | 'sell';
  /** buy: yoctoNEAR offered, the most the swap may take; sell: coin base units sold */
  amountIn: string;
  /** what amountIn gives at the current price: coin base units for a buy, yoctoNEAR for a sale */
  amountOut: string;
  /** amountOut less the slippage allowance: a sale's min_output_amount */
  minOut: string;
  /** buy: the whole coins amountIn surely covers, even after the price moves by the allowance: what is bought, exactly */
  coins?: number;
  /** buy: those coins in base units (the swap's min_output_amount; SwapByOutput's output_amount) and the deposit */
  coinUnits?: string;
  /** buy: what those coins cost at the current price, yoctoNEAR; with SwapByOutput the rest of amountIn comes back as wNEAR */
  cost?: string;
  /**
   * buy, v1.15: what the swap sends, yoctoNEAR: `cost` plus the slippage allowance, never more than amountIn. The swap
   * is exact-input ({"Swap": ...} with min_output_amount = coinUnits), which chart sites count as a buy; a little more
   * of the coin than coinUnits arrives and stays in the wallet. Absent on an older relay (and when no coin is
   * covered): the web then buys with SwapByOutput as before.
   */
  swapIn?: string;
  slippageBps: number;
}

// ---------- the launch (v1.4) ----------
// REAL is raised in a meme.cooking auction, and the auction and the mainnet game open at the same moment. Before
// it, `/` is a coming-soon page: a countdown to the start, "Get REAL", and a silent trailer teaser that opens the launch
// tweet on X (or the account until there is one; the game is at `/play` all along). From
// the start `/` is the game, with a banner while the auction runs ("ends in hh:mm · Get REAL") and after it until
// coins open ("coins open soon"). The phase follows the visitor's clock.

/** v1.10: the REAL auction on meme.cooking (GET /api/auction): amounts in yocto of the deposit token (wNEAR, 24 decimals) */
export interface AuctionInfo {
  memeId: number;
  totalDeposit: string;
  softCap: string;
  hardCap?: string;
  startMs: number;
  endMs: number;
  finalized: boolean;
}

export interface LaunchConfig {
  /** ms epoch the auction opens, and the game at `/` with it; absent = not announced yet (coming soon) */
  auctionStart?: number;
  /** ms epoch it ends (the relay's default: 24 hours after the start) */
  auctionEnd?: number;
  /** the meme.cooking page of REAL; absent = PublicConfig.buyUrl, if any */
  tokenUrl?: string;
  /** the launch tweet with the trailer (x.com or twitter.com): where the coming-soon page's video card goes */
  videoUrl?: string;
  /** the game's X account: where the video card goes until there is a launch tweet; neither = no card. Also "X" in the page's footer */
  xUrl?: string;
  /** the game's Telegram (t.me or telegram.me): "Telegram" in the coming-soon page's footer (v1.8) */
  telegramUrl?: string;
}

// ---------- wallet sign-in (v1.3) ----------
// Sign in: the relay issues a nonce (AuthChallenge), the wallet signs a NEP-413 message for `recipient`, the
// relay checks the signature and, over RPC, that the key is a full-access key of the account (a new wallet's
// implicit account, the key's own 64 hex, is let in before it is on chain), then issues a
// session (AuthSession.token, sent as `Authorization: Bearer`). The WebSocket takes a one-time ticket for it
// (`/ws?ticket=`). Free play needs nothing more. Coins: the browser makes its own ed25519 key and the wallet
// adds it in one approval as a function-call key for the game contract (`play`, `call`, a small gas
// allowance). From then on the relay sends `sign_tx` for every play and call, the browser checks and signs
// it with that key, and the relay checks the signed bytes, broadcasts and tracks them. Deposits
// (ft_transfer_call on the coin) and withdrawals (`withdraw` on the game) go through the wallet.

export interface WalletConfig {
  /** NEP-413 recipient every sign-in message names, e.g. "realsies.lol" */
  recipient: string;
  /** the function-call key a browser asks its wallet to add for plays and calls without popups */
  playKey: { receiverId: string; methodNames: string[]; allowance: string };
  /** gas (units, decimal strings) the wallet transactions attach */
  gas: { deposit: string; withdraw: string; storage: string };
}

/** POST /api/auth/challenge */
export interface AuthChallenge {
  nonce: string; // 32 random bytes, base64: the NEP-413 nonce; one use, expires
  message: string;
  recipient: string;
  expiresAt: number;
}

/** POST /api/auth/verify: what the wallet returned for the challenge. */
export interface AuthProof {
  accountId: string;
  publicKey: string; // "ed25519:<base58>", a full-access key of the account
  signature: string; // base64 (also accepted: base64url, "ed25519:<base58>", hex)
  nonce: string; // the challenge nonce
  callbackUrl?: string; // only if the wallet signed one
}

/**
 * POST /api/auth/failed (v1.11): a sign-in that failed in the browser, for the operator's log (one WARN line each,
 * a few per IP). `connect`: the wallet list or the wallet did not open (closing the list counts); `sign`: the
 * chosen wallet did not sign; `verify`: the relay refused the signature, or the session did not start.
 */
export interface AuthFailure {
  stage: 'connect' | 'sign' | 'verify';
  /** NEAR Connect's wallet id, once one was chosen */
  walletId?: string;
  /** what went wrong, in the wallet's or the relay's own words (with its code) */
  message: string;
  ua: string;
  /** ms from the tap to the failure */
  ms?: number;
  /** the challenge was fetched before the tap, so the wallet opened with nothing awaited */
  prefetched?: boolean;
}

export interface PlayKeyInfo {
  publicKey: string;
  receiverId: string;
  methodNames: string[];
  allowance: string | null; // yoctoNEAR of gas left; null = unlimited
  status: 'active' | 'exhausted';
}

export interface AuthSession {
  token: string;
  accountId: string;
  expiresAt: number;
  playKey: PlayKeyInfo | null; // this browser's play key, once registered
  me: Me;
}

/** GET /api/session/wallet */
export interface WalletInfo {
  accountId: string;
  coinsOpen: boolean;
  tokenId: string;
  tokenRegistered: boolean; // NEP-145: the account can receive the coin (withdrawals need it)
  storageDeposit: string; // yoctoNEAR to register on the coin, if needed
  walletBalance?: string; // v1.5: the coin held by the wallet itself (ft_balance_of), base units; absent if unreadable
  // v1.12, only with PublicConfig.swap (a buy with NEAR is built from them); each absent if unreadable
  nearBalance?: string; // yoctoNEAR the account can spend: its balance less what its own storage holds
  wrapRegistered?: boolean; // NEP-145 on the wrap contract (near_deposit needs it)
  wnearBalance?: string; // wNEAR the wallet holds (left from an earlier buy), yocto
  wrapStorageDeposit?: string; // yoctoNEAR to register on the wrap contract, if needed
}

/**
 * v1.6: the testnet airdrop (a relay in test mode on testnet only). 100 test tokens: into the wallet of a wallet
 * account (the faucet registers it on the coin and pays the storage), straight into the game balance of a test
 * user. One per account per 10 minutes, none while the account holds 50 or more (wallet plus game balance).
 */
export const AIRDROP = { coins: 100, everyMinutes: 10, enoughCoins: 50, againBelowCoins: 20 } as const;

export type AirdropRefusal = 'airdrop_too_soon' | 'airdrop_enough';

export interface AirdropStatus {
  accountId: string;
  /** coins per airdrop (1 coin = 1 tREAL on testnet) */
  coins: number;
  /** where it lands: a wallet account's own wallet, a test user's game balance */
  to: 'wallet' | 'game';
  /** what counts toward the cap, in coins: the wallet plus the game balance (a test user: the game balance) */
  heldCoins: number;
  /** none while heldCoins is this or more */
  enoughCoins: number;
  /** under this the screen offers "airdrop again" */
  againBelowCoins: number;
  /** the last airdrop to this account (ms), null if none yet */
  lastAt: number | null;
  /** the next airdrop may run from this moment (ms); at or before now: now */
  nextAt: number;
  /** what refuses an airdrop right now, if anything (the same codes as the refusal itself) */
  blocked?: AirdropRefusal;
}

export interface AirdropResult {
  tx: string;
  coins: number;
  to: 'wallet' | 'game';
  me: Me;
  /** a wallet account: its wallet as the coin now sees it */
  wallet?: WalletInfo;
  status: AirdropStatus;
}

/** The one transaction the relay asks the browser to sign with its play key; every field is fixed. */
export interface SignRequestTx {
  signerId: string;
  publicKey: string;
  nonce: string; // decimal
  receiverId: string;
  blockHash: string; // base58
  actions: { type: 'FunctionCall'; methodName: 'play' | 'call'; args: string; gas: string; deposit: '0' }[]; // args: the exact JSON to sign
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
  kind?: 'test' | 'wallet'; // v1.3: a test user (the relay signs) or a wallet account (the browser signs)
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
  botmaster?: string; // bots entered by an AI builder: the botmaster's name
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
  botmaster?: string; // set when an AI builder entered this bot
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
  /**
   * v1.9: the builder slots (AGENT_SLOTS_PER_LEVEL a level a round, round-robin over botmasters by round id): this
   * botmaster's next three rounds with a slot and their levels, as of now
   */
  schedule?: { slotsPerLevel: number; nextRounds: { roundId: number; levels: Level[] }[] };
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
  | { t: 'ping' }
  // v1.3: the answer to sign_tx, the borsh SignedTransaction in base64; or why the browser would not sign it
  | { t: 'signed_tx'; reqId: string; signedTx: string }
  | { t: 'sign_declined'; reqId: string; reason: string };

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
  | { t: 'pong' }
  // v1.3: sign this play or call with the browser's play key (wallet accounts); answer signed_tx before expiresAt
  | { t: 'sign_tx'; reqId: string; chatId: string; purpose: 'play' | 'call'; tx: SignRequestTx; expiresAt: number }
  // v1.3: the public config changed (for example the coin was set on the contract)
  | { t: 'config'; config: PublicConfig }
  // v1.14: a practice chat's reveal, right after the call (or the missed call); the socket has nothing more to say
  | { t: 'practice_result'; result: PracticeResult };

// ---------- client interface used by the web app ----------

export interface GameClient {
  getConfig(): Promise<PublicConfig>;
  /** v1.7: the current round, public (GET /api/round): a guest watches the room before signing in, no session */
  currentRound?(): Promise<RoundState | null>;
  /** v1.10: the REAL auction on meme.cooking at a glance, public (GET /api/auction, cached 15 s by the relay) */
  auctionInfo?(): Promise<AuctionInfo>;
  /** v1.12: a quote for buying coins with NEAR or selling them for NEAR on Rhea, public (GET /api/swap/quote) */
  swapQuote?(q: SwapQuestion): Promise<SwapQuote>;
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

  // ---------- v1.3 wallet sign-in, optional (a client without them offers test users only) ----------
  authChallenge?(): Promise<AuthChallenge>;
  /** checks the signed challenge and holds the session for every later call and connect */
  authVerify?(proof: AuthProof): Promise<AuthSession>;
  /** v1.11: a failed sign-in, for the operator's log (POST /api/auth/failed); the answer does not matter */
  reportSignInFailure?(f: AuthFailure): Promise<void>;
  /** a stored session token: the session again, or null when it expired or was revoked */
  resumeSession?(token: string): Promise<AuthSession | null>;
  signOut?(): Promise<void>;
  /** after the wallet added this browser's key: the relay checks it on chain and keeps it for the session */
  registerPlayKey?(publicKey: string): Promise<PlayKeyInfo>;
  walletInfo?(): Promise<WalletInfo>;
  /** a deposit sent from the wallet: the relay checks it on chain, then pays any locked Turing bonus */
  reportDeposit?(txHash: string): Promise<{ me: Me; bonusTx?: string }>;
  /** test mode: test coins into the wallet itself (v1.6: the relay treats it as the airdrop, with its limits) */
  faucetToWallet?(coins?: number): Promise<{ tx: string }>;

  // ---------- v1.6 the testnet airdrop, optional (test mode on testnet) ----------
  airdropStatus?(accountId: string): Promise<AirdropStatus>;
  /** 100 test tokens; refused with airdrop_too_soon (one per 10 minutes) or airdrop_enough (50 or more held) */
  airdrop?(accountId: string): Promise<AirdropResult>;

  // ---------- v1.14 the practice chat, optional (a client without it offers the sign-in only) ----------
  /** may this browser have its free practice chat now (GET /api/practice) */
  practiceStatus?(device: string): Promise<PracticeStatus>;
  /**
   * Reserves the try and opens its socket (POST /api/practice, then /ws?practice=): the chat arrives as usual messages,
   * then practice_result. Refused with the PracticeRefusal as the error's code. disconnect() or connect() ends it.
   */
  startPractice?(req: PracticeRequest): Promise<void>;
}
