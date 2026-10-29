# MOTION OS — Architecture & Implementation Plan

> Create once. Adapt everywhere. Stay on brand.

This document is the pre-implementation deliverable (Part 23). It is kept in sync with the code;
`docs/STATUS.md` records what is actually built per milestone and what is not.

---

## 1. Product architecture

```
┌──────────────────────────── Browser ─────────────────────────────┐
│  React app (routes, panels, design system)                       │
│     │ zustand stores (session, studio doc, playground values)    │
│     ▼                                                            │
│  shared/  ← the same TypeScript runs on client AND server        │
│     scene schema · migrations · timeline · params · inheritance  │
│     formats/adaptation · compatibility · permissions             │
│     ▼                                                            │
│  engine/  (DOM-free; runs on main thread or in a Worker)         │
│     Clock ─► SceneRenderer ─► LayerViews (gradient/mesh/…)       │
│     GPUContext (one WebGL2 context, shared by many previews)     │
│     PreviewHub (thumbnail scheduler) · export worker (WebCodecs) │
└───────────────┬──────────────────────────────────────────────────┘
                │ JSON over HTTPS, cookie session, X-Workspace header
┌───────────────▼──────────── Node server ─────────────────────────┐
│  Express 5 · auth (scrypt, hashed session tokens) · rate limits  │
│  permission middleware (workspace-scoped, role→permission table) │
│  routes: auth, workspaces, brand, projects/scenes/versions,      │
│          templates/approvals, library, playground, campaigns,    │
│          assets, exports, integrations, audit, assistant         │
│  shared/ validation (scene schema, params, inheritance)          │
├──────────────────────────────────────────────────────────────────┤
│  PostgreSQL (PGlite embedded in dev; `DATABASE_URL` → node-pg)   │
│  Object storage (local disk adapter, HMAC-signed URLs; S3 later) │
└──────────────────────────────────────────────────────────────────┘
```

Three connected experiences map onto three surfaces:

| Experience | Surface | Who | Engine usage |
|---|---|---|---|
| **Create** | Motion Studio | Designer | full scene graph, timeline, expert shader panel |
| **Adapt** | Playground, Campaign Composer | Marketing, Ops, Eng | exposed parameters only, applied through `applyParameters` |
| **Deliver** | Export queue, Integrations, Developer delivery | Everyone with `export.create` | deterministic frame renderer in a Worker |

Key principles

* **The scene document is the product.** It is plain JSON, versioned, validated by one Zod schema
  shared by client and server, and never derived from React state.
* **Time is an input, not state.** `evaluate(doc, t)` is pure. The clock only produces `t`.
  Editing never touches the clock, so playback is continuous by construction.
* **Governance is enforced on the server.** Consumers never send scene JSON; they send parameter
  values. The server re-applies them to the pinned template version with the same validator.

## 2. Information architecture

```
Workspace ▸ Brand (switcher, always visible in the rail)
├─ Home            recent projects · approved motion · active campaigns · pending approvals · activity
├─ Explore         approved library, faceted filters (category, team, brand, channel, format,
│                  colour, interaction, export compatibility, approval status) → Playground
├─ Motion Studio   projects list → editor (/studio/:projectId)        [scene.edit]
├─ Campaigns       list → composer (/campaigns/:id)                   [campaign.view]
├─ Brand System    tokens: colour, type, motion, springs, intensity, particles, gradients, a11y
├─ Assets          library, upload, versions, usage, replacement
├─ Integrations    connectors, capability matrix, publication jobs
└─ Settings        profile · sessions · members & invitations · teams · roles & permissions · audit
Overlays: ⌘K command/assistant · export queue tray · notifications
Standalone: /play/:templateId (playground), /embed-example (developer local example)
```

Navigation items are filtered by permissions returned from `/api/session`.

## 3. Database schema

Full DDL: `server/schema.sql`. Groups (Part 13) with the important constraints:

