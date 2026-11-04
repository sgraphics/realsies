// Seat dialog: the character larger, its gamertag, the level's coin presets with dollar labels,
// a custom amount, or Play free. Free players see a one-tap "Deposit to earn".

import { useMemo, useState } from 'preact/hooks';
import type { Level, Seat, ThemeId } from '../../../shared/protocol.ts';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { Portrait } from '../ui/Portrait.tsx';
import { useEscape, useRig } from '../ui/hooks.ts';

export function SeatDialog(p: { store: Store; level: Level; seat: Seat; theme: ThemeId; onClose(): void; onDeposit(): void }) {
  const s = useStore(p.store);
  const cfg = s.config;
  const me = s.me;
  const rig = useRig(p.seat.skin.seed);
  useEscape(p.onClose);
  const presets = cfg?.presets[p.level] ?? [5, 10, 25];
  const min = cfg?.minCoins ?? 5, max = cfg?.maxCoins ?? 500;
  const usd = cfg?.usdPerCoin ?? 0.01;
  const balance = me?.balanceCoins ?? 0;
  const [custom, setCustom] = useState('');
  const customN = Math.floor(Number(custom));
  const customOk = custom !== '' && Number.isFinite(customN) && customN >= min && customN <= max && customN <= balance;
  const freeLeft = me?.freeChatsLeft;
  const dollars = (n: number) => '$' + (n * usd).toFixed(n * usd < 1 ? 2 : 2);
  const pick = (mode: 'free' | 'paid', coins?: number) => {
    p.store.actions.pickSeat(p.level, p.seat.index, mode, coins);
    p.onClose();
  };
  const best = useMemo(() => presets.filter((c) => c <= balance), [presets, balance]);

  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div class="modal narrow px-panel sheet-enter" role="dialog" aria-modal="true" aria-label={`Chat with ${p.seat.skin.name}`}>
        <Button small kind="ghost" class="close" onClick={p.onClose} title="Close"><Icon name="cross" /></Button>
        <div class="seat-dialog">
          <div class="seat-portrait">
            <Portrait theme={p.theme} rig={rig} height={228} selected />
          </div>
          <div class="px-col" style={{ minWidth: 0 }}>
            <div>
              <p class="px-label px-dim">Chat for two minutes with</p>
              <h2 class="px-title" style={{ wordBreak: 'break-all' }}>{p.seat.skin.name}</h2>
              <p class="px-body px-dim" style={{ marginTop: '6px' }}>Then make your call: real human, yes or no?</p>
            </div>
            {balance > 0 ? (
              <>
                <p class="px-label">Put coins on the table</p>
                <div class="preset-grid">
                  {presets.map((c) => (
                    <Button key={c} kind={c === best[best.length - 1] ? 'primary' : 'default'} class="preset" disabled={c > balance} onClick={() => pick('paid', c)} title={c > balance ? 'Not enough coins' : `Play ${c} coins`}>
                      <span><Icon name="coin" /> {c}</span>
                      <span class="usd">{dollars(c)}</span>
                    </Button>
                  ))}
                </div>
                <form class="custom-row" onSubmit={(e) => { e.preventDefault(); if (customOk) pick('paid', customN); }}>
                  <input class="px-input" type="number" inputMode="numeric" min={min} max={Math.min(max, balance)} placeholder={`${min}-${Math.min(max, balance)}`} value={custom} onInput={(e) => setCustom((e.target as HTMLInputElement).value)} aria-label="Custom amount of coins" />
                  <Button type="submit" disabled={!customOk}>{customOk ? `Play ${customN} (${dollars(customN)})` : 'Custom'}</Button>
                </form>
                <p class="px-dim" style={{ fontSize: '13px', margin: 0 }}>Right calls share the coins of wrong ones. You have <Icon name="coin" /> {balance}.</p>
              </>
            ) : (
              <div class="px-panel tight light">
                <p class="px-sub" style={{ marginBottom: '8px' }}>You are in free mode: score and rating, no coins either way.</p>
                <Button kind="primary" small onClick={p.onDeposit}><Icon name="coin" /> Deposit to earn</Button>
              </div>
            )}
            <div class="px-row">
              <Button kind={balance > 0 ? 'default' : 'primary'} onClick={() => pick('free')} disabled={freeLeft === 0}>
                Play free
              </Button>
              {freeLeft != null && <span class="px-dim" style={{ fontSize: '13px' }}>{freeLeft} free chats left today</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
