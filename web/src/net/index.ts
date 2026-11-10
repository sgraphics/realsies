// Picks the game client: MockGameClient with ?mock=1 (an in-browser relay), else the real relay. And the
// wallet: NEAR Connect against a real relay, the simulated MockWallet in mock mode.
//   ?mock=1&wallet=1            like a mainnet relay: no test users, sign in with the (mock) wallet
//   ?mock=1&wallet=test         like the testnet relay: test mode (test users, faucet), and QA signs in with the mock wallet
//   &coins=closed               the contract has no coin yet: free play only
//   &net=mainnet                with &wallet=1: the config says mainnet (REAL, "Buy REAL", mainnet explorer links)
//   &hold=signIn|key|tx         the mock wallet never answers that step (QA: "waiting for your wallet")
//   &reject=signIn|key|tx       the player closes the mock wallet at that step
//   &launch=soon|auction|finalizing   a mainnet relay before REAL is live (wallet sign-in, no coin yet): soon is
//                               the coming-soon page at / (the game at /play), auction and finalizing the game
//                               with its banner; &startin=3 starts the auction 3 s in (the page turns into the
//                               game), &opens=5 sets the coin 5 s in (the banner goes), &notoken=1 no token page;
//                               the video card opens the launch tweet, &tweet=0 the account instead, &nox=1 no card
//                               (and no X in the footer); the footer links Telegram, X and Terms, &notg=1 no Telegram
//   &betaclosed=1               the testnet beta is over (config.betaClosed): the game's note, then after 5 s the mock
//                               launch page with ?beta=over (also: ?mock=1&launch=soon&beta=over for that page alone)
//   &swap=1                     coins for NEAR on Rhea (protocol v1.12, config.swap): the coins dialog buys with NEAR and
//                               withdraws as NEAR; the mock plays wrap.testnet and the pool contract (400 coins per NEAR);
//                               &moved=1 the price moves past every swap (nothing bought or sold, everything comes back)
//   &turing=soon|on             Turing Hour (protocol v1.13): it starts 3 h 12 min from now, or it started 20 minutes ago
//   &practice=0                 no practice chat for guests (protocol v1.14; on by default, one a day, like the relay)
//   &practicecap=1              every guest's practice chats for today are gone: a try is refused (practice_cap)

import type { GameClient } from '../../../shared/protocol.ts';
import { MockGameClient, type MockOptions, resetMockState } from './mock.ts';
import { RealGameClient } from './real.ts';
import type { WalletApi } from '../wallet/types.ts';
import { MockWallet, type MockWalletOptions } from '../wallet/mock.ts';
import { NearConnectWallet } from '../wallet/near-connect.ts';
import { mockLaunch, mockLaunchOf } from '../launch/phase.ts';
import { mockTuringHour } from '../launch/turing.ts';

export { MockGameClient, RealGameClient, resetMockState };
export type { MockOptions };

export function isMockMode(search: string = (globalThis as { location?: Location }).location?.search ?? ''): boolean {
  const q = new URLSearchParams(search);
  const v = q.get('mock');
  return v !== null && v !== '0' && v !== 'false';
}

/** "Buy REAL" in mock mode (the meme.cooking page the real relay's BUY_URL points at before the launch). */
export const MOCK_BUY_URL = 'https://meme.cooking';

export function createClient(search?: string): GameClient {
  if (isMockMode(search)) {
    const q = new URLSearchParams(search ?? (globalThis as { location?: Location }).location?.search ?? '');
    const round = Number(q.get('round'));
    const searchMs = Number(q.get('searchms')); // QA: hold the search this long (screenshots of "finding someone")
    const launch = mockLaunchOf(q.toString());
    const opens = Number(q.get('opens'));
    const startIn = Number(q.get('startin'));
    const token = q.get('notoken') !== '1';
    // the video card (the launch tweet, the account, none) and the footer's Telegram and X
    const links = { tweet: q.get('tweet') !== '0', x: q.get('nox') !== '1', telegram: q.get('notg') !== '1' };
    const turingHour = mockTuringHour(q.get('turing'));
    const client = new MockGameClient({
      longNames: q.get('longnames') === '1',
      ...(round > 1 ? { startRoundId: round } : {}),
      ...(searchMs > 0 ? { searchMs: [searchMs, searchMs] as [number, number] } : {}),
      ...(q.get('nobots') === '1' ? { noBots: true } : {}), // the bots are napping: no new chats (bots_unavailable)
      ...(q.get('betaclosed') === '1' ? { betaClosed: true } : {}), // the testnet beta is over: the note, then the launch page with ?beta=over
      ...(q.get('wallet') === '1' ? { wallet: true, buyUrl: MOCK_BUY_URL, storageKey: 'realsies:mock:wallet:v1' } : {}),
      ...(q.get('wallet') === '1' && q.get('net') === 'mainnet' ? { mainnet: true, storageKey: 'realsies:mock:wallet-main:v1' } : {}),
      ...(q.get('wallet') === 'test' ? { buyUrl: MOCK_BUY_URL, storageKey: 'realsies:mock:wallet-test:v1' } : {}),
      ...(q.get('coins') === 'closed' ? { coinsOpen: false } : {}),
      ...(q.get('swap') === '1' ? { swap: true } : {}),
      ...(q.get('moved') === '1' ? { priceMoves: true } : {}),
      ...(turingHour ? { turingHour } : {}),
      ...(q.get('practice') === '0' ? { practicePerDay: 0 } : {}), // no practice chat for guests (v1.14)
      ...(q.get('practicecap') === '1' ? { practiceCap: true } : {}), // every guest's practice chats for today are gone
      ...(launch
        ? {
            wallet: true, mainnet: true, coinsOpen: false, storageKey: 'realsies:mock:launch:v1', ...(token ? { buyUrl: MOCK_BUY_URL } : {}),
            launch: mockLaunch(launch, Date.now(), { token, ...links, ...(q.get('startin') !== null && startIn >= 0 ? { startInMs: startIn * 1000 } : {}) }),
            ...(opens >= 0 && q.get('opens') !== null ? { opensAfterMs: opens * 1000 } : {}),
          }
        : {}),
    });
    (globalThis as { realsiesMock?: MockGameClient }).realsiesMock = client; // console access in mock mode
    return client;
  }
  return new RealGameClient();
}

/** The wallet for a client: the mock wallet on the mock relay's ledger, NEAR Connect otherwise. */
export function createWallet(client: GameClient, network: () => 'mainnet' | 'testnet' | undefined, search?: string): WalletApi {
  if (client instanceof MockGameClient) {
    const q = new URLSearchParams(search ?? (globalThis as { location?: Location }).location?.search ?? '');
    const step = (v: string | null): MockWalletOptions['hold'] => (v === 'signIn' || v === 'key' || v === 'tx' ? v : v === '1' ? true : undefined);
    const as = q.get('as');
    const wallet = new MockWallet(client, {
      ...(as && (q.get('wallet') === '1' || q.get('wallet') === 'test' || mockLaunchOf(q.toString())) ? { accountId: as.includes('.') ? as : `${as}.testnet` } : {}),
      hold: step(q.get('hold')),
      reject: step(q.get('reject')),
      // &nowait=1: a wallet that sends a batch all at once (the deposit of bought coins fails: they wait in the wallet)
      ...(q.get('nowait') === '1' ? { noWait: true } : {}),
    });
    (globalThis as { realsiesWallet?: MockWallet }).realsiesWallet = wallet;
    return wallet;
  }
  return new NearConnectWallet(network);
}
