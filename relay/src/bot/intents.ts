// Steering catalogue steer-v1: the only text the relay adds to a bot request besides the committed
// persona prompt (message 0), the skin message (message 1) and the player's own lines.
//
// A brain picks an intent (plus a topic for tangents and a length); the relay appends exactly one
// of the fixed strings below as a system message at the end of the request. Steering messages stay
// in the history, so every request is the previous request + the previous reply + the player's new
// lines + one new steering message. The set is finite and published (STEERING, docs/bot-api.md):
// a verifier checks every non-player, non-reply message after message 1 against it byte for byte,
// so nobody can ghost-write through the model.
//
// Append-only: a published note never changes and never moves, so every past round stays verifiable;
// new intents add notes at the end (changing or removing one would need steer-v2). History, sha256 of the
// canonical catalogue JSON:
//   2026-11-04  37 notes  9a87ff905c41b0e823a5842a052d20b8c4b22729b7f008b5bcd3d77baa023338
//   2026-11-05  39 notes  + foreign/one, foreign/multi (STEERING_SHA256 below)
import { sha256Hex } from '../crypto.js';
import { INTENTS, LENGTHS, TOPICS, type Intent, type Length, type SayIntent, type Topic, kindOf } from './api.js';

export const STEER_VERSION = 'steer-v1';

const BODY: Record<Exclude<Intent, 'tangent'>, string> = {
  opener: 'Open the chat with your first message: a casual hello, maybe with a quick first question to size them up.',
  probe:
    'Your turn to test them. Your message must be a question a real person could answer easily but a bot might fumble, like what they can see or hear right now or what they ate today.',
  challenge:
    'Your turn to test them. Your message must give them a playful little test to prove they are human, something a real person would get right or bother to do. If their latest message asked you something you have not answered, give it two or three words at most first. Casual, not hostile.',
  accuse:
    'Your message must tease them that they might be a bot, pointing at something in what they said or how they write, and see how they react. Light and joking, not rude.',
  nudge: 'They have gone quiet. Say something to get them talking again, maybe joking that the silence is suspicious.',
  verdict: 'The chat ends in a few seconds. Tell them casually what you reckon so far, real person or bot, or fire one last quick question.',
  reply: 'Reply directly to what they just said. If they asked you something, answer it.',
  react: 'React to their last message in just a few words, like a laugh, surprise or agreeing.',
  afterthought: 'Add a quick afterthought to your own last message, something you forgot to say, without repeating yourself.',
  clarify: 'Clarify or fix something you said earlier, the way people do when they reread their own text.',
  late_answer: 'Go back to something they said or asked earlier that you skipped, and answer it now, as if you only just noticed.',
  foreign:
    'Their last message is in a language you do not speak, and you cannot understand it. React the way a real person would; do not translate it, answer it or write in it.',
};

const TOPIC: Record<Topic, string> = {
  local: 'something going on in your town or your street today',
  news: 'something you saw online or heard about today',
  sport: 'a match, a team or a sport you follow',
  music: 'music you have been listening to, or a gig',
  food: 'what you ate today or what you want to eat',
  weather: 'the weather where you are right now',
  work: 'something from your work, school or daily routine',
  hot_take: 'a mild, harmless hot take about everyday life',
};

const LENGTH: Record<Length, string> = {
  one: 'One short line, under 12 words.',
  multi: 'Send it as two or three very short texts, each on its own line.',
};

const SUFFIX = 'Write only the message.';

/** Normalize an intent: tangents need a topic, others never carry one; react is always one line. */
export function normalizeIntent(s: SayIntent): Required<Pick<SayIntent, 'intent' | 'length'>> & { topic?: Topic } {
  const length: Length = s.intent === 'react' ? 'one' : s.length ?? 'one';
  return s.intent === 'tangent' ? { intent: s.intent, topic: s.topic ?? 'local', length } : { intent: s.intent, length };
}

/** Catalogue id, e.g. "probe/one", "tangent/music/multi". */
export function steeringId(s: SayIntent): string {
  const n = normalizeIntent(s);
  return n.intent === 'tangent' ? `tangent/${n.topic}/${n.length}` : `${n.intent}/${n.length}`;
}

/** The exact steering message for an intent. */
export function steeringText(s: SayIntent): string {
  const n = normalizeIntent(s);
  const head = n.intent === 'tangent' ? `[${STEER_VERSION}/tangent/${n.topic}]` : `[${STEER_VERSION}/${n.intent}]`;
  const body =
    n.intent === 'tangent'
      ? `Your message must change the subject, as if it just popped into your head: ${TOPIC[n.topic!]}. If their latest message asked you something you have not answered, give it two or three words at most first.`
      : BODY[n.intent];
  return `${head} ${body} ${LENGTH[n.length]} ${SUFFIX}`;
}

export interface SteeringEntry {
  id: string;
  intent: Intent;
  topic?: Topic;
  length: Length;
  kind: 'probe' | 'direct' | 'aside';
  text: string;
}

function enumerate(): SteeringEntry[] {
  const out: SteeringEntry[] = [];
  for (const intent of INTENTS) {
    const topics: (Topic | undefined)[] = intent === 'tangent' ? [...TOPICS] : [undefined];
    const lengths: Length[] = intent === 'react' ? ['one'] : [...LENGTHS];
    for (const topic of topics)
      for (const length of lengths) {
        const s: SayIntent = { intent, topic, length };
        out.push({ id: steeringId(s), intent, topic, length, kind: kindOf(intent), text: steeringText(s) });
      }
  }
  return out;
}

/** The first published catalogue (37 notes): its canonical JSON hash, which the first 37 entries must keep. */
export const STEERING_V1_37_SHA256 = '9a87ff905c41b0e823a5842a052d20b8c4b22729b7f008b5bcd3d77baa023338';

/** Every steering message steer-v1 can produce (39 strings), in catalogue order. */
export const STEERING: readonly SteeringEntry[] = Object.freeze(enumerate());
const BY_TEXT = new Map(STEERING.map((e) => [e.text, e]));

/** sha256 of the catalogue's canonical JSON ([[id, text], ...] in catalogue order); pinned in tests and docs. */
export const STEERING_SHA256 = sha256Hex(JSON.stringify(STEERING.map((e) => [e.id, e.text])));

export function isSteeringMessage(content: string): boolean {
  return BY_TEXT.has(content);
}

export function steeringEntry(content: string): SteeringEntry | undefined {
  return BY_TEXT.get(content);
}

/** Parse and validate an intent from untrusted JSON (remote brains). Returns an error string or the intent. */
export function parseSayIntent(a: Record<string, unknown>): SayIntent | string {
  const allowed = new Set(['type', 'intent', 'topic', 'length', 'typing']);
  for (const k of Object.keys(a)) {
    if (k === 'text' || k === 'content' || k === 'message') return 'free_text_not_allowed: a say carries an intent, never text';
    if (!allowed.has(k)) return `unknown field ${k}`;
  }
  if (typeof a.intent !== 'string' || !(INTENTS as readonly string[]).includes(a.intent)) return `unknown intent ${String(a.intent)}`;
  const intent = a.intent as Intent;
  if (a.topic !== undefined && (intent !== 'tangent' || !(TOPICS as readonly string[]).includes(a.topic as string)))
    return intent === 'tangent' ? `unknown topic ${String(a.topic)}` : 'topic is for tangent only';
  if (a.length !== undefined && !(LENGTHS as readonly string[]).includes(a.length as string)) return `unknown length ${String(a.length)}`;
  return { intent, topic: a.topic as Topic | undefined, length: a.length as Length | undefined };
}
