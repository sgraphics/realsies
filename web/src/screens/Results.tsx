// Round results: score, coins, Turing bonus, rating, the free player's "would have won", the locked
// bonus, and every chat revealed with a Verify button on bot chats and, when the relay sends one,
// the persona card of who the bot was playing.

import { useEffect, useState } from 'preact/hooks';
import type { ChatResult, Level, RoundResults } from '../../../shared/protocol.ts';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { botmasterOf, coins2, fmtCoins, fmtPct, fmtSigned, shortHash, txUrl } from '../state/format.ts';
import { Button, Coins, Icon, Panel } from '../ui/kit.tsx';
import { CharacterCanvas } from '../ui/CharacterCanvas.tsx';
import { PersonaReveal } from '../ui/PersonaCard.tsx';
import { ShareButton } from '../ui/ShareButton.tsx';
import { shareOutcome } from '../state/share.ts';

export interface ResultsProps {
  store: Store;
  roundId: number;
  onVerify(chatId: string): void;
  onClose(): void;
  onDeposit(): void;
}

function callWord(c: boolean | null): string {
  return c === null ? 'no call' : c ? 'HUMAN' : 'BOT';
}

function ChatRow({ c, onVerify, presetLow }: { c: ChatResult; onVerify(id: string): void; presetLow: number }) {
  const verdict = c.right === null ? 'missed' : c.right ? 'right' : 'wrong';
  const card = shareOutcome(c.truth, c.right);
  return (
    <li class={'px-result-row ' + verdict}>
      <div class="px-result-char">
        <CharacterCanvas seed={c.partner.seed} size={72} />
      </div>
      <div class="px-col px-result-body">
        <div class="px-row px-wrap">
          <b class="px-name">{c.partner.name}</b>
          <span class={'px-tag ' + (c.truth === 'human' ? 'human' : 'bot')}>{c.truth === 'human' ? 'HUMAN' : 'BOT'}</span>
          {c.model && <span class="px-dim px-mono px-small">{c.model}</span>}
          {c.truth === 'bot' && botmasterOf(c) && <span class="px-dim px-small">entered by <b>{botmasterOf(c)}</b></span>}
          {c.partnerAccount && <span class="px-dim px-mono px-small">{c.partnerAccount}</span>}
        </div>
        {c.truth === 'bot' && <PersonaReveal p={c.persona} />}
        <div class="px-row px-wrap">
          <span>
            You called <b>{callWord(c.myCall)}</b>
          </span>
          <span class={'px-badge ' + verdict}>
            {verdict === 'right' ? <Icon name="check" /> : verdict === 'wrong' ? <Icon name="cross" /> : <Icon name="clock" />} {verdict === 'right' ? 'Right' : verdict === 'wrong' ? 'Wrong' : 'Missed'}
          </span>
          {card && <ShareButton small outcome={card} />}
        </div>
        <div class="px-row px-wrap px-small">
          {c.mode === 'paid' ? (
            <span>
              <Coins n={coins2(c.coinsDelta)} signed /> <span class="px-dim">on {c.coins} played</span>
            </span>
          ) : (
            <span class="px-dim">
              Free{c.wouldHaveCoins !== undefined && c.right !== null ? ` · at ${presetLow} coins: ${fmtCoins(c.wouldHaveCoins, true)}` : ''}
            </span>
          )}
          <span class={c.ratingDelta >= 0 ? 'px-up' : 'px-down'}>
            <Icon name="star" /> {fmtSigned(c.ratingDelta)}
          </span>
          <span class="px-dim">
            {c.roomSplit.paidCalls ? `${c.roomSplit.paidCalls} paid call${c.roomSplit.paidCalls === 1 ? '' : 's'}, ${fmtPct(c.roomSplit.paidHumanShare)} said human` : 'No paid calls on this character'}
          </span>
        </div>
      </div>
      {c.verifiable && (
        <Button small kind="primary" class="px-verify-btn" onClick={() => onVerify(c.chatId)} title="Check the enclave signatures yourself">
          <Icon name="shield" /> Verify
        </Button>
      )}
    </li>
  );
}

