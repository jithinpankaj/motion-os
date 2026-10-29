# Motion OS

A unified motion design system, creative studio and distribution platform.
**Create once. Adapt everywhere. Stay on brand.**

- **Create** — Motion Studio: real-time WebGL 2 editor (gradients, meshes, GPU particles, typography, images), scene hierarchy, contextual inspector, keyframe timeline, undo/redo, versioning, publish & approval.
- **Adapt** — Team Playground and Campaign Composer: brand-governed parameters, live channel previews (8 destinations), master → variation inheritance with local overrides.
- **Deliver** — deterministic PNG / WebP / MP4 exports in a background worker, native scene JSON, version-pinned WebGL embed configs, integrations with confirmation-only publishing.

## Run it

Requires Node 22+ and a Chromium-based browser (WebGL 2 + WebCodecs for MP4).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The first start creates `.data/` (PostgreSQL via PGlite + object storage) and seeds a demo workspace, **Lumen Studio**, with six published templates, four images and one draft project.

Local demo accounts (development seed only; password `motion-os-demo`):

| Email | Role | Try |
|---|---|---|
| alex@motion.os | Owner | approvals, roles & permissions, audit log |
| dana@motion.os | Designer | Motion Studio, parameters, publishing |
| mia@motion.os | Marketing | Explore → Playground → export, campaigns |
| eli@motion.os | Engineer | Playground → Developer tab → embed example |
| omar@motion.os | Operations | templates and exports |
| vic@motion.os | Viewer | read-only library |

To use a real PostgreSQL server instead of PGlite set `DATABASE_URL`. To reset, stop the server and delete `.data/`.

## Tests

```bash
npm test
```

43 unit/integration tests: scene serialization & migration, timeline evaluation, parameter validation, campaign inheritance, permissions & status machine, compatibility/flash detection, plus an in-process API suite (permissions, workspace isolation, governed exports, template lifecycle, concurrency conflicts, upload validation, signed URLs, byte ranges).

```bash
npm run e2e
```

8 Playwright tests in your installed Chrome: permission-adaptive navigation, Journey B end-to-end (customise → export MP4 → decode the file and verify size, duration and that the headline is in the frame), Studio playback-through-edits + autosave + reload, and visual regression for all five launch presets.

## Layout

```
shared/   scene schema, migrations, timeline, params, inheritance, adaptation, compatibility, permissions (client + server)
server/   Express API, PostgreSQL schema, auth, permissions, storage, integrations, seed
src/engine/   Clock, GPUContext, SceneRenderer, layer views, shaders, RenderHub (thumbnail scheduler), export worker
src/features/ home, explore, studio, playground, campaigns, brand, assets, integrations, settings, embed
src/embed/    framework-agnostic embed runtime (mountMotion)
docs/     ARCHITECTURE.md (design deliverables), STATUS.md (what's built / limitations), SCENE_SPEC.md, API.md
```
