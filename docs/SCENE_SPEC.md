# Motion Scene format (schema v2)

Source of truth: `shared/scene/schema.ts` (Zod). Entry points: `deserializeScene()` (parse untrusted JSON →
migrate → validate → typed document) and `serializeScene()` (validate → canonical, key-sorted JSON).

## Units and conventions
- Positions (`transform.x/y`, emitters, attractors, focal point): fractions of the canvas, origin top-left.
- Text size, image width/height: fractions of `min(canvas.width, canvas.height)`. This is what lets a scene
  re-layout for any channel without stretching.
- Rotation in degrees. Colours `#rrggbb`. Times in seconds.
- Draw order = array order of `layers` (later draws on top). Groups use `parentId`; group transforms,
  opacity and visibility compose onto 2D children.

## Top level
| Field | Meaning |
|---|---|
| `id`, `schemaVersion`, `seed` | identity, schema version (2), seed for all randomness |
| `meta` | name, description, tags, category |
| `canvas` | width, height, fps, duration, loop, background, camera {fov, distance, yaw, pitch} |
| `layers[]` | `group` · `gradient` · `mesh` · `particles` · `text` · `image` (see below) |
| `tracks[]` | `{ layerId, path, keyframes[{t, value, easing}] }` — `path` is a dot path inside the layer (`opacity`, `transform.x`, `props.noiseAmp`, `props.stops.1.color`, …); numbers interpolate linearly, colours in OKLab; easing names or cubic-bezier tuples |
| `tokens.bindings[]` | `{ layerId, path, token }` brand token bindings |
| `exposed[]` | parameters other teams may change: `key, label, description, type, targets[{layerId,path}], default, min, max, step, maxLength, options[], required, locked, lockReason, roles[], tokenBinding, group` |
| `responsive` | `focalPoint`, `rules[{layerId, safeArea, scaleWith}]`, `overrides[formatId][layerId]{x,y,scale,size,maxWidth,visible}` |
| `interactions[]` | pointer effects (interactive embeds/previews only) |
| `fallback` | `staticFrame` and `reducedMotion: static | reduced` |
| `export` | `posterTime` |

## Layer props (abridged)
- **gradient**: `mode` (linear, radial, mesh, aurora, noise, organic), `stops[2..6]`, `interpolation`, `angle`, `scale`, `center`, `noiseFreq`, `noiseAmp`, `distortion`, `speed` (whole cycles per loop when looping), `flowAngle`, `grain`, `customShader` (validated GLSL function body or null).
- **mesh**: `geometry {kind, detail}`, `position`, `rotation`, `scale`, `spin` (turns per loop), `material {color, color2, roughness, fresnel, iridescence, wireframe, textureAssetId, textureMix}`, `displacement {amount, frequency, speed}`, `light {intensity, ambient, color, azimuth, elevation}`.
- **particles**: `count`, `size`, `shape`, `colorA/B`, `lifetime`, `velocity`, `direction`, `spread`, `gravity`, `noise`, `emitter`, `emitterSize`, `attractors[{x,y,strength}]` (negative = repulsor), `pointer`, `pointerStrength`. Motion is a closed-form function of (seed, t).
- **text**: `text`, `fontFamily`, `fontAssetId`, `weight`, `size`, `tracking`, `lineHeight`, `align`, `color`, `maxWidth`, `maxChars`, `animation {preset: none|fade|stagger|word|slide|scale|mask|scramble, start, duration, stagger, easing, exit}`.
- **image**: `assetId`, `fit`, `crop`, `width`, `height`, `mask`, `radius`, `displacement`, `displacementSpeed`, `reveal {preset: none|fade|wipe|scale|iris, start, duration, easing}`.

## Validation beyond the schema
Unique layer ids; parents must be groups; no group cycles; tracks and parameters must target existing
layers; unique parameter keys; finite numbers within declared ranges; documents > 5 MB rejected;
documents newer than the supported schema version rejected.

## Migrations
`MIGRATIONS` in `shared/scene/serialize.ts`. v1 → v2 renames `canvas.bg`, converts `hidden` to `visible`,
and fills responsive / fallback / export / interactions / tokens sections.
