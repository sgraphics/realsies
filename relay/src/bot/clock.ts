// Time source for bot sessions: the real clock in the relay, a virtual one in simulations, so a
// thousand two-minute chats run in seconds with the same executor code.
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const t = setTimeout(fn, Math.max(0, ms));
    t.unref?.();
    return t;
  },
  clearTimeout(h) {
    clearTimeout(h as NodeJS.Timeout);
  },
};

export function sleepOn(clock: Clock, ms: number): Promise<void> {
  return new Promise((r) => clock.setTimeout(r, ms));
}

/**
 * Virtual time. Timers fire in order when the owner advances the clock; between timers the
 * microtask queue is drained, so async code awaiting virtual sleeps runs as it would in real time.
 */
export class VirtualClock implements Clock {
  private t: number;
  private seq = 0;
  private timers = new Map<number, { at: number; seq: number; fn: () => void }>();

  constructor(start = 1_800_000_000_000) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), seq: id, fn });
    return id;
  }

  clearTimeout(h: unknown): void {
    this.timers.delete(h as number);
  }

  get pending(): number {
    return this.timers.size;
  }

  private nextTimer(): [number, { at: number; seq: number; fn: () => void }] | undefined {
    let best: [number, { at: number; seq: number; fn: () => void }] | undefined;
    for (const e of this.timers) if (!best || e[1].at < best[1].at || (e[1].at === best[1].at && e[1].seq < best[1].seq)) best = e;
    return best;
  }

  /** Let pending promise callbacks run (they may schedule more virtual timers). */
  static async drain(): Promise<void> {
    for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
  }

  /** Run every timer due up to `until`, in order, draining microtasks in between. */
  async runUntil(until: number): Promise<void> {
    await VirtualClock.drain();
    for (;;) {
      const n = this.nextTimer();
      if (!n || n[1].at > until) break;
      this.timers.delete(n[0]);
      this.t = Math.max(this.t, n[1].at);
      n[1].fn();
      await VirtualClock.drain();
    }
    this.t = Math.max(this.t, until);
  }

  async advance(ms: number): Promise<void> {
    await this.runUntil(this.t + ms);
  }
}
