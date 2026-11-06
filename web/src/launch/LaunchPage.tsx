// The coming-soon page at / until REAL's meme.cooking auction and the mainnet game open (PublicConfig.launch):
// the logo, one headline, the countdown as the hero, "Get REAL" (the meme.cooking page, which shows its own
// countdown before the auction), and the 18+ terms. No wallet, nothing else. At zero the countdown turns into the
// game's own CHAT! and the page hands over to the game in place (`onLive`), no reload. The config is re-read every
// minute (the start may move), and the page also steps aside if coins open first.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { GameClient, LaunchConfig, PublicConfig } from '../../../shared/protocol.ts';
import { renderVsDoor } from '../../../art/src/ui/countdown.ts';
import { prefersReducedMotion, toDataURL } from '../../../art/src/browser/index.ts';
import { Logo } from '../ui/Logo.tsx';
import { Icon } from '../ui/kit.tsx';
import { useNow } from '../ui/hooks.ts';
import { TermsScreen } from '../screens/Terms.tsx';
import { BigClock } from './BigClock.tsx';
import { comingSoon, fmtUtc, fmtWhen, tokenUrlOf } from './phase.ts';

const POLL_MS = 60_000;
/** CHAT! stays on screen this long before the game takes over (shorter without motion). */
export const GO_MS = 1700;
export const GO_MS_CALM = 700;
export const CAPTION = 'The game and REAL go live in';

/** Text whose numbers are set in the pixel font: at reading sizes Pixelify Sans draws a 5 like an S and a 2 like an 8. */
export function T(p: { text: string }) {
  const parts = p.text.split(/(\d+(?:[.,:]\d+)*)/);
  return <>{parts.map((s, i) => (i % 2 ? <span key={i} class="ln-n">{s}</span> : s))}</>;
}

function useViewport(): { w: number; h: number } {
  const read = () => ({ w: typeof window !== 'undefined' ? window.innerWidth : 1280, h: typeof window !== 'undefined' ? window.innerHeight : 720 });
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV((o) => {
      const n = read();
      return n.w === o.w && n.h === o.h ? o : n;
    });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

export function LaunchPage(p: { client: GameClient; config: PublicConfig; onLive(): void; pollMs?: number }) {
  const [cfg, setCfg] = useState(p.config);
  const [terms, setTerms] = useState(false);
  const now = useNow(250);
  const vp = useViewport();
  // the last launch settings stay on screen if the relay drops them (coins open: the game anyway)
  const last = useRef<LaunchConfig>(p.config.launch!);
  if (cfg.launch) last.current = cfg.launch;
  const start = last.current.auctionStart;
  const live = !comingSoon(cfg, now);
  const liveRef = useRef(live);
  liveRef.current = live;

  // zero: CHAT!, then the game in place
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => p.onLive(), prefersReducedMotion() ? GO_MS_CALM : GO_MS);
    return () => clearTimeout(t);
  }, [live]);

  // re-read the config every minute (the start may move, coins may open), and when the tab comes back
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastAt = Date.now();
    const read = async () => {
      lastAt = Date.now();
      try {
        const c = await p.client.getConfig();
        if (!stopped) setCfg(c);
      } catch {
        /* keep what we have; try again next time */
      }
    };
    const schedule = () => {
      if (stopped || liveRef.current) return;
      timer = setTimeout(() => void read().then(schedule), (p.pollMs ?? POLL_MS) * (0.85 + Math.random() * 0.3));
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !liveRef.current && Date.now() - lastAt > 15_000) void read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [p.client]);

  useEffect(() => {
    document.title = live ? 'Realsies: the game is open' : 'Realsies: real or not? Coming soon';
  }, [live]);

  const token = tokenUrlOf(cfg) ?? tokenUrlOf(p.config);
  const landscape = vp.w > vp.h && vp.h < 560;
  // the countdown gets the room the rest leaves: about a third of the height, more on tall phones
  const maxHeight = Math.round(vp.h * (landscape ? 0.3 : vp.w < 600 ? 0.36 : 0.3));
  const maxCss = vp.w >= 1800 && vp.h >= 900 ? 5 : vp.w >= 1000 ? 4 : 3;
  const utc = start !== undefined ? fmtUtc(start) : '';
  return (
    <div class={'ln' + (live ? ' is-live' : '')}>
      <Sky />
      <main class="ln-main">
        <Brand w={vp.w} h={vp.h} />
        <h1 class="ln-h1">Real or <span class="ln-hl">not?</span></h1>
        <p class="ln-cap">{live ? 'The game is open' : start !== undefined ? CAPTION : 'The game and REAL go live soon'}</p>
        {(live || start !== undefined) && (
          <div class="ln-stage">
            <BigClock ms={start !== undefined ? start - now : 0} tone="gold" label={CAPTION} maxCss={maxCss} maxHeight={maxHeight} go={live} />
          </div>
        )}
        {token ? (
          <a class="px-btn primary ln-cta" href={token} target="_blank" rel="noopener"><Icon name="coin" /> Get REAL</a>
        ) : start !== undefined ? (
          <p class="ln-when">
            <T text={fmtWhen(start)} />
            {utc && <span class="ln-when-utc"><span class="ln-when-dot"> · </span><T text={utc} /></span>}
          </p>
        ) : null}
      </main>
      <footer class="ln-foot">
        <span class="ln-18">18+</span>
        <span><T text="For players 18 and older." /></span>
        <button type="button" class="px-link" onClick={() => setTerms(true)}>Terms</button>
      </footer>
      {live && <div class="ln-flash" aria-hidden="true" />}
      {terms && <TermsScreen testnet={false} onClose={() => setTerms(false)} />}
    </div>
  );
}

