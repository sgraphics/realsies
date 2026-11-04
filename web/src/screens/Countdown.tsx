// The full-screen countdown before every chat (protocol v1.1): a fighting-game VS screen with the
// player's own character on the left door and the partner's skin and gamertag on the right, "Chat
// starts in 3", then big pixel numerals 3, 2, 1 and CHAT!, each beat with a scale-in bounce, a flash
// and a little screen shake in the theme's colours. It ends exactly when the chat opens (the store
// opens the input at the same instant); on CHAT! the doors fly apart over the room. Reduced motion:
// numerals cross-fade and the screen fades out, nothing moves.

import type { CSSProperties } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Skin, ThemeId } from '../../../shared/protocol.ts';
import { CD_VS, countdownSprite, countdownStyle, renderVsDoor } from '../../../art/src/ui/countdown.ts';
import { onReducedMotionChange, prefersReducedMotion, toDataURL } from '../../../art/src/browser/index.ts';
import { hex } from '../../../art/src/core/palette.ts';
import type { Reaction } from '../../../art/src/rig/rig.ts';
import { CharacterCanvas } from '../ui/CharacterCanvas.tsx';
import { GO_MS, GO_MS_CALM, beatAt, msToNextBeat } from '../state/countdown.ts';
import { type Box, countdownLayout, spriteBox } from './countdownLayout.ts';

export interface CountdownProps {
  theme: ThemeId;
  /** Client-clock ms when the chat opens (ChatView.countdownUntil). */
  until: number;
  me: { seed: string; label: string };
  partner: Skin;
  /** QA screenshots: hold this beat (3, 2, 1, or 0 for CHAT!) instead of following the clock. */
  hold?: number | null;
}

/** ?mock=1&qa=countdown&cd=3|2|1|go holds that beat (screenshots without a browser driver). */
export function countdownHold(search: string): number | null {
  const q = new URLSearchParams(search);
  if (q.get('mock') !== '1' || q.get('qa') !== 'countdown') return null;
  const v = q.get('cd');
  if (v === 'go' || v === 'chat' || v === '0') return 0;
  const n = Number(v);
  return n >= 1 && n <= 9 ? Math.floor(n) : null;
}

function useViewport(): { w: number; h: number; dpr: number } {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV((o) => {
      const n = read();
      return n.w === o.w && n.h === o.h && n.dpr === o.dpr ? o : n;
    });
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return v;
}

function useReducedMotion(): boolean {
  const [on, setOn] = useState(prefersReducedMotion);
  useEffect(() => onReducedMotionChange(setOn), []);
  return on;
}

const px = (b: Box): CSSProperties => ({ left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });

