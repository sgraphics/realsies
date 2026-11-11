// "Share" after a reveal (state/share.ts): the share sheet on a phone, a ready post on X elsewhere.

import { share, type ShareOutcome } from '../state/share.ts';
import { Button, Icon } from './kit.tsx';

export function ShareButton(p: { outcome: ShareOutcome; small?: boolean; class?: string }) {
  return (
    <Button small={p.small} class={p.class} onClick={() => void share(p.outcome)} title="Post what happened, with a link to the game">
      <Icon name="link" /> Share
    </Button>
  );
}
