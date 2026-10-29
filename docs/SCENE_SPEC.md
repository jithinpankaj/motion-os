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


## v3: shapes and interactions

v3 adds a `shape` layer (`props.kind`: rect | ellipse | polygon | star; `width`/`height` in canvas pixels;
`radius`, `sides`, `innerRadius`; `fill` { type: solid | linear | radial | none, color, color2, angle };
`stroke` { color, width }) and a top-level `machine`:

- `inputs` — `{ id, name, type: boolean | trigger | number, default, min?, max?, follow?: pointerX | pointerY, smoothing? }`
- `animations` (“moves”) — `{ id, name, duration, loop: once | loop | pingpong, tracks }`; tracks use the same
  keyframe format as scene-level tracks, with times relative to the move.
- `rules` — `{ id, when, only: Condition[], do: Action[] }`. `when`: start | trigger | boolean (turns on/off) |
  number (crosses a threshold with > < = >= <=) | pointer (click, enter, leave, down, up on a layer) | finished
  (a move ends). Actions: play (forward/reverse, from start/current) | stop | setBoolean (on/off/toggle) | fire |
  setNumber (set/add).
- `bindings` (“slider links”) — `{ id, inputId, layerId, path, from: [a, b], to: [c, d], relative? }`.

Every reference must resolve (validation rejects dangling ids). Migration v2→v3 adds an empty machine.

### Additions within v3 (backward compatible)

- `transform.scaleX` / `transform.scaleY` (default 1) — squash and stretch in the layer's own axes. A group
  passes its stretch to its children: positions spread along the group's axes, and each child's final shape is
  the nearest rotation + stretch (exact for circles and for children that aren't turned inside the group;
  otherwise the child keeps its own x-axis and only the skew is dropped, because layers can't be skewed).
- `animations[].note` — a plain-language note about why the move is built the way it is (shown above its timeline).
- `inputs[].dragLayer` — a pointer-following slider that only follows while that layer is held, and returns to
  its default when let go. `inputs[].bounce` (0–0.95) makes following and returning springy (a damped spring
  that overshoots); without it, following eases exponentially.
- Action `{ type: 'sound', sound: <built-in> | null, assetId: <uploaded audio> | null, volume }` — exactly one
  of `sound` / `assetId`. Built-in sounds: click, tap, pop, blip, bubble, boing, squish, whoosh, sparkle, chime,
  success, bonk, tick, spin (synthesised in the browser). Sounds are skipped while settling the starting state
  and before the viewer has interacted with the page (browser autoplay rules). Video exports are silent.
- `exposed[]` parameters of type color / text / number appear as **Customise** settings; each writes to all of
  its targets.

### Interaction model: states, conditions, transitions, steps (additive, backward compatible)

One model serves the simple view, Advanced Controls and the Logic Canvas.

- `machine.states[]` — `{ id, name, animationId | null, x, y }` (x/y are kept for layout tools; the editor
  doesn’t show a state diagram) and `machine.initialState`. Entering a state plays its move. Files without states work as before.
- Rules double as **connections**: `from` (a state; missing = any state) and `to` (a state; missing = no state
  change). Only one connection changes the state per event — the highest priority, then the earliest.
- `rule.only` items may be nested groups `{ type: 'group', op: 'all' | 'any' | 'none', items }`; `rule.match`
  sets how the top level combines (default all). Conditions: boolean, number (`> < = >= <= !=`), text
  (`is / isNot / contains / startsWith`), range, compare (two variables), vector (`x`/`y`), state, playing (a
  move), event (the triggering event's `key / name / value / x / y`).
- Triggers add `key` (or `any`), `event` (a named event), `stateEnter` and `changed` (any variable). Pointer
  triggers without a `layerId` fire for the canvas as a whole.
- `rule.transition` — `duration` (blend seconds), `delay`, `easing` (named or a cubic Bézier tuple),
  `playback` (restart / continue / reverse), `loop` (default / once / loop / pingpong), `interruption` (allow /
  wait / queue / ignore), `priority` (low / normal / high / critical), `blend` (crossfade / replace / additive),
  `playStateMove`. `machine.defaults` is what new connections start with (copied onto each, never applied
  silently). A lower-priority connection can’t interrupt a running higher-priority transition; critical always can.
- `rule.do` (On enter) and `rule.exit` (On exit, before the state changes) are ordered steps. New steps: pause,
  setVar, setState, visibility (show / hide / toggle), emit (a named event, also delivered to the host page),
  wait (seconds), waitFor (a move to finish), parallel (`actions`, continues when all finish) and branch (`if`
  group, `then`, `else`). Steps run in order until a wait; the runtime resumes them as time passes.
- Variables add `string` (`maxLength`), `enum` (`options`), `vector2` (`min`/`max` per axis) and `color`; the
  runtime keeps every value within its limits and validation rejects starting values of the wrong kind.
- Conditions can also be written as text (`Coins >= 1 and not IsSpinning and (Mode is "hard" or event.key =
  "Enter")`). The text is parsed into the same groups — nothing is ever executed as code.
