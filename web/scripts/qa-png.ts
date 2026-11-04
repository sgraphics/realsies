// Small PNG tools for the QA screenshots (Node, no dependencies): decode (8-bit RGB/RGBA,
// non-interlaced, as Chrome writes them), crop, box-filter downscale, encode, and contact sheets
// labelled with the art engine's pixel font.
//   tsx scripts/qa-png.ts crop <in.png> <out.png> <w> <h>
//   tsx scripts/qa-png.ts sheet <dir> <out.png> [title]

import { inflateSync } from 'node:zlib';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { encodePng } from '../../art/scripts/png.ts';
import { drawText, textWidth } from '../../art/src/core/font.ts';
import { PAL } from '../../art/src/core/palette.ts';

interface Img {
  w: number;
  h: number;
  data: Uint8ClampedArray; // RGBA
}

export function decodePng(buf: Uint8Array): Img {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 8;
  let w = 0, h = 0, type = 0, depth = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  while (o < buf.length) {
    const len = dv.getUint32(o);
    const t = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (t === 'IHDR') {
      const b = new DataView(body.buffer, body.byteOffset, body.byteLength);
      w = b.getUint32(0);
      h = b.getUint32(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (t === 'IDAT') idat.push(body);
    else if (t === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace) throw new Error(`unsupported png: depth ${depth} type ${type} interlace ${interlace}`);
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = up ? up[x] : 0;
      const c = up && x >= bpp ? up[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) {
    data[i * 4] = px[j];
    data[i * 4 + 1] = px[j + 1];
    data[i * 4 + 2] = px[j + 2];
    data[i * 4 + 3] = bpp === 4 ? px[j + 3] : 255;
  }
  return { w, h, data };
}

export function crop(img: Img, w: number, h: number): Img {
  const cw = Math.min(w, img.w), ch = Math.min(h, img.h);
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(img.data.subarray(y * img.w * 4, y * img.w * 4 + cw * 4), y * cw * 4);
  return { w: cw, h: ch, data: out };
}

/** Area-average downscale to fit (maxW, maxH). */
export function fit(img: Img, maxW: number, maxH: number): Img {
  const k = Math.min(1, maxW / img.w, maxH / img.h);
  if (k >= 1) return img;
  const w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.h) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.h) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.w) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.w) / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.w + xx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n++;
        }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { w, h, data: out };
}

function blitInto(dst: Img, src: Img, x: number, y: number): void {
  for (let yy = 0; yy < src.h; yy++) {
    const ty = y + yy;
    if (ty < 0 || ty >= dst.h) continue;
    const w = Math.min(src.w, dst.w - x);
    if (w <= 0) continue;
    dst.data.set(src.data.subarray(yy * src.w * 4, yy * src.w * 4 + w * 4), (ty * dst.w + x) * 4);
  }
}

function write(path: string, img: Img): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(img as never));
}

/** Order screenshots by the size list (phones first), then by name. */
const ORDER = ['360x640', '390x844', '430x932', '844x390', '768x1024', '1024x768', '1280x720', '1440x900', '1920x1080', '2560x1440'];
function rank(name: string): number {
  const i = ORDER.findIndex((s) => name.startsWith(s));
  return i < 0 ? 99 : i;
}

export function sheet(dir: string, out: string, title = basename(dir)): void {
  const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  if (!files.length) return;
  const CELL_H = 440, MAX_W = 2600, GAP = 16, LABEL = 26, PAD = 16;
  const thumbs = files.map((f) => ({ name: f.replace(/\.png$/, ''), img: fit(decodePng(readFileSync(join(dir, f))), 760, CELL_H) }));
  // flow into rows
  const rows: { items: typeof thumbs; h: number }[] = [];
  let cur: typeof thumbs = [];
  let curW = PAD;
  for (const t of thumbs) {
    if (cur.length && curW + t.img.w + GAP > MAX_W) {
      rows.push({ items: cur, h: Math.max(...cur.map((c) => c.img.h)) });
      cur = [];
      curW = PAD;
    }
    cur.push(t);
    curW += t.img.w + GAP;
  }
  if (cur.length) rows.push({ items: cur, h: Math.max(...cur.map((c) => c.img.h)) });
  const W = Math.max(...rows.map((r) => r.items.reduce((a, c) => a + c.img.w + GAP, PAD))) + PAD;
  const H = 54 + rows.reduce((a, r) => a + r.h + LABEL + GAP, 0) + PAD;
  const img: Img = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
  const bg = [0x26, 0x2b, 0x44];
  for (let i = 0; i < W * H; i++) img.data.set([bg[0], bg[1], bg[2], 255], i * 4);
  const text = (s: string, x: number, y: number, k: number, c: number) => {
    const t = { w: textWidth(s, k) + 2, h: 5 * k + 2, data: new Uint8ClampedArray((textWidth(s, k) + 2) * (5 * k + 2) * 4) };
    drawText(t as never, s, 0, 0, c, { scale: k });
    for (let yy = 0; yy < t.h; yy++)
      for (let xx = 0; xx < t.w; xx++) {
        const i = (yy * t.w + xx) * 4;
        if (t.data[i + 3]) img.data.set([t.data[i], t.data[i + 1], t.data[i + 2], 255], ((y + yy) * W + x + xx) * 4);
      }
  };
  text(title.toUpperCase(), PAD, PAD, 5, PAL.yellow);
  let y = 54;
  for (const r of rows) {
    let x = PAD;
    for (const t of r.items) {
      text(t.name, x, y, 3, PAL.greyLight);
      blitInto(img, t.img, x, y + LABEL - 4);
      x += t.img.w + GAP;
    }
    y += r.h + LABEL + GAP;
  }
  write(out, img);
  console.log(`sheet ${out} (${files.length} shots, ${W}x${H})`);
}

const [cmd, a, b, c, d] = process.argv.slice(2);
if (cmd === 'crop') {
  const img = decodePng(readFileSync(a));
  write(b, crop(img, Number(c), Number(d)));
  if (a !== b && process.env.QA_KEEP_RAW !== '1') unlinkSync(a);
} else if (cmd === 'sheet') sheet(a, b, c);
