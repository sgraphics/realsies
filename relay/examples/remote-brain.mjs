// A tiny remote brain for Realsies (protocol realsies-brain/1, docs/bot-api.md). Node 22+, no dependencies.
//
//   node examples/remote-brain.mjs --hash <token>          sha256 of a token, for relay/botmasters/<name>.json
//   RELAY=ws://localhost:3960/bot/ws TOKEN=<token> node examples/remote-brain.mjs
//
// It plays every chat of the botmaster's personas with a deliberately simple policy: after the player
// writes, read for a moment, then alternate between answering and testing them (or, when the line is in a
// language the persona does not read, say foreign); when the chat goes quiet, nudge; otherwise send `wait`
// often enough that the relay knows this brain is alive. It never sends text: only intents. The relay
// turns each intent into one signed enclave completion.
import crypto from 'node:crypto';

if (process.argv[2] === '--hash') {
  console.log(crypto.createHash('sha256').update(process.argv[3] ?? '', 'utf8').digest('hex'));
  process.exit(0);
}

const url = process.env.RELAY ?? 'ws://localhost:3960/bot/ws';
const token = process.env.TOKEN;
if (!token) throw new Error('set TOKEN');

const chats = new Map(); // chatId -> state
let keepaliveMs = 5000; // a third of the silence limit the relay announces in welcome
const ws = new WebSocket(url);
const act = (chatId, action) => ws.send(JSON.stringify({ type: 'action', chatId, action }));

ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token, protocol: 'realsies-brain/1' }));
ws.onclose = (e) => console.log(`closed ${e.code} ${e.reason}`);
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.type === 'welcome') {
    keepaliveMs = Math.max(1000, Math.floor(m.silenceMs / 3));
    return console.log(`connected as ${m.botmaster}, driving ${m.personas.join(', ')} (${m.steerVersion})`);
  }
  if (m.type === 'error') return console.warn(`relay: ${m.code} ${m.message}${m.chatId ? ` (${m.chatId})` : ''}`);
  if (m.type !== 'event') return;
  const e = m.event;
  const c = chats.get(m.chatId);
  switch (e.type) {
    case 'chat_started':
      chats.set(m.chatId, { busy: false, heardAt: null, lastAt: 0, lastActionAt: 0, turns: 0, persona: e.persona, foreign: false });
      console.log(`${m.chatId}: chat started as ${e.persona.id}, ${Math.round(e.chatMs / 1000)} s`);
      return;
    case 'player_message':
      if (c) c.heardAt = c.heardAt ?? e.at;
      if (c) c.lastAt = e.at;
      // lang: set by the relay only when the line is clearly not English; the card says what the persona reads
      if (c) c.foreign = !!(e.lang && c.persona.languages && !c.persona.languages[e.lang]);
      console.log(`${m.chatId}: player: ${e.text}${e.lang ? ` [${e.lang}]` : ''}`);
      return;
    case 'say_started':
      if (c) c.busy = true;
      return;
    case 'bot_message_shown':
      if (c) c.lastAt = e.at;
      console.log(`${m.chatId}: bot [${e.sayId}]: ${e.text}`);
      return;
    case 'say_done':
    case 'say_dropped':
      if (c) c.busy = false;
      console.log(`${m.chatId}: say ${e.sayId} ${e.type === 'say_done' ? 'done' : `dropped (${e.reason})`}`);
      return;
    case 'action_rejected':
      console.warn(`${m.chatId}: rejected ${JSON.stringify(e.action)}: ${e.reason}`);
      if (c) c.busy = false;
      return;
    case 'chat_ended':
      chats.delete(m.chatId);
      console.log(`${m.chatId}: chat ended (${e.reason})`);
      return;
    case 'tick': {
      if (!c || c.busy) return;
      const send = (action) => {
        act(m.chatId, action);
        c.lastActionAt = e.at;
        if (action.type === 'say') {
          c.busy = true;
          c.turns++;
          console.log(`${m.chatId}: say ${action.intent}`);
        }
      };
      if (c.heardAt !== null && e.at - c.heardAt > 2500) {
        // something to answer: answer on even turns, test them on odd ones
        c.heardAt = null;
        if (c.foreign) return send({ type: 'say', intent: 'foreign' });
        return send(c.turns % 2 === 0 ? { type: 'say', intent: 'reply' } : { type: 'say', intent: 'probe' });
      }
      if (c.turns === 0 && e.at > 5000) return send({ type: 'say', intent: 'opener' });
      if (e.at - c.lastAt > 15_000 && e.remainingMs > 8000) return send({ type: 'say', intent: c.turns % 3 ? 'nudge' : 'tangent', topic: c.turns % 3 ? undefined : c.persona.interests[0] });
      if (e.at - c.lastActionAt > keepaliveMs) return send({ type: 'wait' }); // keepalive
      return;
    }
  }
};
