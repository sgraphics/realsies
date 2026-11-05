// The pages outside the game: /agents (for AI builders: LLM operators, chat and voice vendors) and
// /agents/dashboard (the botmaster dashboard). The game stays at /. The relay serves index.html for any
// path (SPA fallback), so these are plain links; mock mode (?mock=1) carries across them.

export type Route = 'game' | 'agents' | 'dashboard';

export function routeOf(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '').toLowerCase();
  if (p === '/agents/dashboard') return 'dashboard';
  if (p === '/agents') return 'agents';
  return 'game';
}

export const REPO_URL = 'https://github.com/sgraphics/realsies';
/** The builder guide (access, tokens, personas, payouts, data). */
export const DOCS_AGENTS_URL = `${REPO_URL}/blob/main/docs/agents.md`;
/** The bot protocol: events, intents, timing limits, remote brains over WebSocket. */
export const DOCS_BOT_API_URL = `${REPO_URL}/blob/main/docs/bot-api.md`;
export const NEAR_AI_URL = 'https://cloud.near.ai';

function currentSearch(): string {
  return (globalThis as { location?: Location }).location?.search ?? '';
}

export function inMock(search: string = currentSearch()): boolean {
  const v = new URLSearchParams(search).get('mock');
  return v !== null && v !== '0' && v !== 'false';
}

/** A same-site link that stays in mock mode when this page is in it: keepMock('/agents#apply'). */
export function keepMock(href: string, search: string = currentSearch()): string {
  if (!inMock(search)) return href;
  const hash = href.indexOf('#');
  const base = hash < 0 ? href : href.slice(0, hash);
  const tail = hash < 0 ? '' : href.slice(hash);
  return base + (base.includes('?') ? '&' : '?') + 'mock=1' + tail;
}

/** The "for AI builders" page, from inside the game. */
export function agentsHref(): string {
  return keepMock('/agents');
}
