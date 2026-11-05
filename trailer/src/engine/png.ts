// A fast PNG writer for 1920x1080 frames of upscaled pixel art: rows that repeat the row above use
// the "up" filter (all zeros), others "sub", then a quick deflate. RGB, 8-bit. Node only.

import { deflateSync, constants } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import type { Rgba } from '../art.ts';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodeRgbPng(img: Rgba): Buffer {
  const { w, h, data } = img;
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    for (let x = 0, s = y * w * 4; x < w; x++, s += 4) {
      cur[x * 3] = data[s];
      cur[x * 3 + 1] = data[s + 1];
      cur[x * 3 + 2] = data[s + 2];
    }
    const o = y * (stride + 1);
    let same = y > 0;
    if (same) for (let i = 0; i < stride; i++) if (cur[i] !== prev[i]) { same = false; break; }
    if (same) {
      raw[o] = 2; // up: the row is all zeros
    } else {
      raw[o] = 1; // sub
      for (let i = 0; i < stride; i++) raw[o + 1 + i] = (cur[i] - (i >= 3 ? cur[i - 3] : 0)) & 0xff;
    }
    prev.set(cur);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = deflateSync(raw, { level: 3, strategy: constants.Z_DEFAULT_STRATEGY });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]);
}

export function writeRgbPng(path: string, img: Rgba): void {
  writeFileSync(path, encodeRgbPng(img));
}
