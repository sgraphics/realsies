// The bot engine over many simulated two-minute chats on virtual time (test/sim.ts): the real
// BotSession executor and default brain, a simulated player, a fake enclave that signs late.
// Checks the policy splits, human typing speed, signatures before display, one say at a time, the
// signed chain with steering messages, and that personas differ.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateChat, testPersona, type SimResult } from './sim.js';
import { chainProblem, conversationProblem } from './chain-rules.js';
import { charsOf, minTypingMs, planBubbles } from '../src/bot/typing.js';
import { LIMITS } from '../src/bot/api.js';
import { createRng } from '../src/bot/rng.js';
import { loadPersonas } from '../src/personas.js';
import { skinMessage } from '../src/formats.js';
import { setLogLevel } from '../src/log.js';

setLogLevel('error');
const here = path.dirname(fileURLToPath(import.meta.url));
const N = Number(process.env.SIM_CHATS ?? 200);
const SKIN = skinMessage('Pickle435', 'abababababababab');

interface SayTrace {
  sayId: number;
  steering: string;
  idx: number;
  t0: number;
  readyAt: number;
  cps: number;
  bubbles: { text: string; typingFrom: number; at: number }[];
}

function keptSays(r: SimResult): SayTrace[] {
  return r.session.trace.filter((e) => e.k === 'say' && (e.d as { idx?: number }).idx !== undefined && !(e.d as { seal?: boolean }).seal).map((e) => e.d as SayTrace);
}

