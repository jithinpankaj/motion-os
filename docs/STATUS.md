# Status by milestone

Everything listed as **Built** was exercised in the running app or by automated tests. Items under
**Not built / limitations** are deliberately not represented as working in the UI.

## Verification performed

| Journey | How it was verified | Result |
|---|---|---|
| A — Designer creates motion | Browser: new scene from Aurora preset → edit → keyframe → shader error recovery → submit (self-approval blocked) → owner approves on Home → publish; library visibility checked per role | Pass — template visible to Marketing only, hidden from Engineering as configured |
| B — Marketing Instagram content | Browser: Explore (Story) → Playground → headline + Dusk palette → MP4 export; file decoded in browser | Pass — H.264, 1080×1920, 240 frames, 8.000 s, headline present in frames |
| C — Multi-channel campaign | Browser: campaign with IG / LinkedIn / Web → master accent change → LinkedIn headline override → export | Pass — three MP4s at 1080×1350, 1200×1200, 1920×1080; only LinkedIn shows the override; all share the master accent |
| D — Engineering | Browser: Developer tab → version-pinned config → local embed example (WebGL, reduced-motion, no-WebGL fallback) | Pass |
| Continuous playback | Studio: edited text while playing; frame counter kept advancing (f51→f54→f57), autosave completed | Pass (also an e2e test) |
| Determinism | Visual regression baselines re-rendered identically on a second run | Pass |

Automated: `npm test` 66/66, `npm run e2e` 9/9, `tsc --noEmit` clean, `vite build` succeeds.

Bugs found and fixed during verification: canvas context reuse under React StrictMode; Playground header
grid-area collision; text-field remount mid-typing; modal initial focus; card grid sizing; missing HTTP
Range support (exported videos could not be seeked); export frames now snapshot via
`transferToImageBitmap` before encoding; invalid scene imports returned 500 instead of 400; Liquid Mesh
silhouette artifacts; Particle Field attractor too weak to read.

## Brand-team release — simplified product

**Built and verified in the browser**
- Navigation reduced to Home, Create, Brand kit, Library, Analytics; power tools moved to an Advanced menu.
  Marketing (the brand team) can now create motion, edit the brand kit and manage analytics.
- **Create** (3 steps): layered SVG → 5 parts; Photoshop → 3 positioned pixel layers; layered PDF/Illustrator
  (PDF-compatible, optional content groups) → 4 named layers; raster images → one piece. Six motion styles
  (build in, gentle float, brand backdrop, pop & sparkle, slow zoom, headline focus) × four personalities.
  Headline and new elements are placed in the emptiest area of the design. A saved motion exported to MP4
  (1536×1920, 8.000 s) with the uploaded parts and transparency intact.
- **Brand kit import**: guidelines PDF → HEX/RGB codes, font names, “calm” tone; real website (stripe.com) →
  palette, Söhne/Source Code Pro mapped to available fonts, inline SVG logo + touch icon, “energetic” tone.
  Review before save; saves a new token version (previous versions restorable).
- **Elements**: shape maker in brand colours and element upload, added to motions from Create.
- **Analytics**: connect screens for GA4 (service account), Meta and LinkedIn; real calls with invalid
  credentials to Figma, Meta, LinkedIn and Google were rejected with the provider’s reason and nothing was saved.

**Bugs found and fixed while verifying**: image layers ignored PNG transparency (black boxes) — the shader now
uses texture alpha with premultiplied upload; pdf.js layer API mismatch; PDF text lines merged (font names
ran together); duplicate voice words; preview canvas had zero height; sticky preview covered controls on
narrow screens; raw CSS font identifiers (`sohne-var`) shown to users.

**Not verified / limitations**
- GA4, Meta and LinkedIn metrics were verified against a fake network (request shapes, signed JWT, parsing,
  failure handling), **not against live accounts** — that needs your credentials. LinkedIn also requires an
  app with Community Management API approval; Meta needs `instagram_manage_insights` / `read_insights`.
- Figma import was tested for token rejection and link parsing only; a live frame import needs a token.
- Illustrator files must be saved with PDF compatibility; layers come through only when the PDF part has
  optional content groups. Photoshop layer styles (shadows, strokes) and adjustment layers are not applied.
- Brand fonts that aren’t bundled are mapped to the closest bundled font; uploading custom font files into
  scenes from the simple flow is not built yet.
- Elements are placed automatically; there is no drag-to-position in the simple flow (use the advanced editor).
- Simple-flow motions aren’t grouped into campaigns yet; Advanced → Campaigns works from approved templates.
- Website import reads the server-rendered HTML and up to six stylesheets; sites that render everything with
  JavaScript return fewer findings. DNS is checked before each request but not pinned for the connection.

