// node scripts/share-pages.mjs
//   Writes the four static pages a shared call links to, public/s/<outcome>/index.html, from the texts in
//   src/state/share.ts (read as text, so this needs no build). Each page carries the link-preview tags for its card
//   (public/s/<outcome>.png, rendered by `npx tsx scripts/share-cards.ts --web` in ../trailer) and sends a visitor on
//   into the game. Run it again after changing a title or the origin; the pages are committed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(web, 'src', 'state', 'share.ts'), 'utf8');
const block = (name) => {
  const m = new RegExp(`export const ${name}[^=]*= \\{([^}]*)\\}`).exec(src);
  if (!m) throw new Error(`share.ts: ${name} not found`);
  return Object.fromEntries([...m[1].matchAll(/(\w+): '([^']*)'/g)].map((x) => [x[1], x[2]]));
};
const titles = block('SHARE_TITLE');
const origin = /export const SHARE_ORIGIN = '([^']+)'/.exec(src)?.[1];
if (!origin || Object.keys(titles).length !== 4) throw new Error('share.ts: origin or titles not read');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const DESC = 'Realsies: two minutes with a stranger, then call it. Human or bot? Your first chat is free.';

for (const [o, title] of Object.entries(titles)) {
  const head = `${title}. Can you tell who's real?`;
  const to = `/?via=share-${o}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Realsies: ${esc(title)}</title>
<meta name="description" content="${esc(DESC)}">
<link rel="canonical" href="${origin}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Realsies">
<meta property="og:url" content="${origin}/s/${o}/">
<meta property="og:title" content="${esc(head)}">
<meta property="og:description" content="${esc(DESC)}">
<meta property="og:image" content="${origin}/s/${o}.png">
<meta property="og:image:width" content="2064">
<meta property="og:image:height" content="1080">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(head)}">
<meta name="twitter:description" content="${esc(DESC)}">
<meta name="twitter:image" content="${origin}/s/${o}.png">
<meta http-equiv="refresh" content="0; url=${to}">
<style>body{margin:0;background:#181425;color:#e4e4ef;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:48px 20px}a{color:#8ff8e2}</style>
</head>
<body>
<p>${esc(head)}</p>
<p><a href="${to}">Play Realsies</a></p>
<script>location.replace(${JSON.stringify(to)});</script>
</body>
</html>
`;
  const dir = join(web, 'public', 's', o);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  console.log(`wrote public/s/${o}/index.html`);
}
