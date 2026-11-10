// A simulated wallet for ?mock=1 and the tests: it holds one account's full-access key, signs NEP-413
// sign-ins with it, "adds" play keys and runs deposits and withdrawals against the mock relay's ledger
// (MockGameClient), with a short delay like a wallet popup. QA knobs: hold (never answers), reject (the
// player closes the wallet), wrongAccount, ignoreKeyAtSignIn (the wallet signs in but adds no key), noBatch
// (one transaction per approval), noAddKeyTx (no AddKey from apps).

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
  /** the wallet refuses several transactions in one approval (signAndSendTransactions) */
  noBatch?: boolean;
  /** the wallet refuses an AddKey sent by the app as a transaction */
  noAddKeyTx?: boolean;
  /**
   * the wallet sends a batch all at once without waiting for each: a lone ft_transfer_call (the deposit of bought
   * coins, the sale of withdrawn ones) runs before the earlier transactions' cross-contract calls have delivered the
   * coins it moves, so it fails on chain, and the answer is a failure, as NEAR Connect reports it (QA: &nowait=1)
   */
  noWait?: boolean;
  delayMs?: number;
}

/** The mock account's full-access key, derived from its name (stable across reloads, never a real key). */
export function mockWalletSecret(account: string): Uint8Array {
  return sha256(new TextEncoder().encode(`realsies mock wallet|${account}`));
}

export class MockWallet implements WalletApi {
  readonly kind = 'mock' as const;
  calls: string[] = [];
  /** what each send() was asked to sign: the receivers and actions, one entry per approval */
  sent: string[][] = [];
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
    try {
      await this.step('signIn');
    } catch (e) {
      // like NEAR Connect: the stage and the wallet go with the failure (the report)
      if (e instanceof WalletError) Object.assign(e, { stage: 'sign', walletId: 'mock-wallet', detail: 'User rejected' });
      throw e;
    }
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
    this.sent.push(txs.map((t) => t.actions.map((a) => (a.type === 'AddKey' ? 'AddKey' : a.params.methodName)).join('+')));
    if (accountId !== this.signedIn && accountId !== this.account) throw new WalletError('unavailable', 'The wallet is signed in as another account.');
    if (this.o.noBatch && txs.length > 1) throw new WalletError('failed', 'This wallet signs one transaction at a time.');
    if (this.o.noAddKeyTx && txs.some((t) => t.actions.some((a) => a.type === 'AddKey'))) throw new WalletError('failed', 'This wallet does not add keys for apps.');
    if (this.o.noWait && txs.length > 1) {
      // each runs on its own, a lone ft_transfer_call first (it loses the race to the coins it needs); what failed
      // fails the whole answer
      const lone = (t: WalletTx) => t.actions.length === 1 && t.actions[0].type === 'FunctionCall' && t.actions[0].params.methodName === 'ft_transfer_call';
      const order = txs.map((_, i) => i).sort((a, b) => Number(lone(txs[b])) - Number(lone(txs[a])));
      const hashes: string[] = new Array(txs.length);
      let failed: Error | null = null;
      for (const i of order) {
        try {
          hashes[i] = this.ledger.ledgerWalletTx(accountId, txs[i]);
        } catch (e) {
          failed ??= e as Error;
        }
      }
      if (failed) throw new WalletError('tx_failed', `The transaction failed on chain: ${failed.message}`);
      return hashes;
    }
    // in order, like the chain: what ran before a failure stays done
    return txs.map((t) => {
      try {
        return this.ledger.ledgerWalletTx(accountId, t);
      } catch (e) {
        throw new WalletError('tx_failed', (e as Error).message);
      }
    });
  }

  async signOut(): Promise<void> {
    this.signedIn = null;
  }
}