## M1 Foundation — Built
App shell with permission-adaptive rail, workspace + brand switcher always visible, ⌘K palette. Email/password
auth (scrypt, hashed session tokens, httpOnly cookies), password reset (dev mailbox), sessions list/revoke,
invitations, multi-team / multi-role membership, configurable role→permission matrix, audit log. PostgreSQL
schema (all Part 13 tables + `dev_mailbox`, `invitations`, `password_resets`, `template_versions`,
`membership_roles`). Object storage adapter with HMAC-signed, expiring URLs and byte ranges.

## M2 Engine — Built
Three.js/WebGL 2 renderer with per-layer views; gradient engine (linear, radial, mesh, aurora, noise, organic)
with OKLab/smooth/linear interpolation, noise, distortion, flow, grain; seamless loops (circular noise phase,
integer cycles, quantised particle lifetimes). Versioned Zod schema, migrations (v1→v2), canonical
serialisation. Central clock; edits never touch time; structural keys rebuild only what changed.
Performance: DPR control, adaptive quality, overload warning, texture/geometry caches, program reuse,
disposal, visibility pausing, context-loss recovery (with a "simulate" button), per-layer render error
boundary, metrics inspector (FPS, frame ms, draw calls, triangles, points, texture MB, compile ms).

## M3 Studio — Built
Hierarchy (add/remove/duplicate/rename/group/ungroup/reorder by drag/hide/lock/multi-select), contextual
inspector for all layer types, expert shader panel (validated snippet, compile errors auto-revert), timeline
(play/pause/scrub/loop/speed/duration/frame step, keyframes with drag + easing curve editor, reveal clips),
direct manipulation (drag text/images, orbit camera), zoom/pan/fit/1:1/fullscreen, grid/guides/safe areas,
preview-as-format, reduced/static motion preview, undo/redo with coalescing, autosave, offline queue,
local draft recovery after refresh, optimistic concurrency with conflict dialog, versions (save, restore,
branch, compare).

## M4 Library & governance — Built
Exposed parameters (all 10 types) with ranges, options, max length, locks + reasons, role restrictions,
token binding; publish flow draft → review → approved → published (+ deprecated/archived); immutable
template versions with asset pins; separation of duties; team visibility; brand token editor with versions
and restore; faceted library (category, team, brand, channel, format, colour, interaction, export, status).

## M5 Playground — Built
Governed controls with inline explanations, undo/redo, 8 realistic channel frames, side-by-side compare on
one shared WebGL context, safe-area overlays, assistant suggestions validated against template rules,
developer delivery tab.

## M6 Export — Built
Background worker (OffscreenCanvas + WebGL 2), fixed-time frame stepping, PNG/WebP exact frames
(transparent option), MP4 via WebCodecs H.264 + mp4-muxer (size, fps, duration, start, loops, quality,
background), server-side Scene JSON and embed config, job queue with progress, cancel, retry, quotas,
result validation by magic bytes and dimensions, exports registered as library assets, compatibility
analysis (native / vector / raster / fallback classes, interactivity loss, flashing).

## M7 Campaigns — Built
Campaigns pinned to a template version; master values; per-variation overrides with source badges and
reset; master edits never touch overrides; publish snapshots (published outputs never change silently;
"unpublished changes" indicator); upgrade to newer template versions with a report of dropped values;
approvals; campaign export of every channel at native size; zip export package with manifest.

## Not built / limitations
- **Export formats** WebM, GIF, SVG, Lottie, dotLottie, React SDK and glTF are listed as unavailable in the UI
  and rejected by the API (422). No format is faked.
- **Rendering location**: exports render in the client's worker; the server validates the job, resolves the
  scene from pinned versions and validates the returned bytes (format + dimensions), but does not re-render.
  A headless render farm is the next step for full output trust.
- **Integrations**: Instagram / Facebook / LinkedIn show capability matrices but are unavailable (they need
  registered apps and platform review). The signed webhook connector and export packages are fully
  functional; a local test receiver (`/api/dev/receiver/accept|reject`) demonstrates confirmation and
  rejection handling. Hosted embed delivery (CDN) is a later phase; configs + local runtime work today.
- **Email**: invitations and resets are written to a development mailbox, not sent.
- **Assistant**: deterministic, local and rule-based (search, tuning suggestions, channel advice, export
  explanations). An LLM provider can be added behind the same validation; not implemented.
- **Real-time co-editing**: concurrent edits are detected and resolved via a conflict dialog (no silent
  overwrite); live multi-cursor collaboration is not implemented.
- **Blend modes** limited to normal / add / screen / multiply. Image crop is numeric (no on-canvas crop handles).
  Rotation/scale handles are visual only; move is interactive.
- **Billing** settings are not implemented.
- Font licences are recorded and surfaced, but export blocking on licence scope is a warning, not enforcement.
- Rate limiting is in-memory (single instance).
