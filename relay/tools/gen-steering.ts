// Writes shared/steering.ts (the copy the browser's Verify drawer checks against) from the relay's
// steering catalogue in src/bot/intents.ts. relay/test/steering-shared.test.ts fails if the two drift.
//
//   npx tsx tools/gen-steering.ts           write ../shared/steering.ts
//   npx tsx tools/gen-steering.ts --check   exit 1 if the file is not what this would write
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEERING, STEERING_SHA256, STEER_VERSION } from '../src/bot/intents.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../shared/steering.ts');

export function sharedSteeringSource(): string {
  const lines = [
    `// Steering catalogue ${STEER_VERSION}: the only text the relay may add to a bot request besides the committed`,
    '// persona prompt (message 0), the skin message (message 1) and the player\'s own lines. A brain chooses an',
    '// intent; the relay appends the matching string below as a system message. Anyone verifying a bot chat checks',
    '// every system message after message 1 against this list byte for byte, so nobody can ghost-write through the',
    '// model. Generated from relay/src/bot/intents.ts; relay/test/steering-shared.test.ts fails if they drift.',
    `// sha256 of JSON [[id, text], ...] in this order: ${STEERING_SHA256}`,
    '',
    `export const STEER_VERSION = '${STEER_VERSION}';`,
    '',
    `export const STEERING_SHA256 = '${STEERING_SHA256}';`,
    '',
    `/** [id, exact text] for every steering message ${STEER_VERSION} can produce. */`,
    'export const STEERING: readonly (readonly [string, string])[] = [',
    ...STEERING.map((e) => `  [${JSON.stringify(e.id)}, ${JSON.stringify(e.text)}],`),
    '];',
    '',
    'const TEXTS = new Set(STEERING.map(([, text]) => text));',
    '',
    'export function isSteeringMessage(content: string): boolean {',
    '  return TEXTS.has(content);',
    '}',
    '',
    'export function steeringIdOf(content: string): string | undefined {',
    '  return STEERING.find(([, text]) => text === content)?.[0];',
    '}',
    '',
  ];
  return lines.join('\n');
}

if (process.argv[1] && /gen-steering\.ts$/.test(process.argv[1])) {
  const src = sharedSteeringSource();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur !== src) {
      console.error(`${out} is out of date; run npx tsx tools/gen-steering.ts`);
      process.exit(1);
    }
    console.log(`${out} is up to date (${STEERING.length} notes, sha256 ${STEERING_SHA256})`);
  } else {
    fs.writeFileSync(out, src);
    console.log(`wrote ${out}: ${STEERING.length} notes, sha256 ${STEERING_SHA256}`);
  }
}