export function ResultsScreen(p: ResultsProps) {
  const st = useStore(p.store);
  const [res, setRes] = useState<RoundResults | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    setRes(null);
    setErr('');
    p.store.actions
      .getResults(p.roundId)
      .then((r) => {
        if (!live) return;
        setRes(r);
        if (r.status === 'settled') p.store.actions.markResultsSeen(p.roundId);
      })
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [p.roundId, p.store]);

  const cfg = st.config;
  const levels = res ? [...new Set(res.chats.map((c) => c.level))] : [];
  const presetLow = cfg ? Math.min(...(levels.length ? levels : [1 as Level]).map((l) => cfg.presets[l][0])) : 5;
  const free = res ? res.chats.filter((c) => c.mode === 'free' && c.right !== null) : [];
  const paid = res ? res.chats.filter((c) => c.mode === 'paid') : [];
  const ratingDelta = res ? res.ratingAfter - res.ratingBefore : 0;
  const links = res
    ? [
        ['reveal', res.chain.revealTx],
        ...res.chain.openTxs.map((t, i) => [res.chain.openTxs.length > 1 ? `open ${i + 1}` : 'open', t]),
        ['settle', res.chain.settleTx],
      ].filter((x): x is [string, string] => !!x[1])
    : [];

  return (
    <Panel class="px-results">
      <div class="px-row px-head">
        <h2 class="px-title">Round {p.roundId} results</h2>
        <Button small kind="ghost" onClick={p.onClose}>
          Back
        </Button>
      </div>
      {err && <p class="px-error">{err}</p>}
      {!res && !err && <p class="px-dim">Opening the round…</p>}
      {res && res.status !== 'settled' && (
        <p class="px-sub">
          <Icon name="lock" /> Results open when the round ends and every character is revealed on chain.
        </p>
      )}
      {res && res.status === 'settled' && (
        <>
          <div class="px-results-summary">
            <div class="px-stat px-stat-big">
              You called <b>{res.calledRight}</b> of <b>{res.calledTotal}</b> right
            </div>
            {paid.length > 0 && (
              <div class="px-stat">
                <span class="px-dim">Coins</span> <Coins n={coins2(res.coinsDelta)} signed value={cfg} />
              </div>
            )}
            {res.turingBonusCoins > 0 && (
              <div class="px-stat">
                <span class="px-dim">Turing bonus</span> <Coins n={coins2(res.turingBonusCoins)} signed />{' '}
                <span class="px-dim px-small">from players who thought you were a bot</span>
              </div>
            )}
            <div class="px-stat">
              <span class="px-dim">Rating</span> <Icon name="star" /> {res.ratingBefore} → <b>{res.ratingAfter}</b>{' '}
              <span class={ratingDelta >= 0 ? 'px-up' : 'px-down'}>({fmtSigned(ratingDelta)})</span>
            </div>
          </div>

          {free.length > 0 && (
            <div class="px-nag">
              <p>
                {res.wouldHaveCoins >= 0
                  ? `Played at ${presetLow} coins each, that would have been about +${fmtCoins(res.wouldHaveCoins)} coins.`
                  : `Played at ${presetLow} coins each, that would have cost about ${fmtCoins(-res.wouldHaveCoins)} coins.`}
                {res.wouldHaveCoins >= 0 && ' Deposit to earn.'}
              </p>
              {res.wouldHaveCoins >= 0 && (
                <Button kind="primary" onClick={p.onDeposit}>
                  <Icon name="coin" /> Deposit to earn
                </Button>
              )}
            </div>
          )}

          {res.lockedBonusCoins > 0 && (
            <div class="px-nag px-locked-bonus">
              <p>
                <Icon name="lock" /> {fmtCoins(res.lockedBonusCoins)} coins earned from players who thought you were a bot. Deposit to unlock.
              </p>
              <Button kind="primary" onClick={p.onDeposit}>
                Deposit to unlock
              </Button>
            </div>
          )}

          {res.chats.length === 0 ? (
            <p class="px-dim">You did not chat in this round.</p>
          ) : (
            <ul class="px-results-list">
              {res.chats.map((c) => (
                <ChatRow key={c.chatId} c={c} onVerify={p.onVerify} presetLow={cfg?.presets[c.level][0] ?? presetLow} />
              ))}
            </ul>
          )}

          {links.length > 0 && (
            <div class="px-row px-wrap px-links px-small">
              <span class="px-dim">On chain:</span>
              {links.map(([label, tx]) => (
                <a key={label + tx} class="px-link" href={txUrl(cfg, tx)} target="_blank" rel="noreferrer">
                  {label} {shortHash(tx, 4)} <Icon name="link" />
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
