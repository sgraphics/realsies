// The reveal of a practice chat (protocol v1.14), right after the call: it was a bot, who it was playing (the same
// persona card a round shows once it settles), whether the call was right, and the way to the real rounds: one
// button to sign in, one back to the room. It never says the partner might have been human; it only reveals.

import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { FOOLED, INVITE, NO_CALL, REVEAL_TITLE, SPOTTED } from '../state/practice.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { CharacterCanvas } from '../ui/CharacterCanvas.tsx';
import { PersonaReveal } from '../ui/PersonaCard.tsx';
import { ShareButton } from '../ui/ShareButton.tsx';
import { shareOutcome } from '../state/share.ts';

export function PracticeResultDialog(p: { store: Store; onSignIn(): void; onBack(): void }) {
  const s = useStore(p.store);
  const pr = s.practice;
  const r = pr?.result;
  if (!pr || !r) return null;
  const skin = s.chat?.partner ?? pr.skin;
  const verdict = r.right === null ? 'missed' : r.right ? 'right' : 'wrong';
  // a practice partner is always a bot: "I spotted the bot" or "A bot fooled me"; no card without a call
  const card = shareOutcome('bot', r.right);
  return (
    <div class="scrim practice-scrim">
      <div class="modal narrow px-panel sheet-enter practice-result" role="dialog" aria-modal="true" aria-labelledby="practice-title">
        <div class="practice-head">
          <div class="practice-char">
            <CharacterCanvas seed={skin.seed} size={72} />
          </div>
          <div class="practice-who">
            <h2 id="practice-title" class="px-title">{REVEAL_TITLE}</h2>
            <p class="practice-name">
              <b class="px-name">{skin.name}</b> <span class="px-tag bot">BOT</span>
            </p>
          </div>
        </div>
        <p class={'px-badge practice-verdict ' + verdict} role="status">
          <Icon name={verdict === 'right' ? 'check' : verdict === 'wrong' ? 'cross' : 'clock'} />
          {verdict === 'right' ? SPOTTED : verdict === 'wrong' ? FOOLED : NO_CALL}
        </p>
        <PersonaReveal p={r.persona} class="practice-persona" />
        <p class="px-sub practice-invite">{INVITE}</p>
        <div class="practice-actions">
          <Button kind="primary" onClick={p.onSignIn}>
            <Icon name="shield" /> Sign in
          </Button>
          {card && <ShareButton outcome={card} />}
          <Button onClick={p.onBack}>Back to room</Button>
        </div>
      </div>
    </div>
  );
}