* **Identity** — `users` (unique lower(email)), `sessions` (sha-256 of token, expiry, revocation),
  `password_resets`, `organisations`, `workspaces`, `workspace_memberships` (unique ws+user),
  `membership_roles` (many roles per membership), `teams`, `team_memberships`, `roles`
  (system or workspace-custom), `permissions`, `role_permissions`, `invitations`.
* **Brand** — `brands`, `brand_tokens` (unique brand+key), `token_versions` (immutable snapshots),
  `brand_assets`, `brand_rules`.
* **Motion** — `motion_projects`, `motion_scenes` (working draft + `revision` for optimistic
  concurrency), `scene_versions` (immutable, unique scene+version, `parent_version_id` for branches),
  `motion_families`, `motion_templates` (status machine), `template_versions` (immutable once
  published; pins `scene_version_id` + `asset_pins`), `template_parameters`, `animation_presets`,
  `shader_presets`.
* **Campaigns** — `campaigns` (pins `template_version_id`, holds `master_values`),
  `campaign_variations` (channel + `published_snapshot`), `channel_presets`, `content_overrides`
  (unique variation+param), `campaign_approvals`.
* **Assets** — `media_assets`, `asset_versions` (storage key, sha-256, dimensions),
  `asset_references` (usage tracking, `pinned` flag), `asset_collections`.
* **Delivery** — `export_jobs`, `exported_files`, `published_assets`, `integration_connections`,
  `publication_jobs`.
* **Governance** — `approval_requests`, `approval_decisions`, `audit_events`, `usage_events`.

Every tenant table carries `workspace_id` with an index; every query in `server/routes/*` filters on
the caller's workspace. Deletion policy: identity children `ON DELETE CASCADE`; content uses soft
delete (`deleted_at`) or `RESTRICT` where published history depends on it (scene_versions,
template_versions, asset_versions are never cascaded away from a published output).

## 4. Scene JSON specification

See `docs/SCENE_SPEC.md` (generated from `shared/scene/schema.ts`). Summary:

```jsonc
{
  "id": "scn_…", "schemaVersion": 2, "seed": 1337,
  "meta": { "name": "Aurora Flow", "description": "", "tags": [] },
  "canvas": { "width": 1080, "height": 1350, "fps": 30, "duration": 8, "loop": true,
              "background": "#05060a", "camera": { "fov": 35, "distance": 6, "yaw": 0, "pitch": 0 } },
  "layers": [ { "id", "name", "type": "gradient|mesh|particles|text|image|group",
                "parentId", "visible", "locked", "opacity", "blend", "transform", "props" } ],
  "tracks": [ { "id", "layerId", "path": "props.noiseAmp", "keyframes": [ { "id", "t", "value", "easing" } ] } ],
  "tokens":  { "bindings": [ { "layerId", "path", "token": "color.primary" } ] },
  "exposed": [ { "key", "label", "type", "targets": [ { "layerId", "path" } ], "default", "min", "max", … } ],
  "responsive": { "focalPoint": {x,y}, "rules": [...], "overrides": { "<formatId>": { "<layerId>": {…} } } },
  "interactions": [ { "type": "pointer", "layerId", "effect": "attract|repel|parallax", "strength" } ],
  "fallback": { "staticFrame": 2.5, "reducedMotion": "static|reduced" },
  "export": { "posterTime": 2.5 }
}
```

* Units: positions are fractions of the canvas (0..1, origin top-left); sizes are fractions of
  `min(width, height)`; this is what makes channel adaptation non-stretching.
* `serializeScene` / `deserializeScene` (validate + migrate) are the only entry points.
* Migrations are an ordered list `vN → vN+1`; documents are always upgraded on read.

## 5. Rendering engine design

```
Clock (performance.now → t, play/pause/seek/loop/speed/step)        t
        │                                                            │
SceneRenderer.render(t)                                              ▼
   evaluateTracks(doc, t)  → resolved layers (structural sharing, pure)
   for layer in drawOrder:  view = views[layer.id]
        if view.key !== structuralKey(layer) → rebuild view (dispose GPU resources), keep t
        view.sync(layer, t, ctx)  → writes uniforms only
        gl.render(view.scene, view.camera)   (autoClear off; ortho for 2D, perspective for mesh)
```

