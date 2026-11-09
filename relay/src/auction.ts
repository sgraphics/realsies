// The REAL auction on meme.cooking at a glance, for the deposit dialog on realsies.lol (protocol v1.10): a 15 s
// cache of https://api.meme.cooking/meme/<id>, whose answers carry no CORS header for our pages. The meme id comes
// from the launch's token page (LAUNCH_TOKEN_URL, https://meme.cooking/meme/<id>). Public, read-only, no session.

import type { AuctionInfo } from '../../shared/protocol.js';
import { GameError } from './game/game.js';

const TTL_MS = 15_000;

/** The meme id in a meme.cooking page URL; null when there is none. */
export function memeIdOf(url: string | undefined): number | null {
  const m = url?.match(/meme\.cooking\/meme\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export class AuctionView {
  private cache: { id: number; at: number; info: AuctionInfo } | null = null;
  private pending: Promise<AuctionInfo> | null = null;

  constructor(
    private memeId: () => number | null,
    private fetchImpl: typeof fetch = fetch,
    private base = 'https://api.meme.cooking',
  ) {}

  async get(now = Date.now()): Promise<AuctionInfo> {
    const id = this.memeId();
    if (!id) throw new GameError('auction_off', 'there is no auction to show', 404);
    const c = this.cache;
    if (c && c.id === id && now - c.at < TTL_MS) return c.info;
    this.pending ??= this.load(id).finally(() => {
      this.pending = null;
    });
    try {
      const info = await this.pending;
      this.cache = { id, at: Date.now(), info };
      return info;
    } catch {
      // meme.cooking did not answer: the last view, however old, beats nothing
      if (c && c.id === id) return c.info;
      throw new GameError('auction_unavailable', 'meme.cooking is not answering right now', 502);
    }
  }

  private async load(id: number): Promise<AuctionInfo> {
    const r = await this.fetchImpl(`${this.base}/meme/${id}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`meme.cooking answered ${r.status}`);
    const m = ((await r.json()) as { meme?: Record<string, unknown> }).meme;
    if (!m || Number(m.meme_id) !== id) throw new Error('meme.cooking sent no such meme');
    return {
      memeId: id,
      totalDeposit: String(m.total_deposit ?? '0'),
      softCap: String(m.soft_cap ?? '0'),
      ...(m.hard_cap ? { hardCap: String(m.hard_cap) } : {}),
      startMs: Number(m.start_timestamp_ms ?? 0),
      endMs: Number(m.end_timestamp_ms ?? 0),
      finalized: m.is_finalized === true,
    };
  }
}
