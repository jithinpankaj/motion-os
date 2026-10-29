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
  - **Interact** — interactions read like sentences: **When** someone *hovers over* *Button* → *play Hover*. Click
    any underlined word to change it, or use **New interaction**, which asks three plain questions with picture
    tiles. Open a card for its steps (in order, at the same time, if/otherwise), an optional **Only if…**, and
    **More options** for timing and what happens if it fires again. Switches & values (on/off switches, buttons,
    numbers — which can follow the pointer or a drag — plus text, choices, vectors and colours), optional states,
    and **slider links** that tie a number to a property.
  - **Try it** — the live result and a debugger in sentences (“✓ Released ran.”, “✗ Spin didn’t run — Coins is
    0…”); switches and values can be changed while testing.
- **Ask Claude** — a chat in the editor: describe what you want (“when someone clicks the star, make it bounce —
  only if Coins is above 0”) and Claude adds the moves, interactions, conditions, switches and values. It
  answers with a fixed set of operations that the app checks against your file before applying them as one
  undoable step, and it says plainly what it changed and what it couldn’t do. Needs `ANTHROPIC_API_KEY`
  (see Run it).
- **Learn** — a page for first-timers (the four steps, a five-minute walkthrough, the words the editor uses) and a
  one-minute spotlight tour of the editor that shows on the first visit and replays from the **?** button.
- **Library & Community** — a gallery shared by everyone on this server, filterable by category (Characters,
  Interactive UI, Illustrations, Typography, Celebrations, Loaders). The Motion OS library has twelve components
  (Living button, Wandering creature, Slot bird, Mochi, Blooming flower, Morning coffee, Day & night switch, Task
  checkbox, Bouncy headline, Like burst, Reward badge, Inchworm loader), each built only from editor shapes and
  moves, with a note on every move explaining the motion principle. Open any post to play with it, like it, and
  remix your own copy; **Add to Community** in the editor publishes your file under a category.
- **Sound** — rules can play a sound: 14 built-in sounds (synthesised, nothing to download) or your own MP3/WAV/OGG.
  Players have a sound on/off switch.
- **Customise** — library files expose friendly settings (colours, labels) that change every part that uses them.
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

To turn on **Ask Claude**, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` (the server reads `.env` on
start; the key never reaches the browser). Without it everything else works and the chat says it isn't connected.

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

80 unit/integration tests: the interaction runtime (toggles, buttons, number thresholds, pointer events,
pointer following, slider links, resting state, chaining), one-click moves, every preset, scene validation and
migration, timeline evaluation, permissions, compatibility, outbound-request safety, plus an in-process API
suite (permissions, workspace isolation, exports of single moves, files, concurrency conflicts, upload
validation, signed URLs, byte ranges, community publishing, image copying, remixing across workspaces,
likes and unpublishing).

```bash
npm run e2e
```

12 Playwright tests in your installed Chrome: navigation per role; the editor end to end (hover and press the
Living button in Try it, add a shape, one-click move, hover recipe, a sound action, the Add to Community dialog,
autosave and reload); filtering the Community by category, trying and remixing the Living button; exporting a
move as MP4 and checking the file; and visual regression for six files.

## Layout

```
shared/   scene schema (shapes + interaction model), migrations, timeline, interaction runtime, moves, presets
server/   Express API, PostgreSQL schema, auth, permissions, storage, community, Figma import, seed
src/engine/   WebGL renderer (shapes, text, images, gradients, particles), export worker
src/features/ home, editor, community, settings
shared/motion/library/   the component library (one file per component, plus a small rig helper)
docs/     STATUS.md (what's built and what isn't), SCENE_SPEC.md, API.md, FONTS.md (font sources and licences)
```
