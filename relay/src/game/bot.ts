// One bot side of a chat: timing per spec section 4, NEAR AI completions with exact bytes kept,
// signatures fetched and verified before anything is shown, displayed text exactly the signed content.
import type { ChatMessage } from '../../../shared/protocol.js';
import type { Db } from '../db.js';
import type { NearAi, CompletionResult } from '../nearai/client.js';
import { bubblesOf, checkSignature, cleanContent, type SignatureCheck } from '../nearai/verify.js';
import { buildRequest, type ChatTurn } from '../models.js';
import type { Persona } from '../personas.js';
import type { ChatSide } from './types.js';
import { clamp, sleep, uniform } from '../util.js';
import { logger } from '../log.js';

const log = logger('bot');

/** A side message plus the index of the completion it came from (bot bubbles only). */
export type StoredMsg = ChatMessage & { ci?: number };

export interface BotHost {
  readonly ai: NearAi;
  readonly db: Db;
  readonly botTimeScale: number;
  /** The chat is still in its chatting phase. */
  isChatting(side: ChatSide): boolean;
  botSay(side: ChatSide, text: string, completionIndex: number): void;
  botTyping(side: ChatSide, on: boolean): void;
}

interface Done {
  check: SignatureCheck;
  clean: string;
}

export class BotSession {
  private stopped = false;
  private paid = false;
  private sealPromise: Promise<void> | null = null;
  private busy = false;
  private openerTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private typingOn = false;
  /** side.messages.length covered by the latest request that came back (or was given up on) */
  private covered = 0;
  private nextIdx = 0;
  private signedCount = 0;
  private cleanByIdx = new Map<number, string>();
  private pendingSigs = new Set<Promise<unknown>>();

  constructor(
    private host: BotHost,
    readonly side: ChatSide,
    private persona: Persona,
    private skinMessage: string,
    private attestedSigners: string[],
  ) {
    // resume indices if the chat already has completions (relay restart)
    const prior = host.db.loadCompletions(side.chatId);
    this.nextIdx = prior.length ? prior[prior.length - 1].idx + 1 : 0;
  }

  private scale(ms: number): number {
    return ms * this.host.botTimeScale;
  }

  start(): void {
    const delay = this.scale(uniform(4000, 12000));
    this.openerTimer = setTimeout(() => {
      this.openerTimer = null;
      if (!this.side.messages.some((m) => m.from === 'me')) void this.cycle('opener');
    }, delay);
  }

  onPlayerMessage(): void {
    if (this.stopped) return;
    if (this.openerTimer) {
      clearTimeout(this.openerTimer);
      this.openerTimer = null;
    }
    if (this.busy) return; // the running cycle schedules the follow-up when it finishes
    this.scheduleReply();
  }

