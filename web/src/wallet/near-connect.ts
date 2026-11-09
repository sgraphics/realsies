// The real wallet: NEAR Connect (@hot-labs/near-connect 0.12, HOT Labs). It shows its own wallet picker,
// runs each wallet's connector in a sandboxed iframe from the wallet manifest, and lets the game ask for:
//   sign-in with a signed NEP-413 message   selectWallet, then connect({ walletId,     one approval, no gas
//                                           signMessageParams })
//   a function-call key for this browser    connect({ walletId, addFunctionCallKey }) one approval, the wallet adds the key
//   transactions                            wallet.signAndSendTransaction(s)          deposit and withdraw, with the play
//                                                                                     key's AddKey in the same approval
// Loaded on demand (its own chunk), so the game's first paint does not wait for it; warm() loads it ahead of the
// sign-in tap (on mainnet once the room is idle), so the tap opens the wallet list with nothing awaited.

import type { NearConnector, NearWalletBase } from '@hot-labs/near-connect';
import { WalletError, type AddPlayKey, type SignInFailure, type WalletApi, type WalletSignIn, type WalletTx } from './types.ts';

/** What a wallet threw, in its own words (an Error, a string, or an object from a wallet's iframe). */
function rawText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  const m = (e as { message?: unknown } | null)?.message;
  if (typeof m === 'string') return m;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

function rejected(e: unknown): boolean {
  return /reject|cancel|denied|closed|user/i.test(rawText(e));
}

/** `at`: where a sign-in failed and with which wallet, for the failure report; the wallet's own words go with it. */
function asWalletError(e: unknown, what: string, at: SignInFailure = {}): WalletError {
  if (e instanceof WalletError) {
    e.stage ??= at.stage;
    e.walletId ??= at.walletId;
    return e;
  }
  const m = rawText(e);
  if (rejected(e)) return new WalletError('rejected', `You closed the wallet without approving the ${what}.`, { ...at, detail: m });
  return new WalletError('failed', `The wallet could not ${what}: ${m}`, { ...at, detail: m });
}

/** A transaction hash from NEAR Connect's FinalExecutionOutcome; throws when the transaction failed. */
function hashOf(o: unknown): string {
  const r = o as { transaction?: { hash?: string }; transaction_outcome?: { id?: string }; status?: unknown } | null;
  const st = r?.status as { Failure?: unknown } | undefined;
  if (st && typeof st === 'object' && 'Failure' in st) throw new WalletError('tx_failed', `The transaction failed on chain: ${JSON.stringify(st.Failure).slice(0, 200)}`);
  const h = r?.transaction?.hash ?? r?.transaction_outcome?.id;
  if (!h) throw new WalletError('failed', 'The wallet did not return a transaction hash.');
  return h;
}

export class NearConnectWallet implements WalletApi {
  readonly kind = 'near-connect' as const;
  private connector: Promise<NearConnector> | null = null;
  /** the connector once loaded: a sign-in opens its wallet list with nothing awaited first */
  private loaded: NearConnector | null = null;

  /** `network` is read when the wallet is first needed (the relay's public config says which). */
  constructor(private network: () => 'mainnet' | 'testnet' | undefined) {}

  private get(): Promise<NearConnector> {
    if (this.loaded) return Promise.resolve(this.loaded);
    const network = this.network();
    if (!network) return Promise.reject(new WalletError('unavailable', 'The game is still loading; try again in a moment.', { stage: 'connect' }));
    // a load that failed is not kept: the next tap loads it again (a phone that lost the network for a moment; a
    // page from before an update, whose chunk is gone, needs a reload)
    this.connector ??= import('@hot-labs/near-connect').then(
      ({ NearConnector }) => (this.loaded = new NearConnector({ network, autoConnect: false })),
      (e) => {
        this.connector = null;
        throw new WalletError('unavailable', 'The wallet list did not load. Check your connection and try again; if it keeps failing, reload the page.', { stage: 'connect', detail: rawText(e) });
      },
    );
    return this.connector;
  }

  /** Loads NEAR Connect and its wallet list ahead of the tap (the room on mainnet, the sign-in prompt). */
  warm(): void {
    void this.get().catch(() => {});
  }

  private async connected(): Promise<NearWalletBase> {
    const c = await this.get();
    try {
      return await c.wallet();
    } catch {
      throw new WalletError('unavailable', 'Your wallet is not connected in this browser any more. Sign out and sign in again.');
    }
  }

