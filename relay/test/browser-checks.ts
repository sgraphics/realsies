// Runs the web app's Verify checks (web/src/verify/checks.ts, read only, never edited from here) on a
// relay bundle: as they are, and with the change the bot engine's steering notes need applied to a
// temporary copy in relay/test/.tmp. The change is the one described in docs/bot-api.md ("Verifying"):
//   1. Chain: after the previous reply a request may carry the player's new lines and published
//      steering notes (was: player lines only).
//   2. System prompt: every system message after message 1 is a published steering note.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webChecks = path.resolve(here, '../../web/src/verify/checks.ts');
const webCrypto = path.resolve(here, '../../web/src/verify/crypto.ts');
const intents = path.resolve(here, '../src/bot/intents.ts');

export interface BrowserCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'na';
  detail?: string;
}
export interface BrowserGroup {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'na';
  checks: BrowserCheck[];
}
export interface ChecksModule {
  runChecks(bundle: unknown, opts?: { localTranscript?: { from: 'me' | 'them'; text: string }[] | null }): BrowserGroup[];
}

export const CHAIN_LINE_OLD = "if (hb.slice(ha.length + 1).some((m) => m.role !== 'user')) { bad = i; why = 'unexpected non-player turn'; break; }";
export const CHAIN_LINE_NEW =
  "if (hb.slice(ha.length + 1).some((m) => m.role !== 'user' && !(m.role === 'system' && isSteeringMessage(m.content)))) { bad = i; why = 'unexpected non-player turn'; break; }";
export const PROMPT_GROUP_OLD = "    groups.push(group('prompt', 'System prompt', checks));";
export const PROMPT_GROUP_NEW = `    if (reqs.length) {
      const badSteer = reqs.filter((r) => !r || r.messages.slice(2).some((m) => m.role === 'system' && !isSteeringMessage(m.content))).length;
      checks.push({ id: 'steering', label: 'Every other system message is a published steering note', status: ok(badSteer === 0), detail: badSteer ? \`\${badSteer} request(s) carry other system text\` : \`\${reqs.length} of \${reqs.length}\` });
    }
    groups.push(group('prompt', 'System prompt', checks));`;

export async function loadBrowserChecks(mode: 'as-is' | 'patched'): Promise<ChecksModule | null> {
  if (!fs.existsSync(webChecks) || !fs.existsSync(webCrypto)) return null;
  if (mode === 'as-is') return (await import(pathToFileURL(webChecks).href)) as ChecksModule;
  let src = fs.readFileSync(webChecks, 'utf8');
  if (!src.includes(CHAIN_LINE_OLD) || !src.includes(PROMPT_GROUP_OLD)) return null; // checks.ts changed shape: skip
  src = src
    .replace(CHAIN_LINE_OLD, CHAIN_LINE_NEW)
    .replace(PROMPT_GROUP_OLD, PROMPT_GROUP_NEW)
    .replace(/from '\.\/crypto\.ts'/, `from '${pathToFileURL(webCrypto).href}'`)
    .replace(/^import type .*shared\/protocol\.ts';$/m, '')
    .replace(/^/, `import { isSteeringMessage } from '${pathToFileURL(intents).href}';\n`);
  const dir = path.join(here, '.tmp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `checks.patched.${process.pid}.${Date.now()}.ts`);
  fs.writeFileSync(file, src);
  try {
    return (await import(pathToFileURL(file).href)) as ChecksModule;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export function failures(groups: BrowserGroup[]): string[] {
  return groups.flatMap((g) => g.checks.filter((c) => c.status === 'fail').map((c) => `${g.title} / ${c.label}: ${c.detail ?? ''}`));
}
