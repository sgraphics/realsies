// /agents/dashboard: the botmaster dashboard. Paste the botmaster token (kept in sessionStorage, this tab
// only), then: profile, totals, a scorecard by persona and by round with called-human bars, every settled
// chat with its transcript, the JSONL export, persona requests and the bring-your-own NEAR AI key.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { BotmasterChat, BotmasterProfile, BotmasterScore, BotmasterStats, PublicConfig } from '../../../shared/protocol.ts';
import { type BuilderClient, friendlyError, isAuthError, profileExtras } from '../net/builders.ts';
import { MOCK_TOKEN } from '../net/mock/builders.ts';
import { accountUrl, fmtCoins, fmtPct } from '../state/format.ts';
import { Button, Icon } from '../ui/kit.tsx';
import { BuilderTerms, Field, Footer, N, SecretInput, ShareBar, ShareOf, T, TopBar, fmtAgo, fmtShareOf, fmtWhen } from './parts.tsx';
import { KeyPanel, Personas, brainLabel, personaState } from './Setup.tsx';
import { modelLabel, validateToken } from './validate.ts';
import { DOCS_AGENTS_URL, keepMock } from './route.ts';
import { dashboardQaStep, scrollToId } from './qa.ts';

const tokenKey = (mock: boolean) => (mock ? 'realsies:mock:botmaster:token' : 'realsies:botmaster:token');

function session(): Storage | null {
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}
export function loadToken(mock: boolean): string | null {
  try {
    return session()?.getItem(tokenKey(mock)) || null;
  } catch {
    return null;
  }
}
export function saveToken(mock: boolean, token: string | null): void {
  try {
    if (token) session()?.setItem(tokenKey(mock), token);
    else session()?.removeItem(tokenKey(mock));
  } catch {
    /* private mode: the token lives in memory only */
  }
}

const calls = (s: BotmasterScore) => s.calledHuman + s.calledBot;

export function Dashboard(p: { client: BuilderClient }) {
  const [qa] = useState(() => dashboardQaStep(typeof location !== 'undefined' ? location.search : ''));
  const [token, setToken] = useState<string | null>(() => (qa === 'token' ? null : qa ? MOCK_TOKEN : loadToken(p.client.mock)));
  const [checking, setChecking] = useState(!!token);
  const [gateErr, setGateErr] = useState('');
  const [profile, setProfile] = useState<BotmasterProfile | null>(null);
  const [stats, setStats] = useState<BotmasterStats | null>(null);
  const [statsErr, setStatsErr] = useState('');
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [terms, setTerms] = useState(false);

  useEffect(() => {
    p.client.getConfig().then(setCfg).catch(() => {});
  }, [p.client]);

  const loadStats = async (t: string) => {
    setStatsErr('');
    try {
      setStats(await p.client.stats(t));
    } catch (e) {
      setStatsErr(friendlyError(e));
    }
  };

  const open = async (t: string) => {
    setChecking(true);
    setGateErr('');
    try {
      const me = await p.client.me(t);
      saveToken(p.client.mock, t);
      setToken(t);
      setProfile(me);
      void loadStats(t);
    } catch (e) {
      if (isAuthError(e)) saveToken(p.client.mock, null);
      setToken(null);
      setProfile(null);
      setGateErr(friendlyError(e, 'token'));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (token) void open(token);
  }, []);

  const refreshProfile = async () => {
    if (!token) return;
    try {
      setProfile(await p.client.me(token));
    } catch (e) {
      if (isAuthError(e)) signOut(friendlyError(e, 'token'));
    }
  };

  const signOut = (why = '') => {
    saveToken(p.client.mock, null);
    setToken(null);
    setProfile(null);
    setStats(null);
    setGateErr(why);
  };

  const testnet = !!(cfg?.testMode || cfg?.network === 'testnet');
  const signedIn = !!(token && profile);
  return (
    <div class="ag ag-dashboard">
      <TopBar label="Botmaster dashboard" testnet={testnet}>
        <a class="ag-nav-link hide-s" href={keepMock('/agents')}>For AI builders</a>
        <a class="ag-nav-link hide-s" href={DOCS_AGENTS_URL} target="_blank" rel="noreferrer">Guide</a>
        {signedIn ? (
          <Button small onClick={() => signOut()}>Sign out</Button>
        ) : (
          <a class="px-btn small primary ag-nav-cta" href={keepMock('/agents#apply')}>Request access</a>
        )}
      </TopBar>
      <main class="ag-wrap ag-dash">
        {!signedIn ? (
          <TokenGate busy={checking} error={gateErr} mock={p.client.mock} onSubmit={(t) => void open(t)} />
        ) : (
          <Signed client={p.client} token={token!} profile={profile!} stats={stats} statsErr={statsErr} cfg={cfg} qa={qa} onRetry={() => void loadStats(token!)} onProfile={refreshProfile} onSignOut={() => signOut()} />
        )}
      </main>
      <Footer onTerms={() => setTerms(true)} />
      {terms && <BuilderTerms onClose={() => setTerms(false)} />}
    </div>
  );
}

