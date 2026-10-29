import { HttpError } from '../http';
import { safeFetch } from './safeFetch';

/**
 * Figma import via the REST API with a personal access token. A frame link becomes one PNG per
 * visible top-level child, positioned by its render bounds, so each part can animate separately.
 */
export const FIGMA_API = 'https://api.figma.com/v1';

export function parseFigmaLink(link: string): { fileKey: string; nodeId: string | null } {
  let u: URL;
  try { u = new URL(link.trim()); } catch { throw new HttpError(400, 'bad_link', 'Paste a Figma link such as https://www.figma.com/design/…'); }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) throw new HttpError(400, 'bad_link', 'That is not a figma.com link');
  const m = u.pathname.match(/^\/(?:file|design|proto)\/([A-Za-z0-9]{10,})/);
  if (!m) throw new HttpError(400, 'bad_link', 'Could not find a file in that Figma link');
  const node = u.searchParams.get('node-id');
  return { fileKey: m[1], nodeId: node ? node.replace(/-/g, ':') : null };
}

async function figmaJson(path: string, token: string) {
  const r = await safeFetch(`${FIGMA_API}${path}`, { headers: { 'X-Figma-Token': token }, accept: 'application/json', maxBytes: 30e6, timeoutMs: 30_000 });
  const body = JSON.parse(r.body.toString('utf8') || '{}');
  if (r.status === 403 || r.status === 401) throw new HttpError(400, 'figma_auth', 'Figma rejected the access token. Check it in Settings → Connections.');
  if (r.status === 404) throw new HttpError(404, 'figma_not_found', 'Figma could not find that file or frame. Check the link and that the token’s account can open it.');
  if (r.status === 429) throw new HttpError(429, 'figma_rate', 'Figma is rate limiting requests. Try again in a minute.');
  if (!r.ok) throw new HttpError(502, 'figma_error', body?.err ?? body?.message ?? `Figma answered with HTTP ${r.status}`);
  return body;
}

export async function verifyFigmaToken(token: string) {
  const me = await figmaJson('/me', token);
  return { handle: me.handle ?? me.email ?? 'Figma user' };
}

type Box = { x: number; y: number; width: number; height: number };
export type FigmaLayer = { name: string; png: Buffer; box: Box };

export async function importFigmaFrame(link: string, token: string): Promise<{ name: string; width: number; height: number; background: string | null; layers: FigmaLayer[]; notes: string[] }> {
  const { fileKey, nodeId } = parseFigmaLink(link);
  let frame: any;
  if (nodeId) {
    const r = await figmaJson(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`, token);
    frame = r.nodes?.[nodeId]?.document;
  } else {
    const r = await figmaJson(`/files/${fileKey}?depth=2`, token);
    frame = r.document?.children?.[0]?.children?.find((n: any) => n.absoluteBoundingBox);
  }
  if (!frame?.absoluteBoundingBox) throw new HttpError(400, 'figma_frame', 'Select a frame in Figma, copy its link (right-click → Copy link to selection) and paste that.');
  const fb: Box = frame.absoluteBoundingBox;
  const notes: string[] = [];
  const kids = (frame.children ?? []).filter((c: any) => c.visible !== false && (c.absoluteRenderBounds || c.absoluteBoundingBox));
  // Split into layers when the frame has a few children; otherwise import the frame as one image.
  const parts: { id: string; name: string; box: Box }[] = kids.length >= 2 && kids.length <= 24
    ? kids.map((c: any) => ({ id: c.id, name: c.name, box: c.absoluteRenderBounds ?? c.absoluteBoundingBox }))
    : [{ id: frame.id, name: frame.name, box: fb }];
  if (kids.length > 24) notes.push(`The frame has ${kids.length} top-level layers, so it was imported as one image. Group layers in Figma to animate them separately.`);
  const scale = Math.max(0.1, Math.min(2, 2048 / Math.max(fb.width, fb.height)));
  const imgs = await figmaJson(`/images/${fileKey}?ids=${encodeURIComponent(parts.map((p) => p.id).join(','))}&format=png&scale=${scale.toFixed(3)}`, token);
  const layers: FigmaLayer[] = [];
  for (const p of parts) {
    const url = imgs.images?.[p.id];
    if (!url) { notes.push(`Figma could not render “${p.name}”.`); continue; }
    const r = await safeFetch(url, { accept: 'image/png', maxBytes: 25e6, timeoutMs: 30_000 });
    if (!r.ok) { notes.push(`Download failed for “${p.name}”.`); continue; }
    layers.push({ name: p.name, png: r.body, box: { x: p.box.x - fb.x, y: p.box.y - fb.y, width: p.box.width, height: p.box.height } });
  }
  const fill = (frame.fills ?? []).find((f: any) => f.type === 'SOLID' && f.visible !== false);
  const hex = fill ? '#' + ['r', 'g', 'b'].map((k) => Math.round(fill.color[k] * 255).toString(16).padStart(2, '0')).join('') : null;
  if (!layers.length) throw new HttpError(502, 'figma_empty', 'Figma did not return any images for that frame');
  return { name: frame.name, width: fb.width, height: fb.height, background: parts.length > 1 ? hex : null, layers, notes };
}
