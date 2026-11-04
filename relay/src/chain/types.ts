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
  raw: unknown;
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

  // players, signed with the test users' function-call keys in test mode
  play(account: string, roundId: number, handle: string, coins: number): Promise<TxOutcome>;
  call(account: string, roundId: number, handle: string, human: boolean): Promise<TxOutcome>;
  withdraw(account: string, amount: bigint): Promise<TxOutcome>;
  /** Internal balance move; `from` is promo (locked bonuses) or a test user. */
  transfer(from: string, to: string, amount: bigint): Promise<TxOutcome>;
  /** ft_transfer_call from the faucet with msg {"for": account}. */
  faucetDeposit(account: string, amount: bigint): Promise<TxOutcome>;
}
