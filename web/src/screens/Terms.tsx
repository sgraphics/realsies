// Terms, the short version: a beta game for entertainment, your own responsibility, coins are a crypto token that
// can lose all value, public transcripts, 18+. Plain words, one panel. Accepting is tracked by TERMS_VERSION in
// state/consent.ts: a new version asks everyone again.

import { Button, Icon, Panel } from '../ui/kit.tsx';
import { useEscape } from '../ui/hooks.ts';

export function TermsScreen(p: { onClose(): void; testnet?: boolean }) {
  useEscape(p.onClose);
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <Panel class="modal narrow sheet-enter px-terms">
        <div class="px-row px-head">
          <h2 class="px-title">Terms, short version</h2>
          <Button small kind="ghost" onClick={p.onClose}>Back</Button>
        </div>
        <ul class="px-terms-list">
          <li><Icon name="chat" /> Realsies is a game for entertainment: you chat with a character for two minutes, then call it. Real human or bot? It is not advice of any kind and not a way to make money.</li>
          <li><Icon name="bot" /> It is a beta. Things can break, rounds can be voided, and we may change, pause or stop the game at any time, with or without notice.</li>
          <li><Icon name="coin" /> Coins are the game's own crypto token{p.testnet ? '. Here on testnet they are test coins with no value' : ' (REAL)'}. A token can lose some or all of its value, and coins you put in the game can be lost: through the rules of a round, a bug, an outage, a smart contract or enclave failure, or a mistake with your wallet. Nothing is refunded or guaranteed. Only play with what you are fine losing. Play free if you like.</li>
          <li><Icon name="user" /> You are responsible for yourself: for your wallet and keys, for your decisions, and for checking that playing a game with crypto tokens is allowed where you live and that you are 18 or older. If it is not allowed, do not play.</li>
          <li><Icon name="shield" /> When a round ends, the transcripts of its chats are public, so anyone can check who was a bot. Keep private things private.</li>
          <li><Icon name="lock" /> Your account is a NEAR wallet. We never hold your keys and cannot recover a wallet or reverse a transaction.</li>
          <li><Icon name="star" /> Be kind to the people you meet. Some of them are real. No harassment, no scams, no cheating; we may remove players who break this.</li>
          <li><Icon name="check" /> The game is provided as is, as far as the law allows. By playing you accept all of this at your own risk.</li>
        </ul>
        <div class="px-row center">
          <Button kind="primary" onClick={p.onClose}>Got it</Button>
        </div>
      </Panel>
    </div>
  );
}