export function Countdown(p: CountdownProps) {
  const calm = useReducedMotion();
  const goMs = calm ? GO_MS_CALM : GO_MS;
  const hold = p.hold ?? null;
  const [now, setNow] = useState(Date.now);
  const beat = hold ?? beatAt(p.until, now, goMs);
  const vp = useViewport();
  const L = useMemo(() => countdownLayout(vp.w, vp.h, vp.dpr), [vp.w, vp.h, vp.dpr]);
  const stage = useRef<HTMLDivElement>(null);
  const [react, setReact] = useState<{ kind: Reaction; n: number } | null>(null);

  // re-render exactly at the next beat (just past the whole second, so ceil() lands on it)
  useEffect(() => {
    if (hold !== null || beat === null) return;
    const t = setTimeout(() => setNow(Date.now()), msToNextBeat(p.until, Date.now(), goMs) + 2);
    return () => clearTimeout(t);
  }, [now, p.until, hold, goMs, beat === null]);

  // every beat: a little screen shake in whole door pixels, the fighters nod (jump on CHAT!)
  useEffect(() => {
    if (hold !== null || beat === null) return;
    setReact((r) => ({ kind: beat === 0 ? 'jump' : 'nod', n: (r?.n ?? 0) + 1 }));
    const el = stage.current;
    if (calm || !el || typeof el.animate !== 'function') return;
    const a = Math.max(2, Math.round(L.u / L.dpr));
    const step = { easing: 'steps(1, end)' };
    const anim = el.animate(
      [
        { transform: 'translate(0, 0)', ...step },
        { transform: `translate(${a}px, ${-a}px)`, ...step },
        { transform: `translate(${-a}px, ${a}px)`, ...step },
        { transform: `translate(${a}px, ${a}px)`, ...step },
        { transform: `translate(${-a}px, 0)`, ...step },
        { transform: 'translate(0, 0)' },
      ],
      { duration: beat === 0 ? 300 : 220 },
    );
    return () => anim.cancel();
  }, [beat, calm, hold]);

  const st = countdownStyle(p.theme);
  const doors = useMemo(
    () => ({
      me: toDataURL(renderVsDoor(p.theme, 'me', L.door.w, L.door.h, L.door)),
      them: toDataURL(renderVsDoor(p.theme, 'them', L.door.w, L.door.h, L.door)),
    }),
    [p.theme, L],
  );
  if (beat === null) return null;

  const sprite = (what: 'go' | 'vs' | `${number}`) => {
    const s = countdownSprite(p.theme, what);
    return { url: toDataURL(s, `cd:${p.theme}:${what}`), w: s.w, h: s.h };
  };
  const big = beat === 0 ? sprite('go') : sprite(String(beat) as `${number}`);
  const bigBox = spriteBox(beat === 0 ? L.go : L.num, big.w, big.h, L.dpr);
  const vs = sprite('vs');
  const vsBox = spriteBox(L.vs, CD_VS.w, CD_VS.h, L.dpr);
  const doorCss = { width: (L.door.w * L.u) / L.dpr + 'px', height: (L.door.h * L.u) / L.dpr + 'px' };
  const vars = {
    '--cd-me': hex(st.me[1]),
    '--cd-them': hex(st.them[1]),
    '--cd-seam': hex(st.seam[1]),
    '--pf': L.plateFont + 'px',
    '--sf': L.subFont + 'px',
  } as CSSProperties;
  const cls = 'cd' + (beat === 0 ? ' go' : '') + (calm ? ' calm' : '') + (hold !== null ? ' hold' : '') + (L.portrait ? ' portrait' : ' landscape');
  const fighterSize = L.me.h + 0.01; // CharacterCanvas takes the largest whole scale that fits

  return (
    <div class={cls} style={vars} data-beat={beat}>
      <div class="cd-stage" ref={stage}>
        <div class="cd-door me">
          <img class="cd-door-img" src={doors.me} alt="" style={doorCss} />
          <div class="cd-fighter" style={px(L.me)}>
            <CharacterCanvas seed={p.me.seed} size={fighterSize} lookDir={1} reaction={react} title="You" />
          </div>
          <div class="cd-plate me" style={px(L.mePlate)}>
            <span class="cd-plate-tag">You</span>
            <span class="cd-plate-name">{p.me.label}</span>
          </div>
        </div>
        <div class="cd-door them">
          <img class="cd-door-img" src={doors.them} alt="" style={doorCss} />
          <div class="cd-fighter" style={px(L.them)}>
            <CharacterCanvas seed={p.partner.seed} size={fighterSize} lookDir={-1} reaction={react} title={p.partner.name} />
          </div>
          <div class="cd-plate them" style={px(L.themPlate)}>
            <span class="cd-plate-tag">Real human?</span>
            <span class="cd-plate-name">{p.partner.name}</span>
          </div>
        </div>
        <img class="cd-sprite cd-vs" src={vs.url} alt="" style={px(vsBox)} />
        <div class="cd-banner" style={{ top: `calc(${L.banner.y}px + env(safe-area-inset-top, 0px))`, height: L.banner.h + 'px', fontSize: L.banner.font + 'px' }} role="status" aria-live="assertive">
          {beat > 0 ? (
            <>
              Chat starts in <b>{beat}</b>
            </>
          ) : (
            <>Say hi!</>
          )}
        </div>
        <img key={'b' + beat} class={'cd-sprite cd-num' + (beat === 0 ? ' cd-go' : '')} src={big.url} alt={beat > 0 ? String(beat) : 'Chat!'} style={px(bigBox)} />
      </div>
      {!calm && hold === null && <div key={'f' + beat} class="cd-flash" style={{ background: hex(st.flash) }} />}
    </div>
  );
}