function Brand(p: { w: number; h: number }) {
  // the logo is 27 sprite pixels tall: 1.5 CSS px each on short screens, 2 on phones, 3 on tablets and up, 4 and 5 on big ones
  const height = p.w >= 2400 && p.h >= 1300 ? 135 : p.w >= 1800 && p.h >= 900 ? 108 : p.w >= 700 && p.h >= 700 ? 81 : p.h < 600 ? 41 : 54;
  return (
    <div class="ln-brand">
      <Logo height={height} title="Realsies" />
    </div>
  );
}

/**
 * The backdrop: the sunburst of the game's VS screen (Star Station's rays and stars), one sprite pixel per 2 to 4
 * CSS px, its centre on the countdown. Drawn once per window size.
 */
function Sky() {
  const ref = useRef<HTMLDivElement>(null);
  const [bg, setBg] = useState<{ url: string; size: string } | null>(null);
  useLayoutEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const draw = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const s = vw >= 1800 ? 4 : vw >= 700 ? 3 : 2;
      const w = Math.ceil(vw / s), h = Math.ceil(vh / s);
      const stage = document.querySelector('.ln-stage')?.getBoundingClientRect();
      const cx = stage && stage.width ? (stage.left + stage.width / 2) / s : w / 2;
      const cy = stage && stage.height ? (stage.top + stage.height / 2) / s : h * 0.55;
      const img = renderVsDoor('space', 'me', w, h, { cx, cy, seamTop: w + 8, seamBottom: w + 8, rays: 14 });
      setBg({ url: toDataURL(img), size: `${w * s}px ${h * s}px` });
    };
    // after the fonts settle (the countdown's place depends on them), then on every resize
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    draw();
    fonts?.ready.then(() => requestAnimationFrame(draw), () => {});
    const on = () => {
      if (t) clearTimeout(t);
      t = setTimeout(draw, 120);
    };
    window.addEventListener('resize', on);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener('resize', on);
    };
  }, []);
  return <div ref={ref} class="ln-sky" aria-hidden="true" style={bg ? { backgroundImage: `url("${bg.url}")`, backgroundSize: bg.size } : undefined} />;
}
