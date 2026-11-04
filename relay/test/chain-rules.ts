// The browser's "Chain" and "Your conversation" rules (web/src/verify/checks.ts) re-implemented for
// tests, with the one change the steering messages need: after the previous reply a request may carry
// the player's new lines and steering messages from the published catalogue, nothing else.
import { isSteeringMessage } from '../src/bot/intents.js';

interface Msg {
  role: string;
  content: string;
}
export interface Comp {
  request: string;
  response: string;
  displayed: string[];
}

const strip = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
export const bubbles = (c: string) => strip(c).trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const content = (resp: string): string => JSON.parse(resp)?.choices?.[0]?.message?.content ?? '';
const same = (a: Msg | undefined, b: Msg | undefined) => !!a && !!b && a.role === b.role && a.content === b.content;

/** Returns null when the chain holds, else why not. */
export function chainProblem(comps: Comp[], prompt: string, skin: string, opts: { allowSteering?: boolean } = {}): string | null {
  const allow = opts.allowSteering ?? true;
  const reqs = comps.map((c) => JSON.parse(c.request).messages as Msg[]);
  for (let i = 0; i < reqs.length; i++) {
    const r = reqs[i];
    if (!same(r[0], { role: 'system', content: prompt })) return `request ${i + 1}: message 0 is not the persona prompt`;
    if (!same(r[1], { role: 'system', content: skin })) return `request ${i + 1}: message 1 is not the skin message`;
    for (const m of r.slice(2)) if (m.role === 'system' && !(allow && isSteeringMessage(m.content))) return `request ${i + 1}: system message not in the catalogue`;
    const d = comps[i].displayed;
    const b = bubbles(content(comps[i].response));
    if (d.length > b.length || d.some((x, k) => x.trim() !== b[k])) return `request ${i + 1}: shown text differs from the signed content`;
    if (i === 0) continue;
    const ha = reqs[i - 1].slice(2);
    const hb = r.slice(2);
    for (let k = 0; k < ha.length; k++) if (!same(ha[k], hb[k])) return `request ${i + 1}: history message ${k + 1} was rewritten`;
    const prev = content(comps[i - 1].response);
    const reply = hb[ha.length];
    if (!reply || reply.role !== 'assistant' || ![prev, prev.trim(), strip(prev).trim(), bubbles(prev).join('\n')].includes(reply.content))
      return `request ${i + 1}: previous reply missing or altered`;
    if (hb.slice(ha.length + 1).some((m) => !(m.role === 'user' || (allow && m.role === 'system' && isSteeringMessage(m.content)))))
      return `request ${i + 1}: unexpected non-player turn`;
  }
  return null;
}

/** The browser's compareConversation: the player's copy against the last signed request plus its shown reply. */
export function conversationProblem(comps: Comp[], localBot: string[], localPlayer: string[]): string | null {
  const last = comps[comps.length - 1];
  if (!last) return localBot.length ? 'bot lines without any completion' : null;
  const msgs = JSON.parse(last.request).messages as Msg[];
  const signedBot: string[] = [];
  const signedPlayer: string[] = [];
  for (const m of msgs.slice(2)) {
    if (m.role === 'user') signedPlayer.push(...m.content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    else if (m.role === 'assistant') signedBot.push(...bubbles(m.content));
  }
  signedBot.push(...last.displayed.map((d) => d.trim()).filter(Boolean));
  for (let i = 0; i < Math.max(signedBot.length, localBot.length); i++)
    if (signedBot[i] !== localBot[i]) return `bot message ${i + 1}: seen ${JSON.stringify(localBot[i])}, signed ${JSON.stringify(signedBot[i])}`;
  for (let i = 0; i < signedPlayer.length; i++)
    if (signedPlayer[i] !== localPlayer[i]) return `player message ${i + 1}: sent ${JSON.stringify(localPlayer[i])}, signed ${JSON.stringify(signedPlayer[i])}`;
  return null;
}