function TokenGate(p: { busy: boolean; error: string; mock: boolean; onSubmit(t: string): void }) {
  const [v, setV] = useState('');
  const [tried, setTried] = useState(false);
  const err = (tried ? validateToken(v) : null) ?? (p.error || undefined);
  const submit = (t: string) => {
    setTried(true);
    if (validateToken(t)) return;
    p.onSubmit(t.trim());
  };
  return (
    <section class="ag-gate">
      <div class="px-panel ag-card ag-gate-card">
        <p class="ag-kicker blue"><Icon name="lock" /> Botmaster dashboard</p>
        <h1 class="ag-h2">Paste your botmaster token</h1>
        <p class="ag-p">
          It came with your access email. It opens your scorecard, every settled transcript and your setup, and stays in this browser tab only: closing the tab forgets it.
        </p>
        <form class="ag-form" noValidate onSubmit={(e) => { e.preventDefault(); if (!p.busy) submit(v); }}>
          <Field id="ag-token" label="Botmaster token" error={err}>
            <SecretInput id="ag-token" value={v} onValue={setV} placeholder="paste it here" error={err} hint={false} />
          </Field>
          <div class="ag-submit">
            <Button type="submit" kind="primary" disabled={p.busy}><Icon name="star" /> {p.busy ? 'Opening…' : 'Open dashboard'}</Button>
          </div>
        </form>
        {p.mock && (
          <p class="ag-note">
            Mock mode: any token works.{' '}
            <button type="button" class="px-link" onClick={() => { setV(MOCK_TOKEN); submit(MOCK_TOKEN); }}>Use the demo token</button>
          </p>
        )}
        <p class="ag-p ag-small px-dim">
          No token yet? <a class="px-link" href={keepMock('/agents#apply')}>Request access</a>.
        </p>
      </div>
    </section>
  );
}

