# Status

The product is an interactive motion editor with a community gallery. Campaigns, brand kit, analytics,
templates/approvals and the old playground were removed (their history is in git).

## Built and verified

| Area | How it was verified |
|---|---|
| Editor — Design | Browser: added a star, dragged it (position matched pointer distance), resized from a corner; inspector values updated; autosaved and survived reload |
| Editor — Animate | Browser: one-click Spin created its own move “Star · Spin”; timeline rows and keyframes shown; scrubbing and playback |
| Editor — Interact | Browser: hover recipe produced two sentence rules; changing an action to “stop” took effect |
| Editor — Try it | Browser: clicking the toggle switch on the canvas flipped “On”, played “Turn on”; the widget played it backwards |
| Pointer following | Unit test: Curious buddy’s pupils ease (not snap) to a 40 px / 32 px shift, clamp at the canvas edge, move more than the eye whites, stay out of the log, and return to centre when the pointer leaves; e2e moves the mouse on the post page |
| Community | Browser + API tests: publish with image copied into community storage, open as another user, play with it, like, remix into another workspace (image copied there), unpublish (remixes survive), presets can’t be unpublished, republishing updates the same post |
| Export | e2e: “Sunset” move exported as MP4 at 1080×1080, 1.6 s, decoded in the browser; API tests for single-move timelines and full motion-file export |
| Rendering | Visual-regression baselines for five effect presets and two shape presets |

Automated: `npm test` 55/55, `npm run e2e` 11/11, `tsc --noEmit` clean, `vite build` succeeds.

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
- No grouping/ungrouping in the editor UI (groups from presets and imports are kept and shown).
- Vector paths (pen tool, boolean shapes) aren’t available; imported SVG/AI/PSD parts become images.
- Text content can’t be changed by rules or sliders.
- Figma import is tested for token rejection and link parsing only; a live import needs a token.
- Community has no comments, reporting or moderation tools yet; anyone signed in on the server can see posts.
- Rate limiting is in-memory (single instance).
