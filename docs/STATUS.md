# Status

The product is an interactive motion editor with a community gallery. Campaigns, brand kit, analytics,
templates/approvals and the old playground were removed (their history is in git).

## Built and verified

| Area | How it was verified |
|---|---|
| Editor — Design | Browser: added a star, dragged it (position matched pointer distance), resized from a corner; inspector values updated; autosaved and survived reload |
| Editor — Animate | Browser: one-click Spin created its own move “Star · Spin”; timeline rows and keyframes shown; scrubbing and playback |
| Editor — Interact | Browser: hover recipe produced two sentence rules; changing an action to “stop” took effect |
| Editor — Try it | Browser + e2e: hovering, pressing and releasing the Living button ran Hover → Press → Release → Unhover; the controls panel shows straight away |
| Pointer following | Unit tests: following sliders ease toward the pointer and stay silent; drag sliders follow only while held (Wandering creature, Slot bird, Blooming flower and Morning coffee all use following) |
| Community | Browser + API tests: publish with image copied into community storage, open as another user, play with it, like, remix into another workspace (image copied there), unpublish (remixes survive), presets can’t be unpublished, republishing updates the same post |
| Export | e2e: “Sunset” move exported as MP4 at 1080×1080, 1.6 s, decoded in the browser; API tests for single-move timelines and full motion-file export |
| Rendering | Visual-regression baselines for five effect presets and two shape presets |

| Library | 12 components built only from editor shapes, groups, moves and rules (see below); each reviewed frame by frame from contact sheets rendered by the app's own renderer + runtime; unit tests round-trip every one and check the button's states |
| Sound | Unit: sound actions reach the player as events, stay silent while settling; API: audio upload, copied on publish and remix |
| Drag | Unit: a drag slider ignores the pointer until its layer is held, then springs home with an overshoot |
| Squash & stretch | Unit: group stretch spreads children; circles turned inside a squashed group stay correct |

Automated: `npm test` 62/62, `npm run e2e` 10/10, `tsc --noEmit` clean.

## The library

| Component | Category | Shows off |
|---|---|---|
| Living button | Interactive UI | Hover lift, press squash into the base, release overshoot; two-toggle state machine; Customise colours/label |
| Wandering creature | Characters | Segmented body, breathing wave, eye tracking, head-first wiggle with staggered follow-through |
| Slot bird | Characters | Anticipation, reels with step cuts stopping in turn, eye watching each reel, counter-driven results, jackpot jump |
| Mochi | Characters | Drag to stretch (drag sliders + spring bounce), resisting lean, sprout whip settling last |
| Blooming flower | Illustrations | Editorial flat style, sway with lagging head, turns to pointer, staggered bloom/close toggle |
| Morning coffee | Illustrations | Out-of-step steam loop that drifts with the pointer, stir with follow-through |
| Day & night switch | Interactive UI | One move played both ways, knob stretch, rays fold, stars stagger in |
| Task checkbox | Interactive UI | Tick drawn stroke by stroke, strike-through, confetti |
| Bouncy headline | Typography | Per-letter hover pops, idle wave and squash-and-stretch jump wave |
| Like burst | Celebrations | Anticipation, pop, ring + sparks, rolling counter |
| Reward badge | Celebrations | Coin-flip in 2D, confetti with gravity, rays flare |
| Inchworm loader | Loaders | Slider-driven progress, inching loop, done state at 100 |

Each move carries a note explaining the motion principle it uses (shown in Animate).

## How it works

- Scene format v3 (`shared/scene/schema.ts`) adds vector **shape** layers (SDF-rendered: rectangle, ellipse,
  polygon, star; solid/linear/radial fills; outline) and a **machine**: controls (toggle, button, slider — a
  slider can follow the pointer with adjustable lag), moves (keyframe timelines that play once, loop or go back
  and forth), rules (when → only if → do) and slider links (set or shift a property). v2 files migrate on read.
- `shared/motion/runtime.ts` runs a file deterministically: holds control values, plays moves (newest wins per
  property, with a short cross-blend), fires edge-triggered rules, applies slider links, and settles resting
  states instantly at start. The editor preview, Try it, community posts and tests all use it.
- Validation rejects rules that point at missing layers, controls or moves; deleting any of those prunes the
  rules that referenced them.

## Not built / limitations

- **AI “describe it and it builds”** — planned for phase 2; not started.
- **Embedding** interactive files on websites (a runtime script with a control API) is not built; exports are
  video, stills or the motion file.
- **Video export of interactions** renders one move at a time, not a recorded interactive session.
- The editor needs a window about 1000 px wide or more; it isn’t laid out for phones.
- No grouping/ungrouping in the editor UI (groups from the library and imports are kept and shown), and a
  group's pivot is its position — there's no separate pivot handle.
- No vector paths: no pen tool, arcs, boolean shapes or masks. Leaves are ellipses, smiles can't be drawn, and the
  ribbon notches on the badge are background-coloured triangles painted over the ribbon.
- Layers can't be skewed: a layer turned inside a stretched group gets the nearest rotation + stretch.
- Customise settings can change colours, text and numbers, not motion amounts (e.g. "press depth" or "spring
  speed" would need move-level intensity/speed controls).
- Text content can't be changed by moves, so counters swap between two text layers.
- Sounds aren't included in video exports; Fontshare fonts need an internet connection (see FONTS.md).
- Imported SVG/AI/PSD parts become images.
- Text content can’t be changed by rules or sliders.
- Figma import is tested for token rejection and link parsing only; a live import needs a token.
- Community has no comments, reporting or moderation tools yet; anyone signed in on the server can see posts.
- Rate limiting is in-memory (single instance).
