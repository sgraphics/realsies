// QA static server for the local build: serves web/dist (SPA fallback) and one harness page,
// /__qa/frame.html?w=390&h=844&src=/?mock=1..., that shows the app in an iframe of exactly w x h
// CSS px. Headless Chrome on Windows will not make a window narrower than 500 px and takes the
// window frame off the viewport, so phone sizes are emulated by the iframe (its own viewport,
// media queries and devicePixelRatio), and the screenshot is cropped to w x h afterwards.
// usage: node scripts/qa-serve.mjs [port=5173]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const port = Number(process.argv[2] ?? process.env.QA_PORT ?? 5173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
const FRAME = `<!doctype html><html><head><meta charset="utf-8"><title>qa frame</title>
<style>html,body{margin:0;padding:0;background:#000;overflow:hidden}iframe{border:0;display:block;position:absolute;left:0;top:0}</style></head>
<body><iframe id="f"></iframe><script>
var q=new URLSearchParams(location.search),f=document.getElementById('f');
f.width=q.get('w');f.height=q.get('h');f.src=q.get('src');
</script></body></html>`;

http
  .createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://qa');
    if (u.pathname === '/__qa/frame.html') {
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      return res.end(FRAME);
    }
    const rel = normalize(decodeURIComponent(u.pathname)).replace(/^[\\/]+/, '');
    if (rel.startsWith('..')) {
      res.writeHead(403);
      return res.end();
    }
    const file = rel || 'index.html';
    try {
      const body = await readFile(join(root, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      const body = await readFile(join(root, 'index.html'));
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      res.end(body);
    }
  })
  .listen(port, () => console.log(`qa server: http://localhost:${port}/ (web/dist)`));
