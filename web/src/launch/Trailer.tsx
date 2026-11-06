// The trailer: the poster first, one tap plays it with sound and the browser's controls. On wide screens that
// allow it (no reduced motion, no data saver) it previews muted and looped while in view, with "Tap for sound";
// the tap starts it over with sound. A poster or video that does not load leaves the logo and a link.

import { useEffect, useRef, useState } from 'preact/hooks';
import { Logo } from '../ui/Logo.tsx';

type State = 'poster' | 'preview' | 'playing' | 'failed';

/** May the trailer preview itself, muted? Wide screens only (phones keep their data), motion allowed, no data saver. */
export function mayPreview(): boolean {
  if (typeof window === 'undefined' || typeof matchMedia !== 'function') return false;
  if (document.documentElement.classList.contains('qa')) return false; // screenshots show the poster
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return !saveData && matchMedia('(min-width: 900px) and (prefers-reduced-motion: no-preference)').matches;
}

export function Trailer(p: { src: string; poster: string; preview?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<State>('poster');
  const stateRef = useRef<State>('poster');
  const [posterOk, setPosterOk] = useState<boolean | null>(null);
  const set = (s: State) => {
    stateRef.current = s;
    setState(s);
  };

  // the poster is the first thing people see: when it does not load, show the logo instead of a black box
  useEffect(() => {
    if (typeof Image === 'undefined') return;
    const img = new Image();
    img.onload = () => setPosterOk(true);
    img.onerror = () => setPosterOk(false);
    img.src = p.poster;
  }, [p.poster]);

  // the muted preview, only while at least half of it is on screen
  useEffect(() => {
    const v = video.current;
    if (!p.preview || !v || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (stateRef.current === 'playing' || stateRef.current === 'failed') return;
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          v.muted = true;
          v.loop = true;
          v.play().then(
            () => stateRef.current === 'poster' && set('preview'),
            () => {}, // the browser said no: the poster stays
          );
        } else if (!v.paused) v.pause();
      },
      { threshold: [0, 0.5] },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [p.preview, p.src]);

  const play = () => {
    const v = video.current;
    if (!v) return;
    const from = stateRef.current;
    set('playing');
    v.loop = false;
    v.muted = false;
    v.controls = true;
    if (from === 'preview') v.currentTime = 0;
    v.play().catch(() => {
      // a source that already failed (during the preview) says so; anything else: the controls are there
      if (v.error || v.networkState === 3 /* NETWORK_NO_SOURCE */) set('failed');
    });
  };

  const showLogo = posterOk === false && state !== 'playing' && state !== 'preview';
  const idle = state === 'poster' || state === 'preview';
  return (
    <figure class={'ln-trailer ' + state}>
      <div class="ln-screen">
        {showLogo && (
          <div class="ln-screen-fallback" aria-hidden="true">
            <Logo height={56} />
          </div>
        )}
        <video
          ref={video}
          class="ln-video"
          poster={posterOk === false ? undefined : p.poster}
          preload={p.preview ? 'metadata' : 'none'}
          playsInline
          muted={state !== 'playing'}
          controls={state === 'playing'}
          onEnded={() => {
            if (stateRef.current === 'playing') video.current?.load();
            set('poster');
          }}
          onError={() => stateRef.current === 'playing' && set('failed')}
          aria-label="Realsies trailer"
        >
          <source src={p.src} type="video/mp4" onError={() => stateRef.current === 'playing' && set('failed')} />
        </video>
        {/* the whole picture plays it too; the strip under it says so (a button over the poster would hide it) */}
        {idle && <button type="button" class="ln-play" onClick={play} tabIndex={-1} aria-hidden="true" />}
      </div>
      {idle && (
        <button type="button" class="ln-strip" onClick={play}>
          <svg class="ln-play-tri" viewBox="0 0 8 9" shape-rendering="crispEdges" aria-hidden="true">
            <path d="M0 0h1v1h2v1h2v1h2v1h1v1h-1v1h-2v1h-2v1h-2v1h-1z" />
          </svg>
          {state === 'preview' ? 'Tap for sound' : 'Watch the trailer'}
          <span class="ln-strip-sub">{state === 'preview' ? 'from the start' : 'sound on'}</span>
        </button>
      )}
      {state === 'failed' && (
        <p class="ln-strip ln-strip-msg" role="status">
          <span>The trailer did not load here.</span>
          <a class="px-link" href={p.src} target="_blank" rel="noopener">Open the video</a>
        </p>
      )}
    </figure>
  );
}