function Signed(p: {
  client: BuilderClient;
  token: string;
  profile: BotmasterProfile;
  stats: BotmasterStats | null;
  statsErr: string;
  cfg: PublicConfig | null;
  qa: ReturnType<typeof dashboardQaStep>;
  onRetry(): void;
  onProfile(): Promise<void>;
  onSignOut(): void;
}) {
  const { profile: me, stats, cfg } = p;
  const [exporting, setExporting] = useState<'idle' | 'busy' | 'done'>('idle');
  const [exportErr, setExportErr] = useState('');
  useEffect(() => {
    if (p.qa === 'setup' && stats) scrollToId('setup');
  }, [p.qa, !!stats]);

  const doExport = async () => {
    setExporting('busy');
    setExportErr('');
    try {
      const blob = await p.client.exportJsonl(p.token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = me.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'botmaster';
      a.href = url;
      a.download = `realsies-${slug}-${new Date().toISOString().slice(0, 10)}.jsonl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setExporting('done');
      setTimeout(() => setExporting('idle'), 2500);
    } catch (e) {
      setExportErr(friendlyError(e));
      setExporting('idle');
      if (isAuthError(e)) p.onSignOut();
    }
  };

  const payoutHref = accountUrl(cfg ?? undefined, me.payoutAccount);
  const { online } = profileExtras(me);
  return (
    <>
      <header class="ag-dash-head">
        <div class="ag-dash-id">
          <p class="ag-kicker blue"><Icon name="bot" /> Botmaster</p>
          <h1 class="ag-h1 ag-dash-name">{me.name}</h1>
          <p class="ag-dash-meta">
            <span>Payout <a class="px-link px-mono" href={payoutHref} target="_blank" rel="noreferrer">{me.payoutAccount || 'not set'}</a></span>
            <span>Since <N>{fmtWhen(me.createdAt)}</N></span>
            <span><N>{me.personas.length}</N> persona{me.personas.length === 1 ? '' : 's'}</span>
            <span>{me.byok ? 'Your NEAR AI key' : 'Game NEAR AI credits'}</span>
            {online !== undefined && me.personas.some((x) => x.brain === 'remote') && (
              <span class={'ag-online ' + (online ? 'on' : 'off')} title={online ? 'Your brain is connected over /bot/ws' : 'Our brain plays your remote personas until yours connects'}>
                {online ? 'Your brain is connected' : 'Your brain is offline; ours stands in'}
              </span>
            )}
          </p>
        </div>
        <div class="ag-dash-actions">
          <Button kind="primary" disabled={exporting === 'busy'} onClick={() => void doExport()} title="Every settled chat, one JSON object per line">
            <Icon name={exporting === 'done' ? 'check' : 'chat'} /> {exporting === 'busy' ? 'Exporting…' : exporting === 'done' ? 'Downloaded' : 'Export JSONL'}
          </Button>
        </div>
      </header>
      {exportErr && <p class="px-error ag-form-err" role="alert">{exportErr}</p>}

      {p.statsErr && (
        <div class="px-error ag-form-err ag-retry" role="alert">
          <span>{p.statsErr}</span> <Button small onClick={p.onRetry}>Try again</Button>
        </div>
      )}
      {!stats && !p.statsErr && <p class="ag-loading px-dim">Loading your scorecard…</p>}
      {stats && <Totals s={stats.totals} cfg={cfg} payout={me.payoutAccount} />}
      {stats && (
        <p class="ag-legend" aria-hidden="true">
          <span><i class="ag-sw calls" /> share of calls that said human</span>
          <span><i class="ag-sw coins" /> the same, weighted by coins (paid calls only)</span>
        </p>
      )}
      {stats && <PersonaScores stats={stats} profile={me} />}
      {stats && <RoundScores stats={stats} />}
      <Chats client={p.client} token={p.token} stats={stats} qa={p.qa} onAuth={p.onSignOut} />
      <div class="ag-setup" id="setup">
        <Personas profile={me} stats={stats} client={p.client} token={p.token} cfg={cfg} openForm={p.qa === 'setup'} onChanged={() => void p.onProfile()} />
        <KeyPanel profile={me} client={p.client} token={p.token} onChanged={p.onProfile} />
      </div>
    </>
  );
}

function Totals(p: { s: BotmasterScore; cfg: PublicConfig | null; payout: string }) {
  const { s, cfg } = p;
  const usd = cfg?.usdPerCoin ? <>, about <N>${(s.turingBonusCoins * cfg.usdPerCoin).toFixed(2)}</N></> : null;
  return (
    <section class="ag-kpis" aria-label="Totals over every settled round">
      <div class="ag-kpi hero">
        <span class="ag-kpi-k">Called human</span>
        <span class="ag-kpi-v">{fmtPct(s.fooledShare)}</span>
        <ShareBar value={s.fooledShare} title={fmtShareOf(s.calledHuman, calls(s), 'calls said human')} />
        <span class="ag-kpi-s"><ShareOf n={s.calledHuman} of={calls(s)} what="calls" /> said your agent is human</span>
      </div>
      <div class="ag-kpi">
        <span class="ag-kpi-k">By coins</span>
        <span class="ag-kpi-v">{fmtPct(s.coinFooledShare)}</span>
        <ShareBar tone="coins" value={s.coinFooledShare} title="Coin-weighted share of paid calls that said human" />
        <span class="ag-kpi-s">paid calls, weighted by the coins played</span>
      </div>
      <div class="ag-kpi wide">
        <span class="ag-kpi-k">Turing bonus</span>
        <span class="ag-kpi-v" title={`${fmtCoins(s.turingBonusCoins)} coins`}><Icon name="coin" /> {fmtCoins(s.turingBonusCoins >= 1000 ? Math.round(s.turingBonusCoins) : s.turingBonusCoins)}</span>
        <span class="ag-kpi-s">coins{usd}, paid on chain to {p.payout || 'your payout account'}</span>
      </div>
      <div class="ag-kpi">
        <span class="ag-kpi-k">Chats</span>
        <span class="ag-kpi-v">{s.chats.toLocaleString('en-US')}</span>
        <span class="ag-kpi-s"><N>{s.paidChats}</N> paid · <N>{s.missed}</N> without a call</span>
      </div>
    </section>
  );
}

function ScoreCells(p: { s: BotmasterScore }) {
  const { s } = p;
  return (
    <>
      <td class="num" data-label="Chats">
        <span class="ag-cell">
          <span class="ag-num">{s.chats}</span>
          <span class="ag-cell-sub"><N>{s.paidChats}</N> paid</span>
        </span>
      </td>
      <td class="ag-barcell" data-label="Called human">
        <span class="ag-cell">
          <ShareBar value={s.fooledShare} title={fmtShareOf(s.calledHuman, calls(s), 'calls said human')} />
          <span class="ag-cell-sub"><ShareOf n={s.calledHuman} of={calls(s)} what="calls" /></span>
        </span>
      </td>
      <td class="ag-barcell" data-label="By coins">
        <span class="ag-cell">
          <ShareBar tone="coins" value={s.coinFooledShare} title="Coin-weighted share of paid calls that said human" />
        </span>
      </td>
      <td class="num" data-label="Turing bonus">
        <span class="ag-cell">
          <span class="ag-coins"><Icon name="coin" /> {fmtCoins(s.turingBonusCoins)}</span>
        </span>
      </td>
    </>
  );
}

function PersonaScores(p: { stats: BotmasterStats; profile: BotmasterProfile }) {
  const known = new Map(p.profile.personas.map((x) => [x.id, x]));
  const ids = [...new Set([...Object.keys(p.stats.byPersona), ...p.profile.personas.map((x) => x.id)])];
  const rows = ids.map((id) => ({ id, s: p.stats.byPersona[id], info: known.get(id) })).sort((a, b) => (b.s?.chats ?? -1) - (a.s?.chats ?? -1));
  return (
    <section class="ag-dsec" aria-labelledby="ag-bypersona-h">
      <h2 class="ag-h2" id="ag-bypersona-h">Scorecard by persona</h2>
      <table class="ag-table">
        <thead>
          <tr>
            <th scope="col">Persona</th>
            <th scope="col" class="num">Chats</th>
            <th scope="col">Called human</th>
            <th scope="col">By coins</th>
            <th scope="col" class="num">Turing bonus</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, s, info }) => {
            const st = info ? personaState(info, p.stats) : null;
            return (
              <tr key={id}>
                <th scope="row" class="ag-rowh">
                  <b class="ag-break">{id}</b>
                  <span class="ag-row-meta">
                    {info && <span class="px-dim"><T text={modelLabel(info.model)} /></span>}
                    {info?.levels.map((l) => <span key={l} class="ag-lv">L{l}</span>)}
                    {info && <span class="ag-brain">{brainLabel(info.brain)}</span>}
                    {st && !info?.active && <span class={'ag-state ' + st.cls}>{st.label}</span>}
                  </span>
                </th>
                {s ? (
                  <ScoreCells s={s} />
                ) : (
                  <td colSpan={4} class="ag-empty-cell px-dim" data-label="Scorecard">No settled chats yet{info && !info.active ? ': it plays from the round after approval.' : '.'}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function RoundScores(p: { stats: BotmasterStats }) {
  const [all, setAll] = useState(false);
  const rounds = p.stats.rounds;
  const shown = all ? rounds : rounds.slice(0, 6);
  if (!rounds.length) return null;
  return (
    <section class="ag-dsec" aria-labelledby="ag-byround-h">
      <h2 class="ag-h2" id="ag-byround-h">By round <span class="ag-h2-sub">newest first</span></h2>
      <table class="ag-table">
        <thead>
          <tr>
            <th scope="col">Round</th>
            <th scope="col" class="num">Chats</th>
            <th scope="col">Called human</th>
            <th scope="col">By coins</th>
            <th scope="col" class="num">Turing bonus</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.roundId}>
              <th scope="row" class="ag-rowh">
                <b>Round {r.roundId}</b>
                <span class="ag-row-meta px-dim">{r.settledAt ? <>settled <N>{fmtWhen(r.settledAt)}</N></> : 'settling'}</span>
              </th>
              <ScoreCells s={r} />
            </tr>
          ))}
        </tbody>
      </table>
      {rounds.length > 6 && (
        <Button small onClick={() => setAll(!all)}>{all ? 'Show the newest 6' : `Show all ${rounds.length} rounds`}</Button>
      )}
    </section>
  );
}

const PAGE = 12;

function Chats(p: { client: BuilderClient; token: string; stats: BotmasterStats | null; qa: ReturnType<typeof dashboardQaStep>; onAuth(): void }) {
  const [round, setRound] = useState<number | undefined>(undefined);
  const [limit, setLimit] = useState(PAGE);
  const [list, setList] = useState<BotmasterChat[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  const scrolled = useRef(false);
  useEffect(() => {
    const n = ++seq.current;
    setBusy(true);
    setErr('');
    p.client
      .chats(p.token, { round, limit })
      .then((l) => {
        if (n === seq.current) setList(l);
      })
      .catch((e) => {
        if (n !== seq.current) return;
        setErr(friendlyError(e));
        if (isAuthError(e)) p.onAuth();
      })
      .finally(() => n === seq.current && setBusy(false));
  }, [round, limit, p.token]);
  useEffect(() => {
    if (p.qa === 'chats' && list && !scrolled.current) {
      scrolled.current = true;
      scrollToId('chats');
    }
  }, [list]);
  const rounds = p.stats?.rounds ?? [];
  const more = !!list && list.length >= limit;
  return (
    <section class="ag-dsec" id="chats" aria-labelledby="ag-chats-h">
      <div class="ag-sec-head">
        <h2 class="ag-h2" id="ag-chats-h">Chats <span class="ag-h2-sub">every settled transcript</span></h2>
        <label class="ag-filter">
          <span class="ag-label">Round</span>
          <select
            class="px-input ag-select"
            value={round === undefined ? '' : String(round)}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              setRound(v ? Number(v) : undefined);
              setLimit(PAGE);
            }}
          >
            <option value="">All rounds</option>
            {rounds.map((r) => <option key={r.roundId} value={String(r.roundId)}>Round {r.roundId} ({r.chats} chats)</option>)}
          </select>
        </label>
      </div>
      {err && <p class="px-error ag-form-err" role="alert">{err}</p>}
      {!list && !err && <p class="ag-loading px-dim">Loading chats…</p>}
      {list && list.length === 0 && <p class="ag-p px-dim">No settled chats {round ? `in round ${round}` : 'yet'}. Transcripts appear here when a round settles.</p>}
      {list && list.length > 0 && (
        <ul class={'ag-chats' + (busy ? ' busy' : '')}>
          {list.map((c, i) => <ChatItem key={c.chatId} c={c} open={p.qa === 'chats' && i === 0} />)}
        </ul>
      )}
      {more && (
        <Button small disabled={busy} onClick={() => setLimit(limit + PAGE)}>{busy ? 'Loading…' : 'Show more chats'}</Button>
      )}
    </section>
  );
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ChatItem(p: { c: BotmasterChat; open?: boolean }) {
  const { c } = p;
  const outcome = c.playerCall === true ? 'fooled' : c.playerCall === false ? 'caught' : 'missed';
  const paid = c.playerMode === 'paid' && c.coins > 0;
  return (
    <li class={'ag-chat ' + outcome}>
      <details open={p.open}>
        <summary class="ag-chat-sum">
          <span class="ag-chat-who">
            <b class="ag-break">{c.personaId}</b> <span class="px-dim">vs</span> <span class="px-mono ag-player">{c.player}</span>
          </span>
          <span class="ag-chat-tags">
            <span class="ag-lv">R{c.roundId}</span>
            <span class="ag-lv">L{c.level}</span>
            <span class={'ag-mode ' + (paid ? 'paid' : 'free')}>{paid ? <><Icon name="coin" /> {c.coins}</> : 'free'}</span>
            <span class={'ag-call ' + outcome}>
              <Icon name={outcome === 'fooled' ? 'check' : outcome === 'caught' ? 'cross' : 'clock'} /> {outcome === 'fooled' ? 'Called human' : outcome === 'caught' ? 'Called bot' : 'No call'}
            </span>
            {c.turingBonusCoins > 0 && <span class="ag-bonus" title="Turing bonus from this chat">+{fmtCoins(c.turingBonusCoins)}</span>}
          </span>
          <span class="ag-chat-when px-dim" title={fmtWhen(c.startedAt)}><N>{fmtAgo(c.startedAt)}</N></span>
        </summary>
        <div class="ag-transcript">
          <p class="ag-tr-head"><span>Player <span class="ag-tag-case">{c.player}</span></span><span>Your agent, {modelLabel(c.model)}</span></p>
          {c.transcript.length === 0 && <p class="px-dim ag-p">Nobody said anything.</p>}
          {c.transcript.map((l, i) => (
            <div key={i} class={'ag-line ' + (l.from === 'bot' ? 'bot' : 'player')}>
              <div class={'bubble ' + (l.from === 'bot' ? 'me' : 'them')}>{l.text}</div>
              <span class="ag-t">{clock(l.at - c.startedAt)}</span>
            </div>
          ))}
          <p class="ag-tr-foot px-dim px-mono">chat {c.chatId} · {c.model} · {fmtWhen(c.startedAt)}</p>
        </div>
      </details>
    </li>
  );
}
