/** Content sniffing: uploads are classified by magic bytes, never by filename or client MIME. */
export type Sniffed = { mime: string; ext: string; family: 'image' | 'svg' | 'video' | 'font' | 'json' | 'audio'; width?: number; height?: number };

const ascii = (b: Buffer, s: number, e: number) => b.subarray(s, e).toString('latin1');

export function sniff(b: Buffer): Sniffed | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return { mime: 'image/png', ext: 'png', family: 'image', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', family: 'image', ...jpegSize(b) };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp', family: 'image', ...webpSize(b) };
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { mime: 'image/gif', ext: 'gif', family: 'image', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (ascii(b, 4, 8) === 'ftyp') return { mime: 'video/mp4', ext: 'mp4', family: 'video' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'video/webm', ext: 'webm', family: 'video' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE') return { mime: 'audio/wav', ext: 'wav', family: 'audio' };
  if (ascii(b, 0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg', family: 'audio' };
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2)) return { mime: 'audio/mpeg', ext: 'mp3', family: 'audio' };
  if (ascii(b, 0, 4) === 'wOF2') return { mime: 'font/woff2', ext: 'woff2', family: 'font' };
  if (ascii(b, 0, 4) === 'wOFF') return { mime: 'font/woff', ext: 'woff', family: 'font' };
  if (ascii(b, 0, 4) === 'OTTO') return { mime: 'font/otf', ext: 'otf', family: 'font' };
  if (b.readUInt32BE(0) === 0x00010000) return { mime: 'font/ttf', ext: 'ttf', family: 'font' };
  const head = b.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { mime: 'image/svg+xml', ext: 'svg', family: 'svg', ...svgSize(head) };
  if (head.startsWith('{')) return { mime: 'application/json', ext: 'json', family: 'json' };
  return null;
}

/** SVGs are rejected (not "cleaned") when they contain active content. */
export function svgProblems(text: string): string[] {
  const p: string[] = [];
  if (/<script/i.test(text)) p.push('contains <script>');
  if (/\son[a-z]+\s*=/i.test(text)) p.push('contains event handler attributes');
  if (/javascript:/i.test(text)) p.push('contains javascript: URLs');
  if (/<foreignObject/i.test(text)) p.push('contains <foreignObject>');
  if (/(xlink:)?href\s*=\s*["']\s*(https?:|\/\/)/i.test(text)) p.push('references external resources');
  if (/<!ENTITY/i.test(text)) p.push('declares XML entities');
  return p;
}

function jpegSize(b: Buffer) {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return {};
}
function webpSize(b: Buffer) {
  const t = ascii(b, 12, 16);
  if (t === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (t === 'VP8L') { const n = b.readUInt32LE(21); return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 }; }
  if (t === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  return {};
}
function svgSize(head: string) {
  const vb = head.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (vb) return { width: Math.round(+vb[1]), height: Math.round(+vb[2]) };
  const w = head.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i), h = head.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i);
  return w && h ? { width: Math.round(+w[1]), height: Math.round(+h[1]) } : {};
}
