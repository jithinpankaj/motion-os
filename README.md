# Motion OS

A unified motion design system, creative studio and distribution platform.
**Create once. Adapt everywhere. Stay on brand.**

Five places, no jargon:

- **Create** — upload a finished design (PNG, JPG, WebP, layered SVG, PDF, Illustrator `.ai`, Photoshop `.psd`, or a Figma frame link). Layered files are split into parts so each part moves on its own. Pick a motion style, adjust the message, format and length, save, download MP4/PNG. Pick several channels to make a **campaign**: every size saved together under the current brand, exported in one go (zip with manifest) and tracked as a group in Analytics.
- **Brand kit** — import colours, fonts, logo and tone from your website, a logo/image, a guidelines PDF or pasted codes; review before saving. Tone sets a *motion personality* (calm, balanced, energetic, playful) that every new motion uses. Create reusable elements (shapes in brand colours) or upload your own.
- **Library** — your team's motions and the approved brand templates.
- **Analytics** — connect Google Analytics 4, Meta (Instagram/Facebook) or a LinkedIn Page, link each motion to its post or tagged link, and see reach, engagement, clicks and sessions in one dashboard.
- **Advanced** (rail menu) — the full Motion Studio editor (layers, timeline, shaders), campaigns with channel variations, the asset library, publishing integrations and raw brand tokens.

## Run it

Requires Node 22+ and a Chromium-based browser (WebGL 2 + WebCodecs for MP4).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The first start creates `.data/` (PostgreSQL via PGlite + object storage) and seeds a demo workspace, **Lumen Studio**, with six published templates, four images and one draft project.

In development you're signed in automatically as **alex@motion.os** (Owner) — no login screen. To act as another role, sign out (or open `/login`) and pick an account under *Local development · continue as*. Set `DEV_LOGIN_EMAIL` to change the default account, or `DEV_AUTO_LOGIN=0` to always require a password. Passwordless sign-in is disabled in production and only answers requests from the local machine.

Local demo accounts (development seed only; password `motion-os-demo`):

| Email | Role | Try |
|---|---|---|
| alex@motion.os | Owner | approvals, roles & permissions, audit log |
| dana@motion.os | Designer | Motion Studio, parameters, publishing |
| mia@motion.os | Marketing (brand team) | Create, Brand kit import, Analytics, campaigns |
| eli@motion.os | Engineer | Playground → Developer tab → embed example |
| omar@motion.os | Operations | templates and exports |
| vic@motion.os | Viewer | read-only library |

To use a real PostgreSQL server instead of PGlite set `DATABASE_URL`. To reset, stop the server and delete `.data/`.

## Tests

```bash
npm test
```

68 unit/integration tests: scene serialization & migration, timeline evaluation, parameter validation, campaign inheritance, permissions & status machine, compatibility/flash detection, brand-import parsing (colours, fonts, roles, tone), every motion style producing a valid scene, outbound-request safety, plus in-process API suites (permissions, workspace isolation, governed exports, template lifecycle, concurrency conflicts, upload validation, signed URLs, byte ranges, website import and GA4/Meta/LinkedIn connectors against a fake network, Create recipes, simple campaigns).

```bash
npm run e2e
```

10 Playwright tests in your installed Chrome: the five-place navigation per role, the Create flow (layered SVG → style → save → Library), a three-size campaign, Journey B end-to-end (customise → export MP4 → decode the file and verify size, duration and that the headline is in the frame), Studio playback-through-edits + autosave + reload, and visual regression for all five launch presets.

## Layout

```
shared/   scene schema, migrations, timeline, params, inheritance, adaptation, compatibility, permissions (client + server)
server/   Express API, PostgreSQL schema, auth, permissions, storage, integrations, seed
src/engine/   Clock, GPUContext, SceneRenderer, layer views, shaders, RenderHub (thumbnail scheduler), export worker
src/features/ home, explore, studio, playground, campaigns, brand, assets, integrations, settings, embed
src/embed/    framework-agnostic embed runtime (mountMotion)
docs/     ARCHITECTURE.md (design deliverables), STATUS.md (what's built / limitations), SCENE_SPEC.md, API.md
```
