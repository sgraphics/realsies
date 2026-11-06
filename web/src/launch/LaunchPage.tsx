// The launch page at / while REAL is not live (PublicConfig.launch): the logo, "Real or not?", the trailer,
// the countdown of the meme.cooking auction, Get REAL, the demo, the AI builders, X, how a round goes, why a
// bot is provable, terms and 18+. No wallet here. The phase follows the clock; the config is re-read every
// minute, and when coins open the page offers the game instead of leaving in the middle of the trailer.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameClient, LaunchConfig, PublicConfig } from '../../../shared/protocol.ts';
import { Logo } from '../ui/Logo.tsx';
import { Icon, type IconName } from '../ui/kit.tsx';
import { useNow } from '../ui/hooks.ts';
import { TermsScreen } from '../screens/Terms.tsx';
import { keepMock } from '../agents/route.ts';
import { BigClock, type ClockTone } from './BigClock.tsx';
import { Trailer, mayPreview } from './Trailer.tsx';
import { countdownTarget, fmtShort, fmtUtc, fmtWhen, launchOver, launchPhase, tokenUrlOf, type LaunchPhase } from './phase.ts';

const POLL_MS = 60_000;
/** After the auction the coin is set any minute: look twice as often. */
const POLL_FINAL_MS = 30_000;

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'coin', title: 'Play coins', text: 'Tap a character and put a few REAL coins on it, or play free.' },
  { icon: 'chat', title: 'Chat two minutes', text: 'Text only. Some characters are people, some are AI bots.' },
  { icon: 'mask', title: 'Call: human?', text: 'Right calls share the coins of the wrong ones when the round ends.' },
];

const TITLES: Record<LaunchPhase, string> = {
  soon: 'Realsies: real or not? REAL launches on meme.cooking',
  auction: 'Realsies: REAL is live on meme.cooking',
  finalizing: 'Realsies: the game opens in a few minutes',
  open: 'Realsies: the game is open',
};

/** Text whose numbers are set in the pixel font: at reading sizes Pixelify Sans draws a 5 like an S and a 2 like an 8. */
export function T(p: { text: string }) {
  const parts = p.text.split(/(\d+(?:[.,:]\d+)*)/);
  return <>{parts.map((s, i) => (i % 2 ? <span key={i} class="ln-n">{s}</span> : s))}</>;
}

/** Where "Play now" goes once coins are open: the game at / (the launch page is gone by then). */
export function playHref(): string {
  return keepMock('/');
}

