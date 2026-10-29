# Motion OS

An interactive motion design tool that's easy to learn: draw something, give it moves, and make it react to
clicks, hovers, toggles, buttons, sliders — or the pointer itself. Start from scratch or remix a preset from
the Community.

## What's in it

- **Editor** with four tabs:
  - **Design** — rectangles, circles, polygons, stars, text, images, gradient and particle effects. Click to
    select, drag to move, corners resize, the top dot rotates. Import a design (PNG, JPG, SVG, PDF, Illustrator,
    Photoshop or a Figma frame) and its parts become separate layers.
  - **Animate** — *moves* are short animations ("Turn on", "Bounce"). Pick a one-click move (Pop, Spin, Bounce,
    Pulse, Wiggle, Shake, Float, Grow, Squash, Change colour…) or change things on the canvas and each change
    becomes a keyframe at the playhead. Timeline with draggable keyframes and easing in plain words.
  - **Interact** — *controls* (toggle, button, slider — a slider can follow the pointer) and *rules* written as
    sentences: **When** someone clicks *Star* → **then** play *Spin*, with optional **only if** conditions.
    **Slider links** let a slider set or shift a property (e.g. the pointer moves a character's eyes). One-click
    recipes: click to toggle, hover effect, press to play.
  - **Try it** — the live result with switches, buttons and sliders and a "what just happened" log.
- **Community** — a gallery shared by everyone on this server. Twelve presets (Curious buddy, toggle switch,
  favourite button, press button, progress loader, traffic light, checklist, day & night, hover card,
  notification bell, bouncing ball, aurora mood). Open any post to play with it, like it, and remix your own copy.
- **Export** — one move as MP4 or PNG (rendered frame-exact in a background worker), or the whole file as a
  motion file (`.json`).

## Run it

Requires Node 22+ and a Chromium-based browser (WebGL 2; WebCodecs for MP4).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The first start creates `.data/` (PostgreSQL via PGlite + object storage), the
community presets, and a demo workspace, **Lumen Studio**, with a few starter files. In development you're
signed in automatically as **alex@motion.os**; sign out (or open `/login`) to pick another demo account.

| Email | Role |
|---|---|
| alex@motion.os | Owner — everything, including roles and the audit log |
| dana@motion.os, mia@motion.os, omar@motion.os | Makers — create, animate, publish, remix |
| eli@motion.os | Engineer — open, try and export |
| vic@motion.os | Viewer — read only |

Demo password: `motion-os-demo` (development seed only). Set `DATABASE_URL` to use a real PostgreSQL server;
delete `.data/` to reset.

## Tests

```bash
npm test
```

55 unit/integration tests: the interaction runtime (toggles, buttons, number thresholds, pointer events,
pointer following, slider links, resting state, chaining), one-click moves, every preset, scene validation and
migration, timeline evaluation, permissions, compatibility, outbound-request safety, plus an in-process API
suite (permissions, workspace isolation, exports of single moves, files, concurrency conflicts, upload
validation, signed URLs, byte ranges, community publishing, image copying, remixing across workspaces,
likes and unpublishing).

```bash
npm run e2e
```

11 Playwright tests in your installed Chrome: navigation per role; the editor end to end (try a toggle on the
canvas, add a shape, one-click move, hover recipe, autosave and reload); trying and remixing the Curious buddy
in the Community; exporting a move as MP4 and checking the file; and visual regression for seven presets.

## Layout

```
shared/   scene schema (shapes + interaction model), migrations, timeline, interaction runtime, moves, presets
server/   Express API, PostgreSQL schema, auth, permissions, storage, community, Figma import, seed
src/engine/   WebGL renderer (shapes, text, images, gradients, particles), export worker
src/features/ home, editor, community, settings
docs/     STATUS.md (what's built and what isn't), SCENE_SPEC.md, API.md
```