* **Layer views**: Gradient (fullscreen quad, one shader, `uMode` switch, 6 stops), Mesh
  (Three geometry + custom displacement/lighting shader), Particles (`THREE.Points`, all motion
  computed analytically in the vertex shader from `t` and per-particle seeds → deterministic),
  Text (glyph layout cached; per-glyph animation drawn into a 2D canvas texture, re-uploaded only
  while animating), Image (shader quad: crop/fit/mask/displacement/reveal).
* **Seamless loops**: noise is sampled on a circle in noise space (`θ = 2π·t/duration·cycles`),
  cycles are integers in loop mode; particle lifetimes are quantised so `duration/lifetime ∈ ℕ`.
* **Structural vs. mutable**: geometry kind/detail, particle count, text font face and image
  asset are structural; everything else is a uniform write.
* **GPUContext** owns one `WebGLRenderer`. Multiple `SceneRenderer`s can share it and blit
  into 2D canvases via scissored viewports — used by Home thumbnails, context previews and campaign
  grids so there is never more than one live GL context per surface.
* **PreviewHub** (thumbnail scheduler): posters first; visible cards render round-robin at low
  resolution within a 4 ms/frame budget; the hovered/selected card renders at full rate.
* **Performance**: DPR control + adaptive quality, texture cache keyed by asset version, program
  reuse via identical shader source, geometry cache, explicit `dispose()`, `IntersectionObserver`
  + `visibilitychange` pausing, `webglcontextlost/restored` recovery, error boundary per canvas,
  metrics (frame time, FPS, draw calls, triangles, texture memory estimate, compile time).
* **Safe shader policy**: no user-authored JS. The expert panel accepts a GLSL *function body*
  (`vec3 shade(vec2 uv, float t, vec3 base)`) validated against a deny-list (no `#`, loops,
  `texture`, uniforms, > 1500 chars), compiled in isolation, and auto-reverted on compile error.

## 6. Component architecture

```
src/ui/            design system primitives (Button, IconButton, Input, Slider, NumberField,
                   ColorField + ColorPicker, GradientEditor, Select, Tabs, Tooltip, Modal,
                   Popover, Toggle, Badge, StatusBadge, ApprovalIndicator, Toast, PropertyGroup,
                   EmptyState, Skeleton, Kbd)
src/engine/        Clock, GPUContext, SceneRenderer, layers/*, shaders/*, PreviewHub, export/*
src/components/    MotionCanvas, MotionCard, FormatFrame, TimelinePanel, SceneTree, ExportPanel,
                   ExportTray, CommandPalette, AppShell (rail + header)
src/features/      auth, home, explore, studio, playground, campaigns, brand, assets,
                   integrations, settings, embed
```

Stores: `session` (user, workspaces, permissions, brand), `studio` (doc, selection, history,
save state), `exports` (job queue + worker bridge). React never owns the scene graph; it renders
views of the store and dispatches commands (`updateLayer`, `addKeyframe`, …).

## 7. API contracts (summary — full list in `docs/API.md`)

All responses JSON. Errors: `{ error: { code, message, details? } }` with HTTP status.
Workspace-scoped routes require header `X-Workspace-Id` and a membership.

