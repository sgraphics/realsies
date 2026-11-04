// Runs the Verify drawer's checks (src/verify/checks.ts) in Node against a live relay bundle.
// Usage: npx tsx scripts/verify-live.ts <baseUrl> <roundId> <account> [<me line>|<them line> ...]
// Lines are "me:text" or "them:text" and stand in for the transcript the browser keeps in localStorage.
import { runChecks, summarize, type LocalLine } from '../src/verify/checks.ts';

const [base, round, account, ...lines] = process.argv.slice(2);
const local: LocalLine[] = lines.map((l) => {
  const i = l.indexOf(':');
  return { from: l.slice(0, i) === 'me' ? 'me' : 'them', text: l.slice(i + 1) };
});

const get = async (path: string) => {
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
};

const results = await get(`/api/rounds/${round}/results/${account}`);
console.log(`round ${results.roundId} ${results.status}: called ${results.calledRight}/${results.calledTotal}, rating ${results.ratingBefore} -> ${results.ratingAfter}`);
for (const c of results.chats) {
  console.log(`  chat ${c.chatId.slice(0, 10)} partner ${c.partner.name}: truth ${c.truth}${c.model ? ' (' + c.model + ')' : ''}, call ${c.myCall}, right ${c.right}, verifiable ${c.verifiable}`);
}
const botChat = results.chats.find((c: any) => c.verifiable);
if (!botChat) {
  console.log('no verifiable bot chat in this round');
  process.exit(0);
}
const bundle = await get(`/api/verify/${botChat.chatId}?account=${encodeURIComponent(account)}`);
const groups = runChecks(bundle, { localTranscript: local.length ? local : null });
for (const g of groups) {
  console.log(`\n${g.title ?? (g as any).label ?? ''}`);
  for (const c of g.checks) console.log(`  [${c.status.toUpperCase()}] ${c.label}${c.detail ? ' - ' + c.detail : ''}`);
}
const s = summarize(groups);
console.log(`\nsummary: ${s.pass} pass, ${s.fail} fail, ${s.na} n/a`);
process.exit(s.fail > 0 ? 1 : 0);
