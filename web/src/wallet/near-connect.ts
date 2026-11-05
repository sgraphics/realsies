// The real wallet: NEAR Connect (@hot-labs/near-connect 0.12, HOT Labs). It shows its own wallet picker,
// runs each wallet's connector in a sandboxed iframe from the wallet manifest, and lets the game ask for:
//   sign-in with a signed NEP-413 message   connect({ signMessageParams })            one approval, no gas
//   a function-call key for this browser    connect({ walletId, addFunctionCallKey }) one approval, the wallet adds the key
//   transactions                            wallet.signAndSendTransaction(s)          deposit, withdraw, AddKey fallback
// Loaded on demand (its own chunk), so the game's first paint does not wait for it.

import type { NearConnector, NearWalletBase } from '@hot-labs/near-connect';
import { WalletError, type AddPlayKey, type WalletApi, type WalletSignIn, type WalletTx } from './types.ts';

function rejected(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /reject|cancel|denied|closed|user/i.test(m);
}

function asWalletError(e: unknown, what: string): WalletError {
  if (e instanceof WalletError) return e;
  const m = e instanceof Error ? e.message : String(e);
  if (rejected(e)) return new WalletError('rejected', `You closed the wallet without approving the ${what}.`);
  return new WalletError('failed', `The wallet could not ${what}: ${m}`);
}

/** A transaction hash from NEAR Connect's FinalExecutionOutcome; throws when the transaction failed. */
function hashOf(o: unknown): string {
  const r = o as { transaction?: { hash?: string }; transaction_outcome?: { id?: string }; status?: unknown } | null;
  const st = r?.status as { Failure?: unknown } | undefined;
  if (st && typeof st === 'object' && 'Failure' in st) throw new WalletError('failed', `The transaction failed on chain: ${JSON.stringify(st.Failure).slice(0, 200)}`);
  const h = r?.transaction?.hash ?? r?.transaction_outcome?.id;
  if (!h) throw new WalletError('failed', 'The wallet did not return a transaction hash.');
  return h;
}

export class NearConnectWallet implements WalletApi {
  readonly kind = 'near-connect' as const;
  private connector: Promise<NearConnector> | null = null;

  /** `network` is read when the wallet is first needed (the relay's public config says which). */
  constructor(private network: () => 'mainnet' | 'testnet' | undefined) {}

  private get(): Promise<NearConnector> {
    const network = this.network();
    if (!network) return Promise.reject(new WalletError('unavailable', 'The game is still loading; try again in a moment.'));
    this.connector ??= import('@hot-labs/near-connect').then(({ NearConnector }) => new NearConnector({ network, autoConnect: false }));
    return this.connector;
  }

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

  async signIn(msg: { message: string; recipient: string; nonce: Uint8Array }): Promise<WalletSignIn> {
    const c = await this.get();
    let signed: WalletSignIn | null = null;
    const onSigned = (e: { accounts: { accountId: string; signedMessage: { publicKey: string; signature: string } }[] }) => {
      const a = e.accounts?.[0];
      if (a?.signedMessage) signed = { accountId: a.accountId, publicKey: a.signedMessage.publicKey, signature: a.signedMessage.signature };
    };
    c.on('wallet:signInAndSignMessage', onSigned);
    try {
      const wallet = await c.connect({ signMessageParams: { message: msg.message, recipient: msg.recipient, nonce: msg.nonce } });
      const got = signed as WalletSignIn | null;
      if (got) return { ...got, walletId: wallet.manifest.id };
      // a wallet that signed in without the message: ask for it on its own (a second approval)
      const accounts = await wallet.getAccounts();
      const accountId = accounts[0]?.accountId;
      if (!accountId) throw new WalletError('failed', 'The wallet returned no account.');
      const m = await wallet.signMessage({ message: msg.message, recipient: msg.recipient, nonce: msg.nonce });
      return { accountId: m.accountId || accountId, publicKey: m.publicKey, signature: m.signature, walletId: wallet.manifest.id };
    } catch (e) {
      throw asWalletError(e, 'sign-in');
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