| Method & path | Permission | Notes |
|---|---|---|
| `POST /api/auth/register · login · logout` | – | rate-limited |
| `POST /api/auth/reset/request · reset/confirm` | – | token delivered to dev mailbox |
| `GET /api/session` | – | user, memberships, permissions per workspace |
| `GET/PUT /api/projects…` , `PUT /api/projects/:id/scene` | scene.* | `baseRevision` → 409 on conflict |
| `POST /api/projects/:id/versions` · `…/restore` · `…/branch` | scene.edit | immutable versions |
| `POST /api/templates/:id/submit` · `/approvals/:id/decide` · `/templates/:id/publish` | template.* | status machine, audit |
| `GET /api/library` | library.view | filtered by team visibility |
| `POST /api/playground/:templateId/resolve` | template.use | server-applied parameters |
| `…/campaigns`, `…/variations/:id/overrides` | campaign.* | inheritance |
| `POST /api/assets` (raw body) · `/assets/:id/replace` · `/assets/resolve` | asset.* | magic-byte validation, signed URLs |
| `POST /api/exports` · `PATCH /api/exports/:id` · `PUT /api/exports/:id/result` | export.create | quotas |
| `GET /api/integrations` · `POST …/connect` · `POST …/publish` | integration.* | capability checks |

## 8. Export pipeline design

```
UI ─► POST /api/exports {source, format, settings, values}
        server: permission + quota + validate settings
                resolve scene: project draft | template version + applyParameters(values)
                store job (queued) with resolved scene snapshot
   ◄─ job
ExportQueue (client) picks queued jobs ─► Worker(OffscreenCanvas, WebGL2)
        SceneRenderer.ready()  (fonts + textures loaded)
        PNG/WebP: renderAt(frame/fps) → convertToBlob
        MP4: for i in frames: renderAt(i/fps) → VideoFrame → VideoEncoder(H.264) → mp4-muxer
        progress → PATCH /api/exports/:id   (cancel honoured between frames)
        result → PUT /api/exports/:id/result → exported_files + object storage
```

* Fixed-time rendering: frame *i* is evaluated at exactly `i / fps`; never a screen recording.
* Background: user keeps editing; the worker owns its own GL context.
* `analyzeCompatibility(scene, format)` runs before every export and is shown in the panel;
  unimplemented formats (WebM, GIF, SVG, Lottie, dotLottie, React SDK, glTF) are listed with
  status `unavailable` and cannot be queued (server rejects them too).
* Limitation (documented): rendering happens on a client worker; a headless server render
  farm is a later phase, so the server trusts the uploaded output bytes from authorised users.

## 9. Milestone plan

| # | Slice | Done when |
|---|---|---|
| M1 | Foundation: shell, auth, workspaces, nav, DB, design system, asset storage | log in, switch workspace, upload an image |
| M2 | Engine: canvas, gradient engine, scene JSON, params, clock, save/load | gradient scene saves and reloads identically |
| M3 | Studio: hierarchy, inspector, timeline/keyframes, text, images, undo/redo | Journey A steps 1–8 |
| M4 | Library & governance: publish, exposed params, tokens, roles, approvals | Journey A 9–11, Journey D 1–6 |
| M5 | Playground & context previews | Journey B 1–9 |
| M6 | Export: PNG/WebP/MP4/JSON, queue, compatibility | Journey B 10 |
| M7 | Campaign composer: variations, inheritance, overrides, campaign export | Journey C |

## 10. Key technical risks & mitigations

| Risk | Mitigation |
|---|---|
| Many WebGL contexts on library pages exhaust the GPU (browsers cap ~16) | one shared GPUContext + PreviewHub blitting, posters, LRU of renderer states |
| Timeline resets on edit | pure evaluation, clock independent of store, per-layer structural keys |
| Non-deterministic exports | analytic particle motion, seeded RNG, fixed-time stepping, fonts bundled & awaited |
| MP4 encoding without ffmpeg | WebCodecs H.264 + mp4-muxer; `isConfigSupported` check with clear failure message |
| Lottie expectations | compatibility classes; Lottie marked unavailable rather than faked |
| Governance bypass via JSON | consumers send values only; server re-applies to pinned version |
| Concurrent editing | revision-based optimistic concurrency with conflict dialog (no silent overwrite) |
| Context loss / shader failures | recovery path rebuilding views from the doc; shader errors revert to safe material |
| Untrusted imports/uploads | schema validation + migration, magic-byte checks, SVG script stripping, size limits |
| Postgres availability in dev | PGlite (real Postgres in WASM) with identical SQL; `pg` driver when `DATABASE_URL` is set |