  private scheduleReply(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.cycle('reply');
    }, this.scale(uniform(800, 2500)));
  }

  private uncoveredPlayerMessage(): boolean {
    return this.side.messages.slice(this.covered).some((m) => m.from === 'me');
  }

  /** message 0 = persona prompt, message 1 = skin + tag, then the transcript as shown (one assistant turn per completion). */
  buildMessages(): ChatTurn[] {
    const turns: ChatTurn[] = [
      { role: 'system', content: this.persona.prompt },
      { role: 'system', content: this.skinMessage },
    ];
    const seen = new Set<number>();
    for (const m of this.side.messages as StoredMsg[]) {
      if (m.from === 'me') turns.push({ role: 'user', content: m.text });
      else if (m.ci !== undefined && !seen.has(m.ci)) {
        seen.add(m.ci);
        turns.push({ role: 'assistant', content: this.cleanByIdx.get(m.ci) ?? m.text });
      }
    }
    return turns;
  }

  private async completeTwice(request: string): Promise<CompletionResult | null> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await this.host.ai.complete(this.persona.model, request);
      if (res.ok && res.completionId) return res;
      log.warn(`${this.side.chatId} ${this.persona.model} attempt ${attempt} failed: ${res.status} ${res.error?.slice(0, 160)}`);
      if (attempt === 1) await sleep(400);
    }
    return null;
  }

  /** Store the completion row now, fetch and verify its signature, store again. */
  private track(idx: number, request: string, res: CompletionResult): Promise<Done> {
    const base = {
      chatId: this.side.chatId,
      idx,
      completionId: res.completionId ?? null,
      model: this.persona.model,
      request,
      response: res.response,
      displayed: JSON.stringify([]),
      at: Date.now(),
      latencyMs: res.latencyMs,
      error: null,
    };
    this.host.db.saveCompletion({ ...base, signature: null, verify: null });
    const p = (async () => {
      const sig = await this.host.ai.signature(res.completionId!, 60_000);
      const check = checkSignature(this.persona.model, request, res.response, sig, this.attestedSigners);
      this.host.db.saveCompletion({ ...base, signature: sig ? JSON.stringify(sig) : null, verify: JSON.stringify(check), error: sig ? null : 'no signature within 60 s' });
      if (check.validSignature) this.signedCount++;
      if (!check.ok) log.warn(`${this.side.chatId} completion ${idx} check`, { ...check, requestHash: undefined, responseHash: undefined });
      return { check, clean: cleanContent(res.content) };
    })();
    this.pendingSigs.add(p);
    void p.finally(() => this.pendingSigs.delete(p));
    return p;
  }

  private setTyping(on: boolean): void {
    if (this.typingOn === on) return;
    this.typingOn = on;
    this.host.botTyping(this.side, on);
  }

  private typingMs(text: string): number {
    return this.scale(clamp(text.length * this.persona.typing.msPerChar, 1000, 7000) * uniform(0.85, 1.15));
  }

  private gapMs(text: string): number {
    return this.scale(clamp(text.length * this.persona.typing.msPerChar * 0.9, 600, 3500));
  }

  private async cycle(kind: 'opener' | 'reply'): Promise<void> {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      const coveredNow = this.side.messages.length;
      const request = buildRequest(this.persona.model, this.buildMessages());
      const res = await this.completeTwice(request);
      this.covered = coveredNow; // on failure the bot stays silent until the next player message
      if (!res) return;
      const idx = this.nextIdx++;
      const done = this.track(idx, request, res);
      const bubbles = bubblesOf(res.content);
      if (this.stopped || !this.host.isChatting(this.side) || bubbles.length === 0) {
        if (bubbles.length === 0) log.warn(`${this.side.chatId} empty reply (${kind}), finish=${res.finishReason}`);
        return;
      }
      this.setTyping(true);
      await sleep(this.typingMs(bubbles[0]));
      // never show text before its enclave signature verifies; keep typing while it arrives
      const result = await Promise.race([done, sleep(this.scale(20_000)).then(() => null)]);
      if (!result || !result.check.validSignature) {
        log.warn(`${this.side.chatId} completion ${idx} not shown: ${result ? 'signature did not verify' : 'signature late'}`);
        return;
      }
      this.cleanByIdx.set(idx, result.clean);
      const shown: string[] = [];
      for (let i = 0; i < bubbles.length; i++) {
        if (this.stopped || !this.host.isChatting(this.side)) break;
        if (i > 0) {
          this.setTyping(true);
          await sleep(this.gapMs(bubbles[i]));
          if (this.stopped || !this.host.isChatting(this.side)) break;
        }
        this.setTyping(false);
        this.host.botSay(this.side, bubbles[i], idx);
        shown.push(bubbles[i]);
      }
      this.host.db.sql.prepare('UPDATE completions SET displayed = ? WHERE chat_id = ? AND idx = ?').run(JSON.stringify(shown), this.side.chatId, idx);
    } catch (e) {
      log.error(`${this.side.chatId} cycle failed`, e);
    } finally {
      this.setTyping(false);
      this.busy = false;
      if (this.stopped) void this.maybeSeal();
      else if (this.uncoveredPlayerMessage()) this.scheduleReply();
    }
  }

  /**
   * Chat over. For a paid chat, make sure the last signed completion's request carries the whole
   * transcript up to the last player message (the on-chain proof): one more completion, not shown.
   */
  stop(paid: boolean): void {
    if (this.stopped) return;
    this.stopped = true;
    this.paid = paid;
    if (this.openerTimer) clearTimeout(this.openerTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.openerTimer = this.debounceTimer = null;
    this.setTyping(false);
    if (!this.busy) void this.maybeSeal();
  }

  private maybeSeal(): Promise<void> {
    if (!this.paid) return Promise.resolve();
    if (!this.sealPromise) this.sealPromise = this.seal();
    return this.sealPromise;
  }

  private async seal(): Promise<void> {
    if (this.signedCount > 0 && !this.uncoveredPlayerMessage()) return;
    if (this.signedCount === 0 && this.pendingSigs.size > 0) {
      await Promise.allSettled([...this.pendingSigs]);
      if (this.signedCount > 0 && !this.uncoveredPlayerMessage()) return;
    }
    try {
      const request = buildRequest(this.persona.model, this.buildMessages());
      const res = await this.completeTwice(request);
      if (!res) return;
      this.covered = this.side.messages.length;
      await this.track(this.nextIdx++, request, res);
      log.info(`${this.side.chatId} sealed the transcript with a final signed completion`);
    } catch (e) {
      log.error(`${this.side.chatId} seal failed`, e);
    }
  }

  /** Resolves when all signature fetches and the seal are done (settlement waits for it). */
  async settled(): Promise<void> {
    for (let i = 0; i < 900 && this.busy; i++) await sleep(100);
    if (this.stopped) await this.maybeSeal();
    for (let i = 0; i < 5 && this.pendingSigs.size > 0; i++) await Promise.allSettled([...this.pendingSigs]);
  }
}
