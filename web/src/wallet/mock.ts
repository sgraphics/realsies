// A simulated wallet for ?mock=1 and the tests: it holds one account's full-access key, signs NEP-413
// sign-ins with it, "adds" play keys and runs deposits and withdrawals against the mock relay's ledger
// (MockGameClient), with a short delay like a wallet popup. QA knobs: hold (never answers), reject (the
// player closes the wallet), wrongAccount, ignoreKeyAtSignIn (the wallet signs in but adds no key).

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { signNep413 } from './nep413.ts';
import { publicKeyString } from './tx.ts';
import { WalletError, type AddPlayKey, type WalletApi, type WalletSignIn, type WalletTx } from './types.ts';

export type KeyPermission = 'FullAccess' | { receiverId: string; methodNames: string[]; allowance: string | null };

/** What the mock relay offers the mock wallet: the chain's key registry and the wallet's own transactions. */
export interface MockLedger {
  ledgerAddKey(account: string, publicKey: string, permission: KeyPermission): void;
  /** Runs a transaction the wallet signed (deposit, withdraw, storage registration); its hash, or throws. */
  ledgerWalletTx(account: string, tx: WalletTx): string;
}

export interface MockWalletOptions {
  /** the account the wallet signs in as (default you.testnet) */
  accountId?: string;
  /** never answer: the "waiting for your wallet" screens */
  hold?: boolean | 'signIn' | 'key' | 'tx';
  /** the player closes the wallet */
  reject?: boolean | 'signIn' | 'key' | 'tx';
  /** while adding the play key, the wallet signs in as another account */
  wrongAccount?: boolean;
  /** the wallet cannot add a key at sign-in (signInWithFunctionCallKey off): only the AddKey transaction */
  noKeyAtSignIn?: boolean;
  /** the wallet signs in with the key request but adds no key */
  ignoreKeyAtSignIn?: boolean;
  /** the wallet adds the key at sign-in, but for any method (broader than asked) */
  broadKeyAtSignIn?: boolean;
  delayMs?: number;
}

/** The mock account's full-access key, derived from its name (stable across reloads, never a real key). */
export function mockWalletSecret(account: string): Uint8Array {
  return sha256(new TextEncoder().encode(`realsies mock wallet|${account}`));
}

export class MockWallet implements WalletApi {
  readonly kind = 'mock' as const;
  calls: string[] = [];
  private signedIn: string | null = null;

  constructor(private ledger: MockLedger, public o: MockWalletOptions = {}) {}

  private get account(): string {
    return this.o.accountId ?? 'you.testnet';
  }

  private async step(what: 'signIn' | 'key' | 'tx'): Promise<void> {
    this.calls.push(what);
    const on = (v: boolean | string | undefined) => v === true || v === what;
    if (on(this.o.hold)) await new Promise<never>(() => {});
    await new Promise((r) => setTimeout(r, this.o.delayMs ?? 600));
    if (on(this.o.reject)) throw new WalletError('rejected', 'You closed the wallet without approving.');
  }

  async signIn(msg: { message: string; recipient: string; nonce: Uint8Array }): Promise<WalletSignIn> {
    await this.step('signIn');
    const sk = mockWalletSecret(this.account);
    const publicKey = publicKeyString(ed25519.getPublicKey(sk));
    this.ledger.ledgerAddKey(this.account, publicKey, 'FullAccess');
    this.signedIn = this.account;
    return { accountId: this.account, publicKey, signature: signNep413(msg, sk), walletId: 'mock-wallet' };
  }

  async canAddKeyAtSignIn(): Promise<boolean> {
    return !this.o.noKeyAtSignIn;
  }

  async addPlayKey(p: AddPlayKey, via: 'sign-in' | 'transaction'): Promise<{ txHash?: string }> {
    await this.step('key');
    if (via === 'sign-in' && this.o.wrongAccount) throw new WalletError('wrong_account', `The wallet signed in as other.testnet. Switch it back to ${p.accountId}.`);
    if (via === 'sign-in' && this.o.noKeyAtSignIn) throw new WalletError('failed', 'This wallet cannot add a key at sign-in.');
    if (via === 'sign-in' && this.o.ignoreKeyAtSignIn) return {};
    const methodNames = via === 'sign-in' && this.o.broadKeyAtSignIn ? [] : [...p.methodNames];
    this.ledger.ledgerAddKey(p.accountId, p.publicKey, { receiverId: p.contractId, methodNames, allowance: p.allowance });
    return via === 'transaction' ? { txHash: 'mockAddKey' + Date.now().toString(36) } : {};
  }

  async send(accountId: string, txs: WalletTx[]): Promise<string[]> {
    await this.step('tx');
    if (accountId !== this.signedIn && accountId !== this.account) throw new WalletError('unavailable', 'The wallet is signed in as another account.');
    return txs.map((t) => this.ledger.ledgerWalletTx(accountId, t));
  }

  async signOut(): Promise<void> {
    this.signedIn = null;
  }
}