  signIn(msg: { message: string; recipient: string; nonce: Uint8Array }): Promise<WalletSignIn> {
    // straight from the tap: with the connector loaded, its wallet list opens in this very turn
    if (this.loaded) return this.signInWith(this.loaded, msg);
    return this.get().then((c) => this.signInWith(c, msg));
  }

  /** The wallet list (stage connect), then the chosen wallet signs in and signs the message (stage sign). */
  private async signInWith(c: NearConnector, msg: { message: string; recipient: string; nonce: Uint8Array }): Promise<WalletSignIn> {
    let walletId: string;
    try {
      // what connect() does without a walletId, here so that the report knows the wallet
      walletId = await c.selectWallet({ features: { signInAndSignMessage: true } });
    } catch (e) {
      // how many wallets were on offer tells a list that came up empty (its manifest did not load) from one closed
      const err = asWalletError(e, 'sign-in', { stage: 'connect' });
      if (err.detail !== undefined) err.detail += ` (${c.availableWallets?.length ?? '?'} wallets listed)`;
      throw err;
    }
    let signed: WalletSignIn | null = null;
    const onSigned = (e: { accounts: { accountId: string; signedMessage: { publicKey: string; signature: string } }[] }) => {
      const a = e.accounts?.[0];
      if (a?.signedMessage) signed = { accountId: a.accountId, publicKey: a.signedMessage.publicKey, signature: a.signedMessage.signature };
    };
    c.on('wallet:signInAndSignMessage', onSigned);
    try {
      const wallet = await c.connect({ walletId, signMessageParams: { message: msg.message, recipient: msg.recipient, nonce: msg.nonce } });
      const got = signed as WalletSignIn | null;
      if (got) return { ...got, walletId: wallet.manifest.id };
      // a wallet that signed in without the message: ask for it on its own (a second approval)
      const accounts = await wallet.getAccounts();
      const accountId = accounts[0]?.accountId;
      if (!accountId) throw new WalletError('failed', 'The wallet returned no account.');
      const m = await wallet.signMessage({ message: msg.message, recipient: msg.recipient, nonce: msg.nonce });
      return { accountId: m.accountId || accountId, publicKey: m.publicKey, signature: m.signature, walletId: wallet.manifest.id };
    } catch (e) {
      throw asWalletError(e, 'sign-in', { stage: 'sign', walletId });
    } finally {
      c.off('wallet:signInAndSignMessage', onSigned);
    }
  }

  async canAddKeyAtSignIn(): Promise<boolean> {
    try {
      return (await this.connected()).manifest.features?.signInWithFunctionCallKey === true;
    } catch {
      return false;
    }
  }

  async addPlayKey(p: AddPlayKey, via: 'sign-in' | 'transaction'): Promise<{ txHash?: string }> {
    const wallet = await this.connected();
    try {
      if (via === 'sign-in') {
        const c = await this.get();
        const w = await c.connect({
          walletId: wallet.manifest.id,
          addFunctionCallKey: {
            contractId: p.contractId,
            publicKey: p.publicKey,
            allowMethods: { anyMethod: false, methodNames: p.methodNames },
            gasAllowance: { kind: 'limited', amount: p.allowance },
          },
        });
        const accounts = await w.getAccounts();
        if (!accounts.some((a) => a.accountId === p.accountId)) {
          throw new WalletError('wrong_account', `The wallet signed in as ${accounts[0]?.accountId ?? 'another account'}. Switch it back to ${p.accountId}.`);
        }
        return {};
      }
      const out = await wallet.signAndSendTransaction({
        signerId: p.accountId,
        receiverId: p.accountId,
        actions: [{ type: 'AddKey', params: { publicKey: p.publicKey, accessKey: { permission: { receiverId: p.contractId, allowance: p.allowance, methodNames: p.methodNames } } } }],
      });
      return { txHash: hashOf(out) };
    } catch (e) {
      throw asWalletError(e, 'play key');
    }
  }

  async send(accountId: string, txs: WalletTx[]): Promise<string[]> {
    const wallet = await this.connected();
    try {
      if (txs.length === 1) return [hashOf(await wallet.signAndSendTransaction({ signerId: accountId, receiverId: txs[0].receiverId, actions: txs[0].actions }))];
      const outs = await wallet.signAndSendTransactions({ signerId: accountId, transactions: txs.map((t) => ({ receiverId: t.receiverId, actions: t.actions })) });
      return outs.map(hashOf);
    } catch (e) {
      throw asWalletError(e, 'transaction');
    }
  }

  async signOut(): Promise<void> {
    try {
      const c = await this.get();
      await c.disconnect();
    } catch {
      /* not connected: nothing to do */
    }
  }
}
