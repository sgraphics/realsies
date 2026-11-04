// Chat: the HUD (chat timer, coins playing, round clock, menu with the test tools), the partner on a
// pedestal (left; top-left on phones) with its gamertag beneath, a small box of chat facts sized to
// its content, bubbles in the room, a burning fuse, a typing indicator, and a native input that
// behaves with phone keyboards (the column shrinks by the keyboard inset).

import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { txUrl } from '../state/format.ts';
import { World } from '../world/World.tsx';
import { useNow, useRig } from '../ui/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { Hud } from '../ui/Hud.tsx';
import { NameTag } from '../ui/NameTag.tsx';
import { themeFor } from '../../../shared/protocol.ts';

export function ChatScreen({ store, onTerms }: { store: Store; onTerms(): void }) {
  const s = useStore(store);
  const now = useNow(250);
  const chat = s.chat;
  const search = s.search;
  const cfg = s.config;
  const level = chat?.level ?? search?.level ?? s.level;
  const seatSkin = search ? s.rooms[search.level]?.seats[search.seatIndex]?.skin : undefined;
  const partner = chat?.partner ?? seatSkin;
  const theme = chat?.theme ?? (s.round ? s.round.themes[level] ?? themeFor(level, s.round.roundId) : 'castle');
  const rig = useRig(partner?.seed);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const ro = useRef<ResizeObserver | null>(null);
  // the list stays pinned to the newest message, also when the keyboard or the layout resizes it
  const listRef = useCallback((el: HTMLDivElement | null) => {
    if (list.current === el) return;
    ro.current?.disconnect();
    ro.current = null;
    list.current = el;
    if (!el) return;
    el.addEventListener('scroll', () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    });
    if (typeof ResizeObserver === 'function') {
      ro.current = new ResizeObserver(() => {
        if (pinned.current) el.scrollTop = el.scrollHeight;
      });
      ro.current.observe(el);
    }
    el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  const typingTimer = useRef<number | null>(null);
  const typingOn = useRef(false);
  const seen = useRef(0);

  // the partner looks toward the bubbles; mouth moves when their message arrives
  useEffect(() => {
    rig?.lookToward(1);
    return () => rig?.lookToward(0);
  }, [rig]);
  const msgs = chat?.messages ?? [];
  useEffect(() => {
    const fresh = msgs.slice(seen.current);
    seen.current = msgs.length;
    const theirs = fresh.filter((m) => m.from === 'them');
    if (rig && theirs.length) {
      const chars = theirs.reduce((n, m) => n + m.text.length, 0);
      rig.setTalking(true);
      const t = setTimeout(() => rig.setTalking(false), Math.min(2600, 500 + chars * 40));
      return () => clearTimeout(t);
    }
  }, [msgs.length, rig]);
  useLayoutEffect(() => {
    const el = list.current;
    const mine = msgs.length > 0 && msgs[msgs.length - 1].from === 'me';
    if (el && (pinned.current || mine)) {
      el.scrollTop = el.scrollHeight;
      pinned.current = true;
    }
  }, [msgs.length, chat?.partnerTyping, chat?.phase]);
  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  const chatting = chat?.phase === 'chatting';
  const total = (cfg?.chatSeconds ?? 120) * 1000;
  const left = chatting && chat?.endsAt ? Math.max(0, chat.endsAt - now) : total;
  const fuse = chatting ? left / total : 1;
  const paid = chat ? chat.mode === 'paid' && chat.coins > 0 : search?.mode === 'paid';
  const playing = chat ? chat.coins : search?.coins ?? 0;

  const typing = (on: boolean) => {
    if (on === typingOn.current) return;
    typingOn.current = on;
    store.actions.setTyping(on);
  };
  const onInput = (v: string) => {
    setText(v);
    if (!chatting) return;
    typing(v.length > 0);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => typing(false), 2500);
  };
  const send = () => {
    const t = text.trim();
    if (!t || !chatting) return;
    store.actions.say(t.slice(0, 280));
    setText('');
    typing(false);
  };

  let status: ComponentChildren = null;
  if (search && !chat) {
    status = (
      <div class="px-panel tight status-panel sheet-enter">
        <p class="px-sub">Finding someone to chat with…</p>
        <p class="px-dim status-sub">{search.mode === 'paid' ? `${search.coins} coins ready to play` : 'Free chat'}</p>
        <Button small onClick={() => store.actions.cancelSearch()}>Cancel</Button>
      </div>
    );
  } else if (chat && (chat.phase === 'placing' || chat.phase === 'searching')) {
    status = (
      <div class="px-panel tight status-panel sheet-enter">
        <p class="px-sub">{chat.phase === 'placing' ? `Putting ${chat.coins} coins on the table…` : 'Matched! Getting ready…'}</p>
      </div>
    );
  }

  return (
    <>
      <Hud store={store} kind="chat" onTerms={onTerms} />
      <World theme={theme} kind="chat" partner={rig} fuse={fuse}>
        {(w) => {
          const l = w.layout.kind === 'chat' ? w.layout : null;
          if (!l) return null;
          const portrait = l.orientation === 'portrait';
          const col = w.box(l.chat);
          return (
            <>
              <NameTag rect={l.partner.label} cssPx={w.scale.cssPx} name={partner?.name ?? '…'} lines={l.label.lines} tone="live" />
              <div class={'chat-info-slot' + (portrait ? ' side' : '')} style={w.box(l.info)}>
                <div class="px-panel tight chat-info">
                  <p class="ci-row">
                    <Icon name="coin" />
                    {paid ? <span>Playing <b>{playing}</b> coins</span> : <span>Free chat</span>}
                  </p>
                  <p class="ci-row ci-call">
                    <Icon name="chat" />
                    <span>{portrait ? 'Then call it:' : 'Two minutes, then you call it:'} <b>real human?</b></span>
                  </p>
                  {chat?.playTx && (
                    <a class="px-link ci-row ci-link" href={txUrl(cfg, chat.playTx)} target="_blank" rel="noreferrer">
                      <Icon name="link" /> play on chain
                    </a>
                  )}
                </div>
              </div>
              <div class="chat-col" style={{ ...col, height: `calc(${col.height} - var(--kb))` }}>
                <div class="chat-messages" ref={listRef} aria-live="polite">
                  {status}
                  {chatting && msgs.length === 0 && <div class="chat-note">Say hi. You have two minutes.</div>}
                  {chat?.playFailed && <div class="chat-note">Coins not placed ({chat.playFailed}). This chat is free.</div>}
                  {msgs.map((m) => (
                    <div key={m.id} class={'bubble ' + (m.from === 'me' ? 'me' : 'them')}>{m.text}</div>
                  ))}
                  {chat?.partnerTyping && (
                    <div class="bubble them typing" aria-label="typing"><i /><i /><i /></div>
                  )}
                </div>
                <form
                  class="chat-input px-panel tight"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <input
                    class="px-input"
                    type="text"
                    enterKeyHint="send"
                    autoComplete="off"
                    autoCorrect="on"
                    maxLength={280}
                    placeholder={chatting ? 'Type a message…' : 'Waiting…'}
                    value={text}
                    disabled={!chatting}
                    onInput={(e) => onInput((e.target as HTMLInputElement).value)}
                    aria-label="Message"
                  />
                  <Button type="submit" kind="primary" disabled={!chatting || !text.trim()}>Send</Button>
                </form>
              </div>
            </>
          );
        }}
      </World>
    </>
  );
}
