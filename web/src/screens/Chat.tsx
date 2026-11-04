// Chat: partner on a pedestal (left; top on phones), bubbles on the right, a burning fuse for
// the two minutes, typing indicator, and a native input that behaves with phone keyboards.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Store } from '../state/store.ts';
import { useStore } from '../state/hooks.ts';
import { fmtClock, txUrl } from '../state/format.ts';
import { World } from '../world/World.tsx';
import { useNow, useRig } from '../ui/hooks.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { THEME_NAMES, themeFor } from '../../../shared/protocol.ts';

export function ChatScreen({ store }: { store: Store }) {
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
  const list = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, chat?.partnerTyping, chat?.phase]);
  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  const chatting = chat?.phase === 'chatting';
  const total = (cfg?.chatSeconds ?? 120) * 1000;
  const left = chatting && chat?.endsAt ? Math.max(0, chat.endsAt - now) : total;
  const fuse = chatting ? left / total : 1;

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
        <p class="px-dim" style={{ fontSize: '13px', margin: '6px 0' }}>{search.mode === 'paid' ? `${search.coins} coins ready to play` : 'Free chat'}</p>
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
    <World theme={theme} kind="chat" partner={rig} fuse={fuse}>
      {(w) => {
        const l = w.layout.kind === 'chat' ? w.layout : null;
        if (!l) return null;
        const portrait = l.orientation === 'portrait';
        const msgBox = w.box(l.messages);
        const inBox = w.box(l.input);
        return (
          <>
            <div class="seat-label" style={w.box(l.partner.label)}>
              <span>{partner?.name ?? '…'}</span>
            </div>
            <div class={'pillar-text' + (portrait ? ' row' : '')} style={w.box(l.pillarText ?? l.pillar)}>
              <div class="pillar-stat">
                <span class="k">{chat?.mode === 'paid' || search?.mode === 'paid' ? 'Playing' : 'Mode'}</span>
                <span class="v">{chat?.mode === 'paid' ? <><Icon name="coin" />{chat.coins}</> : search?.mode === 'paid' ? <><Icon name="coin" />{search.coins}</> : 'FREE'}</span>
              </div>
              <div class="pillar-stat">
                <span class="k">Level {level}</span>
                <span class="v" style={{ fontSize: '0.8em' }}>{THEME_NAMES[theme]}</span>
              </div>
              {!portrait && s.round && (
                <div class="pillar-stat">
                  <span class="k">Round ends</span>
                  <span class="v"><Icon name="clock" />{fmtClock(s.round.endsAt - now)}</span>
                </div>
              )}
              {!portrait && (
                <div class="pillar-stat">
                  <span class="k">Then you call</span>
                  <span class="v" style={{ fontSize: '0.75em' }}>Real human?</span>
                </div>
              )}
              {chat?.playTx && (
                <div class="pillar-stat">
                  <span class="k">On chain</span>
                  <a class="px-link px-label" href={txUrl(cfg, chat.playTx)} target="_blank" rel="noreferrer">play tx <Icon name="link" /></a>
                </div>
              )}
            </div>
            <div class={'timer-text' + (chatting && left < 15000 ? ' low' : '')} style={w.box(l.timer)} aria-live="off">
              {fmtClock(left)}
            </div>
            <div class="chat-messages" ref={list} style={{ ...msgBox, height: `calc(${msgBox.height} - var(--kb))` }} aria-live="polite">
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
              class="chat-input"
              style={{ ...inBox, transform: 'translateY(calc(var(--kb) * -1))' }}
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
          </>
        );
      }}
    </World>
  );
}