export function LaunchPage(p: { client: GameClient; config: PublicConfig; pollMs?: number; previewTrailer?: boolean }) {
  const [cfg, setCfg] = useState(p.config);
  const [terms, setTerms] = useState(false);
  const now = useNow(1000);
  // the last launch settings stay on screen after the relay drops them (coins open)
  const last = useRef<LaunchConfig>(p.config.launch!);
  if (cfg.launch) last.current = cfg.launch;
  const l = last.current;
  const open = launchOver(cfg) || !cfg.launch;
  const phase = launchPhase(l, now, open);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [preview] = useState(() => p.previewTrailer ?? mayPreview());

  // re-read the config: every minute (half that after the auction), and when the tab comes back
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
      if (stopped || phaseRef.current === 'open') return;
      const base = p.pollMs ?? (phaseRef.current === 'finalizing' ? POLL_FINAL_MS : POLL_MS);
      timer = setTimeout(() => void read().then(schedule), base * (0.85 + Math.random() * 0.3));
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && phaseRef.current !== 'open' && Date.now() - lastAt > 15_000) void read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [p.client]);

  useEffect(() => {
    document.title = TITLES[phase];
  }, [phase]);

  // once the game is open, a bar at the bottom offers it whenever the card's own "Play now" is out of sight
  const [cardPlaySeen, setCardPlaySeen] = useState(true);
  useEffect(() => {
    if (phase !== 'open') return;
    const check = () => {
      const r = document.querySelector('.ln-play-now')?.getBoundingClientRect();
      setCardPlaySeen(!!r && r.bottom > 0 && r.top < window.innerHeight - 40);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [phase]);
  const bar = open && !cardPlaySeen;

  const token = tokenUrlOf(cfg) ?? tokenUrlOf(p.config);
  const testnet = cfg.testMode || cfg.network === 'testnet';
  return (
    <div class={'ln ph-' + phase + (bar ? ' has-bar' : '')}>
      <main class="ln-main">
        <section class="ln-hero" aria-labelledby="ln-h1">
          <div class="ln-wrap ln-hero-in">
            <header class="ln-head">
              <Brand />
              <h1 class="ln-h1" id="ln-h1">Real or <span class="ln-hl">not?</span></h1>
              <p class="ln-lead"><T text="An 8-bit chat game: two minutes with a stranger, then call it. Human or AI?" /></p>
            </header>
            {/* phones: the countdown and the main button first, then the trailer; wide screens: the trailer beside them */}
            <div class="ln-side">
              <Status l={l} phase={phase} now={now} />
              <MainAction l={l} phase={phase} now={now} token={token} />
            </div>
            <div class="ln-media">
              <Trailer src={l.trailer} poster={l.poster} preview={preview} />
            </div>
            <nav class="ln-more" aria-label="More">
              <a class="px-btn good ln-btn" href={l.demoUrl}>
                <Icon name="bolt" />
                <span class="ln-btn-l">Try the demo<small class="ln-btn-sub">testnet, no wallet</small></span>
              </a>
              <a class="px-btn ln-btn" href={keepMock('/agents')}><Icon name="bot" /> For AI builders</a>
              {l.xUrl && <a class="px-btn ln-btn" href={l.xUrl} target="_blank" rel="noopener"><span class="ln-x" aria-hidden="true">X</span> Follow on X</a>}
            </nav>
          </div>
        </section>

        <section class="ln-steps" aria-labelledby="ln-how">
          <div class="ln-wrap">
            <h2 class="ln-h2" id="ln-how">How a round goes</h2>
            <ol class="ln-step-list">
              {STEPS.map((s, i) => (
                <li key={s.title} class="px-panel ln-step">
                  <span class="ln-step-n" aria-hidden="true">{i + 1}</span>
                  <span class="ln-step-body">
                    <b class="ln-step-t"><Icon name={s.icon} /> {s.title}</b>
                    <span class="ln-step-p">{s.text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p class="ln-proof">
              <span class="ln-proof-icon" aria-hidden="true"><Icon name="shield" /></span>
              <span><b>Why it is provable:</b> NEAR AI enclaves sign every word a bot says, and the game contract on NEAR checks it.</span>
            </p>
          </div>
        </section>
      </main>

      <footer class="ln-foot">
        <div class="ln-wrap ln-foot-in">
          <p class="ln-foot-age"><span class="ln-18">18+</span> <span><T text="Realsies is a game for players 18 and older." /></span></p>
          <ul class="ln-foot-links">
            <li><button type="button" class="px-link" onClick={() => setTerms(true)}>Terms</button></li>
            <li><a class="px-link" href={keepMock('/agents')}>For AI builders</a></li>
            <li><a class="px-link" href={l.demoUrl}>Try the demo</a></li>
            {l.xUrl && <li><a class="px-link" href={l.xUrl} target="_blank" rel="noopener">Follow on X</a></li>}
          </ul>
        </div>
      </footer>

      {bar && (
        <div class="ln-bar" role="status">
          <div class="ln-wrap ln-bar-in">
            <span class="ln-bar-t"><Icon name="check" /> The game is open</span>
            <a class="px-btn primary ln-bar-btn" href={playHref()}>Play now</a>
          </div>
        </div>
      )}
      {terms && <TermsScreen testnet={testnet} onClose={() => setTerms(false)} />}
    </div>
  );
}

function Brand() {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const h = typeof window !== 'undefined' ? window.innerHeight : 720;
  // the logo is 27 sprite pixels tall: 2 CSS px each on phones and short screens, 3 on tall tablets and up, 4 and 5 on very big ones
  const height = w >= 2400 && h >= 1300 ? 135 : w >= 1800 && h >= 900 ? 108 : w >= 700 && h >= 820 ? 81 : h < 700 ? 41 : 54;
  return (
    <div class="ln-brand">
      <Logo height={height} title="Realsies" />
    </div>
  );
}

const TONE: Partial<Record<LaunchPhase, ClockTone>> = { soon: 'ice', auction: 'gold' };

function Status(p: { l: LaunchConfig; phase: LaunchPhase; now: number }) {
  const { l, phase, now } = p;
  const target = countdownTarget(l, phase);
  const hours = l.auctionStart !== undefined && l.auctionEnd !== undefined ? Math.round((l.auctionEnd - l.auctionStart) / 3_600_000) : null;
  // the visitor's own time, then UTC (the posts on X say UTC); phones put UTC on a line of its own
  const when = (t: number) => {
    const utc = fmtUtc(t);
    return (
      <>
        <T text={fmtWhen(t)} />
        {utc && <span class="ln-when-utc"><span class="ln-when-dot"> · </span><T text={utc} /></span>}
      </>
    );
  };
  if (phase === 'open') {
    return (
      <div class="px-panel ln-status" aria-live="polite">
        <p class="ln-kicker good"><Icon name="check" /> REAL is the game&rsquo;s coin</p>
        <p class="ln-status-big">The game is open</p>
        <a class="px-btn primary ln-cta ln-play-now" href={playHref()}>Play now</a>
      </div>
    );
  }
  if (phase === 'finalizing') {
    return (
      <div class="px-panel ln-status" aria-live="polite">
        <p class="ln-kicker"><Icon name="check" /> The auction is over</p>
        <p class="ln-status-big">The game opens in a few minutes</p>
        <span class="ln-dots" aria-hidden="true"><i /><i /><i /></span>
        <p class="ln-status-note">REAL is being set as the game&rsquo;s coin. This page updates by itself.</p>
      </div>
    );
  }
  return (
    <div class="px-panel ln-status">
      {phase === 'auction' ? (
        <p class="ln-kicker live"><span class="ln-live" aria-hidden="true" />REAL is live on meme.cooking</p>
      ) : (
        <p class="ln-kicker"><Icon name="coin" /> REAL launches on meme.cooking</p>
      )}
      {target !== undefined ? (
        <>
          <p class="ln-status-t">{phase === 'auction' ? 'Auction ends in' : 'Auction opens in'}</p>
          <BigClock ms={target - now} tone={TONE[phase] ?? 'gold'} label={phase === 'auction' ? 'The auction ends in' : 'The auction opens in'} maxCss={3} />
          <p class="ln-when">{when(target)}</p>
        </>
      ) : (
        <p class="ln-status-big">Auction date soon</p>
      )}
      {phase === 'soon' && hours !== null && <p class="ln-status-note"><T text={`${hours} hours. One price for everyone.`} /></p>}
      {phase === 'auction' && <p class="ln-status-note">A fair launch: one price for everyone.</p>}
    </div>
  );
}

/** Get REAL (the meme.cooking page), or before the auction "Auction opens Sun 16:00" (the same page, if there is one yet). */
function MainAction(p: { l: LaunchConfig; phase: LaunchPhase; now: number; token?: string }) {
  const { l, phase, now, token } = p;
  if (phase === 'soon') {
    const label = l.auctionStart !== undefined ? `Auction opens ${fmtShort(l.auctionStart, now)}` : 'Auction opens soon';
    return token ? (
      <a class="px-btn primary ln-cta" href={token} target="_blank" rel="noopener"><Icon name="clock" /> {label}</a>
    ) : (
      <span class="px-btn ln-cta is-static" aria-disabled="true"><Icon name="clock" /> {label}</span>
    );
  }
  if (!token) return null;
  return <a class={'px-btn ln-cta' + (phase === 'open' ? '' : ' primary')} href={token} target="_blank" rel="noopener"><Icon name="coin" /> Get REAL</a>;
}