/** Every per-chat invariant; returns per-chat numbers for the aggregate checks. */
function audit(r: SimResult) {
  const where = `chat ${r.session.side.chatId} (${r.persona})`;
  const says = keptSays(r);
  const rows = r.store.loadCompletions();
  const start = r.startedAt;
  const shownBot = r.lines.filter((l) => l.from === 'them');
  // 1. nothing is shown before its signature was handed out, and every shown line is in a signed row
  for (const l of shownBot) {
    const row = r.store.rows.get(l.ci!);
    assert.ok(row?.signature, `${where}: shown line from an unsigned completion`);
    const sigAt = r.ai.sigAt.get(row!.completionId!);
    assert.ok(sigAt !== undefined && sigAt <= l.at, `${where}: "${l.text}" shown at ${l.at - start} before its signature (${sigAt === undefined ? 'never' : sigAt - start})`);
    assert.ok(JSON.parse(row!.verify!).validSignature, `${where}: shown line whose signature did not verify`);
  }
  // 2. human typing: each bubble took at least its minimum typing time, the first counted from the say's start
  const effCps: number[] = [];
  for (const s of says) {
    s.bubbles.forEach((b, i) => {
      const line = shownBot.find((l) => l.ci === s.idx && l.text === b.text);
      assert.ok(line, `${where}: planned bubble not shown`);
      const shownAt = line!.at - start;
      assert.ok(shownAt + 2 >= b.at, `${where}: bubble shown ${b.at - shownAt} ms early`);
      assert.ok(shownAt - b.typingFrom + 2 >= minTypingMs(b.text), `${where}: "${b.text}" typed in ${shownAt - b.typingFrom} ms`);
      if (i === 0) {
        assert.ok(shownAt + 2 >= s.readyAt, `${where}: first bubble before the completion was ready`);
        effCps.push(charsOf(b.text) / ((shownAt - s.t0) / 1000));
      }
    });
  }
  // 3. the typing indicator was on right before every bubble
  for (const l of shownBot) {
    const before = r.typing.filter((t) => t.at <= l.at);
    const lastOn = [...before].reverse().find((t) => t.on);
    assert.ok(lastOn && lastOn.at < l.at, `${where}: no typing indicator before "${l.text}"`);
  }
  // 4. one say at a time, says per minute within the limit
  for (let i = 1; i < says.length; i++) {
    const prevEnd = says[i - 1].bubbles.at(-1)!.at;
    assert.ok(says[i].t0 >= prevEnd - 2, `${where}: say ${says[i].sayId} started before say ${says[i - 1].sayId} finished`);
    assert.ok(says[i].bubbles[0].at - prevEnd + 2 >= LIMITS.minSayGapMs, `${where}: says too close`);
  }
  for (const s of says) assert.ok(says.filter((x) => x.t0 > s.t0 - 60_000 && x.t0 <= s.t0).length <= LIMITS.maxSaysPerMinute, `${where}: too many says per minute`);
  // 5. the signed chain: requests extend each other with player lines and catalogue steering only
  const comps = rows.map((x) => ({ request: x.request, response: x.response, displayed: JSON.parse(x.displayed ?? '[]') as string[] }));
  const prompt = JSON.parse(rows[0]?.request ?? '{"messages":[{"content":""}]}').messages[0].content;
  assert.equal(chainProblem(comps, prompt, SKIN), null, `${where}: chain`);
  const localBot = shownBot.map((l) => l.text);
  const localPlayer = r.lines.filter((l) => l.from === 'me').map((l) => l.text);
  assert.equal(conversationProblem(comps, localBot, localPlayer), null, `${where}: conversation`);
  // a paid chat's last completion carries every player line (the on-chain proof)
  if (rows.length) {
    const lastReq = JSON.parse(rows[rows.length - 1].request).messages as { role: string; content: string }[];
    assert.equal(lastReq.filter((m) => m.role === 'user').length, localPlayer.length, `${where}: the proof misses player lines`);
  }
  // every displayed line in the store matches the screen, in order
  assert.deepEqual(comps.flatMap((c) => c.displayed), localBot, `${where}: displayed vs shown`);
  // double texts: two kept says with no player line in between
  let doubles = 0;
  for (let i = 1; i < says.length; i++) {
    const a = start + says[i - 1].bubbles.at(-1)!.at;
    const b = start + says[i].t0;
    if (!r.lines.some((l) => l.from === 'me' && l.at > a && l.at <= b)) doubles++;
  }
  return { kinds: r.session.stats.kinds, says: says.length, bubbles: shownBot.length, effCps, doubles, stats: r.session.stats, lastBotAt: shownBot.at(-1)?.at };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

test('policy over many chats: half probing, 70/30 inside answering, human typing, signatures first', { timeout: 600_000 }, async () => {
  const persona = testPersona();
  let probe = 0, direct = 0, aside = 0, says = 0, doubles = 0, fake = 0, cancels = 0, chatsWithFake = 0, multi = 0, multiSays = 0;
  const cps: number[] = [];
  const steering: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    const r = await simulateChat({ persona, seed: `policy-${i}` });
    const a = audit(r);
    probe += a.kinds.probe;
    direct += a.kinds.direct;
    aside += a.kinds.aside;
    says += a.says;
    doubles += a.doubles;
    fake += a.stats.fakeTyping;
    cancels += a.stats.cancels;
    if (a.stats.fakeTyping) chatsWithFake++;
    cps.push(...a.effCps);
    for (const [k, v] of Object.entries(a.stats.steering)) steering[k] = (steering[k] ?? 0) + v;
    for (const s of keptSays(r)) {
      multiSays++;
      if (s.bubbles.length > 1) multi++;
    }
  }
  const total = probe + direct + aside;
  const probeShare = probe / total;
  const directShare = direct / (direct + aside);
  cps.sort((x, y) => x - y);
  const median = cps[Math.floor(cps.length / 2)];
  console.log(
    `  ${N} chats, ${total} kept says (${(total / N).toFixed(1)} per chat): probing ${pct(probeShare)}, answering ${pct(1 - probeShare)}; ` +
      `inside answering direct ${pct(directShare)}, out of order ${pct(1 - directShare)}\n` +
      `  first-bubble typing speed: median ${median.toFixed(2)} cps, p5 ${cps[Math.floor(cps.length * 0.05)].toFixed(2)}, p95 ${cps[Math.floor(cps.length * 0.95)].toFixed(2)}, max ${cps.at(-1)!.toFixed(2)}\n` +
      `  double texts ${doubles} (${pct(doubles / says)} of says), multi-bubble says ${pct(multi / multiSays)}, fake typing ${fake} (in ${pct(chatsWithFake / N)} of chats), cancelled drafts ${cancels}\n` +
      `  intents: ${Object.entries(steering).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );
  assert.ok(Math.abs(probeShare - 0.5) <= 0.04, `probe share ${pct(probeShare)}`);
  assert.ok(Math.abs(directShare - 0.7) <= 0.05, `direct share inside answering ${pct(directShare)}`);
  assert.ok(median >= 3.5 && median <= 6.5, `median typing speed ${median}`);
  assert.ok(cps.at(-1)! <= LIMITS.maxCps + 0.01, `fastest first bubble ${cps.at(-1)} cps`);
  assert.ok(doubles > 0 && fake > 0 && cancels > 0, 'double texts, fake typing and cancelled drafts all happen');
  for (const intent of ['opener', 'probe', 'challenge', 'accuse', 'nudge', 'reply', 'react', 'afterthought', 'late_answer', 'tangent']) {
    assert.ok(Object.keys(steering).some((k) => k.startsWith(intent + '/')), `intent ${intent} used`);
  }
});

test('the splits hold with a chatty player; a quiet one leaves less to answer directly', { timeout: 300_000 }, async () => {
  for (const [label, player] of [
    ['chatty player', { answerP: 1, doubleP: 0.45, quietP: 0, opensP: 0.8 }],
    ['quiet player', { answerP: 0.4, quietP: 0.35, opensP: 0.1 }],
  ] as const) {
    let probe = 0, direct = 0, aside = 0;
    for (let i = 0; i < N; i++) {
      const r = await simulateChat({ persona: testPersona(), seed: `${label}-${i}`, player });
      const a = audit(r);
      probe += a.kinds.probe;
      direct += a.kinds.direct;
      aside += a.kinds.aside;
    }
    const ps = probe / (probe + direct + aside);
    const ds = direct / (direct + aside);
    console.log(`  ${label}: probing ${pct(ps)}, direct inside answering ${pct(ds)} over ${probe + direct + aside} says`);
    if (label === 'chatty player') {
      assert.ok(Math.abs(ps - 0.5) <= 0.04, `${label}: probe share ${pct(ps)}`);
      assert.ok(Math.abs(ds - 0.7) <= 0.05, `${label}: direct share ${pct(ds)}`);
    } else {
      // with few player lines the bot still keeps about half its turns for its own goal
      assert.ok(Math.abs(ps - 0.5) <= 0.08, `${label}: probe share ${pct(ps)}`);
      assert.ok(ds >= 0.4, `${label}: direct share ${pct(ds)}`);
    }
  }
});

test('personas differ: terse vs chatty, slow vs fast typers', { timeout: 300_000 }, async () => {
  const ps = loadPersonas(path.resolve(here, '../personas'));
  const byId = Object.fromEntries(ps.map((p) => [p.id, p]));
  const run = async (id: string) => {
    const out = { says: 0, bubbles: 0, doubles: 0, cps: [] as number[], probe: 0, total: 0 };
    for (let i = 0; i < 40; i++) {
      const a = audit(await simulateChat({ persona: byId[id], seed: `${id}-${i}` }));
      out.says += a.says;
      out.bubbles += a.bubbles;
      out.doubles += a.doubles;
      out.cps.push(...a.effCps);
      out.probe += a.kinds.probe;
      out.total += a.kinds.probe + a.kinds.direct + a.kinds.aside;
    }
    out.cps.sort((x, y) => x - y);
    return { ...out, median: out.cps[Math.floor(out.cps.length / 2)] };
  };
  const kenji = await run('kenji-osaka'); // terse, fast thumbs, guarded
  const jules = await run('jules-montreal'); // chatty, curious
  const walt = await run('walt-maine'); // slow typer
  for (const [n, x] of [['kenji', kenji], ['jules', jules], ['walt', walt]] as const) {
    console.log(`  ${n}: ${(x.says / 40).toFixed(1)} says and ${(x.bubbles / 40).toFixed(1)} bubbles per chat, ${x.doubles} double texts, median ${x.median.toFixed(2)} cps, probing ${pct(x.probe / x.total)}`);
  }
  assert.ok(jules.bubbles > kenji.bubbles, 'the chatty persona sends more bubbles');
  assert.ok(jules.doubles > kenji.doubles, 'the chatty persona double-texts more');
  assert.ok(walt.median < kenji.median - 1, 'the slow typer types slower');
  assert.ok(jules.probe / jules.total > kenji.probe / kenji.total, 'the curious persona probes more');
});

test('never bangs a long text: typing time scales with length', () => {
  const rng = createRng('long');
  const text = 'honestly the bus took forever today and i am so done with it';
  for (let i = 0; i < 200; i++) {
    const s = planBubbles({ bubbles: [text], cps: 5, t0: 0, ready: 900, prevShownAt: null, endAt: 120_000, hesitateP: 0.2, rng });
    assert.ok(s && s[0].at >= (charsOf(text) / 6.2) * 1000, `shown at ${s?.[0].at}`);
  }
  // three bubbles near the end are squeezed toward 9 cps but never faster, or dropped
  const three = ['ok wait', 'i actually live near the river', 'so yeah'];
  const s = planBubbles({ bubbles: three, cps: 5, t0: 100_000, ready: 101_000, prevShownAt: null, endAt: 112_000, hesitateP: 0, rng });
  assert.ok(s);
  s!.forEach((b, i) => assert.ok(b.at - b.typingFrom >= minTypingMs(three[i]) - 0.01));
  assert.ok(s!.at(-1)!.at <= 112_000 - 400);
  assert.equal(planBubbles({ bubbles: three, cps: 5, t0: 110_000, ready: 110_500, prevShownAt: null, endAt: 112_000, hesitateP: 0, rng }), null);
});
