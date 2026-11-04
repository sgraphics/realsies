// Terms, the short version: what Realsies is, coins, public transcripts, 18+. Friendly, one panel.

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
          <li><Icon name="chat" /> Realsies is a game: you chat with a character for two minutes, then call it. Real human or bot?</li>
          <li><Icon name="coin" /> It has in-game coins and small payments. Coins are the game's own token{p.testnet ? '; here on testnet they are test coins with no value' : ''}. Play free if you like.</li>
          <li><Icon name="shield" /> When a round ends, the transcripts of its chats are public, so anyone can check who was a bot. Keep private things private.</li>
          <li><Icon name="user" /> You need to be 18 or older to play.</li>
          <li><Icon name="star" /> Be kind to the people you meet. Some of them are real.</li>
        </ul>
        <div class="px-row center">
          <Button kind="primary" onClick={p.onClose}>Got it</Button>
        </div>
      </Panel>
    </div>
  );
}
