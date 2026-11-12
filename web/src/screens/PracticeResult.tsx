// The reveal of a practice chat (protocol v1.14), right after the call: it was a bot, who it was playing (the same
// persona card a round shows once it settles), whether the call was right, and the way to the real rounds: one
// button to sign in, one back to the room. While a free try is left today, "Play again" comes first (another chat at
// once, with another character of the room). Under the invite, one quiet line where to follow Turing Hour. It never
// says the partner might have been human; it only reveals.

import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { FOOLED, INVITE, NO_CALL, PLAY_AGAIN, REVEAL_TITLE, SPOTTED, TELEGRAM_URL, X_URL, tryLeft } from '../state/practice.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { CharacterCanvas } from '../ui/CharacterCanvas.tsx';
import { PersonaReveal } from '../ui/PersonaCard.tsx';
import { ShareButton } from '../ui/ShareButton.tsx';
import { shareOutcome } from '../state/share.ts';

export function PracticeResultDialog(p: { store: Store; onSignIn(): void; onBack(): void; onPlayAgain?(): void }) {
  const s = useStore(p.store);
  const pr = s.practice;
  const r = pr?.result;
  if (!pr || !r) return null;
  // a free try left today: "Play again" first, Sign in second
  const again = !!p.onPlayAgain && tryLeft(s.config);
  const hour = s.config?.turingHour?.startUtc ?? '20:00';
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
        <p class="practice-follow">
          Turing Hour, every day at {hour} UTC: real people in the room. Reminders on{' '}
          <a class="px-link" href={TELEGRAM_URL} target="_blank" rel="noopener">Telegram</a> and{' '}
          <a class="px-link" href={X_URL} target="_blank" rel="noopener">X</a>.
        </p>
        <div class="practice-actions">
          {again && (
            <Button kind="primary" onClick={() => p.onPlayAgain?.()}>
              <Icon name="chat" /> {PLAY_AGAIN}
            </Button>
          )}
          <Button kind={again ? undefined : 'primary'} onClick={p.onSignIn}>
            <Icon name="shield" /> Sign in
          </Button>
          {card && <ShareButton outcome={card} />}
          <Button onClick={p.onBack}>Back to room</Button>
        </div>
      </div>
    </div>
  );
}
