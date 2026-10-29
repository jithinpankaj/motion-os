import type { SceneDocument, Layer } from './scene/schema';
import type { ChannelFormat } from './formats';

type Target = Pick<ChannelFormat, 'width' | 'height'> & Partial<Pick<ChannelFormat, 'id' | 'safe'>>;

/**
 * Produce a destination-specific layout of a scene without stretching it.
 * Positions are fractional and sizes are relative to min(width, height), so procedural layers
 * re-render natively at the new aspect; text respects safe areas; per-format overrides win.
 */
export function adaptScene(scene: SceneDocument, target: Target): SceneDocument {
  const { width, height } = target;
  if (width === scene.canvas.width && height === scene.canvas.height && !target.id) return scene;
  const designAspect = scene.canvas.width / scene.canvas.height;
  const aspect = width / height;
  const designMin = Math.min(scene.canvas.width, scene.canvas.height);
  const min = Math.min(width, height);
  const overrides = (target.id && scene.responsive.overrides[target.id]) || {};
  const safe = target.safe ?? { top: 0, right: 0, bottom: 0, left: 0 };

  const layers = scene.layers.map((l): Layer => {
    const rule = scene.responsive.rules.find((r) => r.layerId === l.id);
    const ov = overrides[l.id];
    let out: any = l;
    if (l.type === 'text') {
      let size = l.props.size;
      if (rule?.scaleWith === 'width') size = size * (scene.canvas.width / designMin) * (min / width);
      if (rule?.scaleWith === 'height') size = size * (scene.canvas.height / designMin) * (min / height);
      let y = l.transform.y;
      if (rule?.safeArea) {
        const lines = Math.max(1, l.props.text.split('\n').length);
        const half = (lines * size * l.props.lineHeight * min) / height / 2;
        const lo = safe.top + half, hi = 1 - safe.bottom - half;
        y = lo <= hi ? Math.min(Math.max(y, lo), hi) : 0.5;
      }
      out = { ...l, transform: { ...l.transform, y }, props: { ...l.props, size } };
    }
    if (l.type === 'image' && l.props.fit === 'cover') {
      // keep the focal point inside the visible crop
      out = { ...l, props: { ...l.props } };
    }
    if (ov) {
      out = {
        ...out,
        visible: ov.visible ?? out.visible,
        transform: { ...out.transform, x: ov.x ?? out.transform.x, y: ov.y ?? out.transform.y, scale: ov.scale ?? out.transform.scale },
        props: out.type === 'text' ? { ...out.props, size: ov.size ?? out.props.size, maxWidth: ov.maxWidth ?? out.props.maxWidth } : out.props,
      };
    }
    return out;
  });

  // Perspective content: keep horizontal extent when the destination is narrower.
  const camera = { ...scene.canvas.camera };
  if (aspect < designAspect) camera.distance = Math.min(camera.distance * Math.min(2.2, designAspect / aspect), 100);

  return { ...scene, canvas: { ...scene.canvas, width, height, camera }, layers };
}
