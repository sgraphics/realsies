// The wallet as the game sees it: NEAR Connect in the browser (near-connect.ts), a simulated wallet with
// ?mock=1 (mock.ts). Every method is one wallet approval at most.

/** NEAR Connect's action format (near-wallet-selector style), the subset the game sends. */
export type WalletAction =
  | { type: 'FunctionCall'; params: { methodName: string; args: object; gas: string; deposit: string } }
  | { type: 'AddKey'; params: { publicKey: string; accessKey: { permission: { receiverId: string; allowance?: string; methodNames?: string[] } } } };

export interface WalletTx {
  receiverId: string;
  actions: WalletAction[];
}

export interface WalletSignIn {
  accountId: string;
  /** the key that signed: must be a full-access key of the account */
  publicKey: string;
  signature: string;
  walletId?: string;
}

export interface AddPlayKey {
  accountId: string;
  publicKey: string;
  contractId: string;
  methodNames: string[];
  /** yoctoNEAR of gas the key may spend over its life */
  allowance: string;
}

/** Where a sign-in failed, for the failure report (protocol v1.11): opening the wallet list or the wallet, or signing. */
export interface SignInFailure {
  stage?: 'connect' | 'sign';
  /** the wallet the player chose, once chosen */
  walletId?: string;
  /** the wallet's own words, before they became a line for the screen */
  detail?: string;
}

/**
 * `rejected`: the player closed the wallet. `tx_failed`: a transaction was sent and failed on chain. `failed`:
 * the wallet itself could not do it (a wallet that refuses a batch, or an action): the game may try another way.
 */
export class WalletError extends Error {
  stage?: SignInFailure['stage'];
  walletId?: string;
  detail?: string;
  constructor(readonly code: 'rejected' | 'wrong_account' | 'unavailable' | 'failed' | 'tx_failed', message: string, at: SignInFailure = {}) {
    super(message);
    this.stage = at.stage;
    this.walletId = at.walletId;
    this.detail = at.detail;
  }
}

export interface WalletApi {
  readonly kind: 'near-connect' | 'mock';
  /** Load the wallet list ahead of the first click (optional). */
  warm?(): void;
  /**
   * Sign in and sign the NEP-413 message in one approval; no transaction, no gas. Called straight from the tap:
   * once warm, nothing is awaited before the wallet list opens (a phone blocks a wallet opened after an await).
   * A failure is a WalletError with its stage and, once chosen, the wallet.
   */
  signIn(msg: { message: string; recipient: string; nonce: Uint8Array }): Promise<WalletSignIn>;
  /**
   * The wallet adds the browser's play key. `via: 'sign-in'` asks for it the way NEAR Connect's sign-in
   * adds a function-call key; `via: 'transaction'` sends an AddKey transaction instead.
   */
  addPlayKey(p: AddPlayKey, via: 'sign-in' | 'transaction'): Promise<{ txHash?: string }>;
  /** Whether the connected wallet can add a key at sign-in (else only the AddKey transaction works). */
  canAddKeyAtSignIn(): Promise<boolean>;
  /** Wallet transactions in order, in one approval (signAndSendTransactions); resolves with their hashes. */
  send(accountId: string, txs: WalletTx[]): Promise<string[]>;
  signOut(): Promise<void>;
}
