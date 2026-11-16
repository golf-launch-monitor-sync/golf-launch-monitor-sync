// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The project's icon, drawn in code (no image files to keep in step, no provider's mark): a white
 * ball on a green rounded square, with a gold arc around it for "sync". PNG of any size.
 */

import { deflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA pixels (row by row) as a PNG. */
export function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8; // bit depth
  head[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v) => Math.max(0, Math.min(1, v));

/** The icon at `size` px, 4×4 samples a pixel. */
export function icon(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const u = (x + (sx + 0.5) / S) / size - 0.5;
          const v = (y + (sy + 0.5) / S) / size - 0.5;
          // rounded square
          const q = Math.max(Math.abs(u), Math.abs(v));
          const corner = Math.hypot(Math.max(Math.abs(u) - 0.30, 0), Math.max(Math.abs(v) - 0.30, 0));
          if (q > 0.5 || corner > 0.2) continue;
          let c = [20, 83, 45];
          const d = Math.hypot(u, v);
          // gold arc, three quarters, open at the top right
          const ang = Math.atan2(v, u);
          if (d > 0.30 && d < 0.375 && !(ang > -1.55 && ang < -0.05)) c = [214, 169, 54];
          // the ball
          if (d < 0.22) {
            const shade = 1 - 0.18 * clamp((u + v + 0.2) / 0.4);
            c = [255 * shade, 255 * shade, 255 * shade];
            for (const [du, dv] of [[-0.07, -0.06], [0.05, -0.08], [-0.02, 0.03], [0.09, 0.04], [-0.1, 0.08], [0.02, 0.12]]) {
              if (Math.hypot(u - du, v - dv) < 0.022) c = [200, 205, 205];
            }
          }
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = S * S;
      const i = (y * size + x) * 4;
      const cover = a / n / 255;
      px[i] = cover ? r / (cover * n) : 0;
      px[i + 1] = cover ? g / (cover * n) : 0;
      px[i + 2] = cover ? b / (cover * n) : 0;
      px[i + 3] = a / n;
    }
  }
  return png(size, px);
}
