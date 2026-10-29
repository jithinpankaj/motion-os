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

| Plain-language interactions | e2e: the New interaction helper builds “when someone clicks anywhere → play Jump, then back next time” (with the switch it remembers by), a word is changed by clicking it (clicks → presses the Enter key), Only if… starts with a condition, More options sets “ignore it”, it survives reload and Enter runs it in Try it with the debugger saying so. Editor e2e: a hover interaction plus its automatic undo, a sound step added to an open card, the Living button’s Rest/Hover/Pressed states in the debugger |
| Runtime: states, priority, interruption, steps | Unit (logic.test.ts): from-state gating, one state change per event by priority, the coin/spin sequence (waits, parallel, branch, emitted events), key payload conditions, delay / ignore / queue, replace / additive blending, loop override, priority blocking, variable limits, expression parsing and its error messages, summaries; the Slot bird’s coin sequence end to end, including “Coins is 0. It needs to be at least 1.” |

| Ask Claude | Unit: a three-operation reply (new Coins number, new Bounce move, click interaction “only if Coins >= 1”) applies and then really works in the runtime; unknown layers, bad conditions and missing interactions are skipped with plain reasons while the rest applies; positions convert through groups; the reply schema rejects anything else. API: the request carries the current file and the ask, needs edit permission, refusals return no changes, and without a credential the route answers 503 “not connected”. **Not verified against the live API here** — this machine has no `ANTHROPIC_API_KEY` |
| Onboarding | e2e: Home’s “New here?” banner → Learn → “Open a starter and take the tour” → seven spotlight steps → doesn’t return on reload → replays from ?; Ask Claude opens with ideas using the file’s names and says plainly when it isn’t connected |

Automated: `npm test` 80/80, `npm run e2e` 12/12, `tsc --noEmit` clean, build succeeds.

## Interactions

Interactions are plain sentences in the Interact panel — “**When** someone **hovers over** **Button** → play
**Hover**”. Every underlined word opens a small chooser to change it. **New interaction** asks three questions
with picture tiles (what do people do · on what · what should happen), shows a sentence preview, and can add the
natural undo for you (“undo it when the pointer moves off / when they let go”) or make a click flip a move on and
off. An open card lists its steps in order (with “at the same time” and “if … otherwise …” blocks), an optional
**Only if…** and a folded **More options** (smoothness, wait first, what happens if it fires again while running,
which state it works in, name, on/off) with **Expert settings** inside (easing curve, priority, mixing, the
state’s move, steps before switching). States are optional named poses listed in the panel.

**Try it** shows a debugger in sentences — “✓ Released ran.” / “✗ Spin didn’t run — Coins is 0. It needs to be at
least 1.” — with the detailed checks behind “Show the checks”, the steps running now, and every switch and value,
which can be changed while testing.

The engine underneath is unchanged: states, nested conditions, transitions, priorities, interruption and ordered,
parallel and branching steps all still run, and files that use them keep them — richer logic is summarised on the
card (“Advanced logic · …”) and stays editable. There is no node graph or state-diagram view (removed on request).

## Ask Claude and onboarding

**Ask Claude** (editor top bar) sends the current file and the conversation to the server, which calls
`claude-opus-5-5` with structured output: a short reply plus operations from a fixed list (add / change / delete
an interaction, add a move from a preset, set a layer property, add a switch or value, add a state). Conditions
come back in the same safe expression language as the editor’s. The browser applies the operations one by one,
checking every name, then validates the whole file; the result is one undoable step, listed in plain words, and
anything that didn’t fit is reported instead of half-applied. The server enables the API’s refusal fallback.
The key stays on the server (`.env`); requests are rate-limited (12/min per person) and need edit permission.

**Learn** explains the four steps, walks through a first interactive button, shows example requests for Claude
and defines the editor’s words. The **tour** spotlights the mode bar, layers, canvas, settings, Ask Claude and
sharing; it shows once and replays from the **?** button.

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

- **Ask Claude** can’t draw new artwork (it works with the layers you have), edit individual keyframes, or set up
  slider links yet; it needs an Anthropic API key on the server.
- **Embedding** interactive files on websites (a runtime script with a control API) is not built; exports are
  video, stills or the motion file.
- **Video export of interactions** renders one move at a time, not a recorded interactive session.
- The editor needs a window about 1000 px wide or more; it isn’t laid out for phones.
- No grouping/ungrouping in the editor UI (groups from the library and imports are kept and shown), and a
  group's pivot is its position — there's no separate pivot handle.
- No vector paths: no pen tool, arcs, boolean shapes or masks. Leaves are ellipses, smiles can't be drawn, and the
  ribbon notches on the badge are background-coloured triangles painted over the ribbon.
- Layers can't be skewed: a layer turned inside a stretched group gets the nearest rotation + stretch.
- Variable scope is per file: there are no multi-file projects or nested components yet, so “project” scope
  and “trigger another component” aren’t available. Emitted events do reach the page hosting the player.
- Pointer “up” only reaches a layer that was pressed; there is no key-release trigger.
- Customise settings can change colours, text and numbers, not motion amounts (e.g. "press depth" or "spring
  speed" would need move-level intensity/speed controls).
- Text content can't be changed by moves, so counters swap between two text layers.
- Sounds aren't included in video exports; Fontshare fonts need an internet connection (see FONTS.md).
- Imported SVG/AI/PSD parts become images.
- Text content can’t be changed by rules or sliders.
- Figma import is tested for token rejection and link parsing only; a live import needs a token.
- Community has no comments, reporting or moderation tools yet; anyone signed in on the server can see posts.
- Rate limiting is in-memory (single instance).
