// Chain adapter interface: the game contract on NEAR (real) or an in-memory mock with the same rules.

export interface TxOutcome {
  hash: string;
  ok: boolean;
  /** Parsed return value of the function call, when any. */
  value?: unknown;
  error?: string;
}

export interface CommitItem {
  character_id: string;
  commitment: string;
}

export interface BotProof {
  viewer: string;
  text: string;
  signature: string;
  request: string;
}

/** Exactly the contract's Opening (spec section 3). */
export interface Opening {
  character_id: string;
  kind: 'bot' | 'human';
  salt: string;
  payout: string;
  model?: string;
  prompt_hash?: string;
  signers?: string[];
  account?: string;
  proofs?: BotProof[];
  viewers?: string[];
}

export interface OpenReport {
  character_id: string;
  ok: boolean;
  assigned: number;
  rejected: string[];
}

/** Normalized play as read back from the chain. */
export interface ChainPlay {
  handle: string;
  account: string;
  coins: number;
  amount: bigint;
  locked: bigint;
  call: boolean | null;
  characterId: string | null;
  /** Credited at settlement (locked back plus reward, refund, or 0); null before settlement. */
  credited: bigint | null;
}

export interface ChainRound {
  roundId: number;
  secretHash: string;
  endsAtMs: number;
  revealed: boolean;
  settled: boolean;
  /** plays and characters still stored for the round (0 and 0 once pruned) */
  plays?: number;
  characters?: number;
  raw: unknown;
}

export interface ChainCharacter {
  characterId: string;
  commitment: string;
  opened: boolean;
  kind?: 'bot' | 'human';
  payout?: string;
  raw: unknown;
}

export interface ChainConfig {
  coinUnit: bigint;
  feeBps: number;
  rightBps: number;
  characterBps: number;
  minCoins: number;
  maxCoins: number;
  callGraceMs: number;
  openWindowMs: number;
  testMode: boolean;
  token?: string;
  /** the contract has a coin and a coin unit: deposits and paid plays work (false on mainnet before REAL launches) */
  coinsOpen: boolean;
  raw: unknown;
}

/** view_access_key */
export interface AccessKeyView {
  nonce: bigint;
  /** base58 hash of the block the view was taken at: a recent block hash to sign with */
  blockHash: string;
  blockHeight: number;
  permission: 'FullAccess' | { receiverId: string; methodNames: string[]; allowance: string | null };
}

/** A finished transaction as read back by hash (a player's own deposit, for example). */
export interface TxDetails {
  hash: string;
  ok: boolean;
  signerId: string;
  receiverId: string;
  actions: { method?: string; args?: unknown; deposit?: string }[];
  /** every receipt's logs, in order (EVENT_JSON lines included) */
  logs: string[];
  error?: string;
}

export interface ChainAccounts {
  operator: string;
  faucet: string;
  promo: string;
  fund: string;
  house: string;
  bots: string;
}

export interface TestUserKey {
  accountId: string;
  label: string;
}

export interface ChainAdapter {
  readonly kind: 'mock' | 'near';
  readonly network: 'testnet' | 'mainnet';
  readonly contractId: string;
  /** the coin; the contract's own `token` once get_config has been read (it wins over the secrets file) */
  readonly tokenId: string;
  readonly tokenDecimals: number;
  readonly accounts: ChainAccounts;
  readonly testUsers: TestUserKey[];

  init(): Promise<void>;
  /** Signing keys queued but not yet sent, for diagnostics. */
  queueDepth(): Record<string, number>;

  // views
  getConfig(): Promise<ChainConfig>;
  balanceOf(account: string): Promise<bigint>;
  getRound(roundId: number): Promise<ChainRound | null>;
  getCharacter(roundId: number, characterId: string): Promise<ChainCharacter | null>;
  getPlay(roundId: number, handle: string): Promise<ChainPlay | null>;
  getRoundPlays(roundId: number): Promise<ChainPlay[]>;

  // operator
  startRound(roundId: number, secretHash: string, endsAtMs: number): Promise<TxOutcome>;
  commitCharacters(roundId: number, items: CommitItem[]): Promise<TxOutcome>;
  endRoundNow(roundId: number): Promise<TxOutcome>;
  revealRound(roundId: number, secret: string): Promise<TxOutcome>;
  openCharacters(roundId: number, openings: Opening[]): Promise<TxOutcome & { reports?: OpenReport[] }>;
  settleRound(roundId: number): Promise<TxOutcome>;
  /**
   * Frees a settled round's storage: deletes up to `limit` (default 200, 1 to 500) of its plays, then
   * characters. `remaining` is how many are left; call until 0. Afterwards get_play, get_round_plays and
   * get_character return nothing for the round; get_round still returns it (settled, empty lists).
   */
  pruneRound(roundId: number, limit?: number): Promise<TxOutcome & { remaining?: number }>;

  // players, signed with the test users' function-call keys in test mode
  play(account: string, roundId: number, handle: string, coins: number): Promise<TxOutcome>;
  call(account: string, roundId: number, handle: string, human: boolean): Promise<TxOutcome>;
  withdraw(account: string, amount: bigint): Promise<TxOutcome>;
  /** Internal balance move; `from` is promo (locked bonuses) or a test user. */
  transfer(from: string, to: string, amount: bigint): Promise<TxOutcome>;
  /** ft_transfer_call from the faucet with msg {"for": account}. */
  faucetDeposit(account: string, amount: bigint): Promise<TxOutcome>;
  /** Test mode: the faucet sends coins to the account's own wallet (registering it on the token first if needed). */
  faucetToWallet(account: string, amount: bigint): Promise<TxOutcome>;

  // wallet accounts (v1.3): the relay holds no key of theirs
  /**
   * view_access_key; null when the account or the key does not exist. `hint` says what the caller expects
   * (a sign-in key or a play key); only the keyless dev mock reads it (MockChain.trustUnknownKeys).
   */
  viewAccessKey(accountId: string, publicKey: string, hint?: 'full' | 'play'): Promise<AccessKeyView | null>;
  /**
   * Broadcasts a transaction a player signed (borsh SignedTransaction) and waits for its outcome; the same
   * bytes are resent on rate limits and network errors. `code` tells a stale nonce or block hash
   * ('nonce', 'expired') or a play key out of gas allowance ('allowance') from other failures.
   */
  sendSignedTx(bytes: Uint8Array, signerId: string, method: string): Promise<TxOutcome & { code?: 'nonce' | 'expired' | 'allowance' | 'key'; akNonce?: bigint }>;
  /** A transaction by hash and signer, once executed; null while unknown. */
  txDetails(hash: string, signerId: string): Promise<TxDetails | null>;
  /** NEP-145 on the coin: whether the account is registered, and the deposit that registers one (yoctoNEAR). */
  tokenStorage(accountId: string): Promise<{ registered: boolean; minDeposit: string }>;
}
