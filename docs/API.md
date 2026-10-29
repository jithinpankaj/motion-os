# API reference

Base path `/api`. JSON bodies unless noted. Errors: `{ "error": { "code", "message", "details?" } }`.
Authentication: `mos_session` httpOnly cookie. Workspace routes require `X-Workspace-Id`; membership and
permissions are re-checked on every request. Community browsing only needs a signed-in user (the gallery
is shared by everyone on the server); publishing and remixing act on a workspace.

Notable status codes: `401 unauthenticated`, `403 forbidden | workspace_access_lost`, `409 conflict` (stale
scene revision — `details` carries the server document), `413 too_large`, `422 format_unavailable |
figma_not_connected`, `429 rate_limited | quota`.

## Routes

| Method | Path | Permission |
|---|---|---|
| GET | `/api/assets` | asset.view |
| POST | `/api/assets` | asset.upload |
| DELETE | `/api/assets/:id` | asset.manage |
| GET | `/api/assets/:id` | asset.view |
| PATCH | `/api/assets/:id` | asset.upload |
| POST | `/api/assets/:id/references/:refId/follow` | asset.upload |
| POST | `/api/assets/:id/replace` | asset.upload |
| POST | `/api/assets/resolve` | asset.view |
| GET | `/api/audit` | audit.view |
| POST | `/api/auth/dev-login` | development only, loopback |
| POST | `/api/auth/login` | public (rate limited where relevant) |
| POST | `/api/auth/logout` | public (rate limited where relevant) |
| POST | `/api/auth/password` | signed in |
| POST | `/api/auth/register` | public (rate limited where relevant) |
| POST | `/api/auth/reset/confirm` | public (rate limited where relevant) |
| POST | `/api/auth/reset/request` | public (rate limited where relevant) |
| GET | `/api/auth/sessions` | signed in |
| DELETE | `/api/auth/sessions/:prefix` | signed in |
| GET | `/api/community` | signed in |
| POST | `/api/community` | community.publish |
| DELETE | `/api/community/:id` | scene.view |
| GET | `/api/community/:id` | signed in |
| POST | `/api/community/:id/like` | signed in |
| POST | `/api/community/:id/remix` | scene.create |
| DELETE | `/api/connections/figma` | integration.manage |
| GET | `/api/connections/figma` | asset.view |
| PUT | `/api/connections/figma` | integration.manage |
| POST | `/api/design-import/figma` | asset.upload |
| GET | `/api/dev/accounts` | development only, loopback |
| GET | `/api/dev/mailbox` | development only, loopback |
| GET | `/api/exports` | export.create |
| POST | `/api/exports` | export.create |
| PATCH | `/api/exports/:id` | export.create |
| POST | `/api/exports/:id/cancel` | export.create |
| PUT | `/api/exports/:id/result` | export.create |
| POST | `/api/exports/:id/retry` | export.create |
| GET | `/api/exports/:id/scene` | export.create |
| GET | `/api/invitations/:token` | public (rate limited where relevant) |
| POST | `/api/invitations/:token/accept` | signed in |
| GET | `/api/projects` | scene.view |
| POST | `/api/projects` | scene.create |
| DELETE | `/api/projects/:id` | scene.delete |
| GET | `/api/projects/:id` | scene.view |
| PATCH | `/api/projects/:id` | scene.edit |
| POST | `/api/projects/:id/duplicate` | scene.create |
| PUT | `/api/projects/:id/scene` | scene.edit |
| GET | `/api/projects/:id/versions` | scene.view |
| POST | `/api/projects/:id/versions` | scene.edit |
| GET | `/api/projects/:id/versions/:vid` | scene.view |
| POST | `/api/projects/:id/versions/:vid/branch` | scene.create |
| POST | `/api/projects/:id/versions/:vid/restore` | scene.edit |
| GET | `/api/session` | public (rate limited where relevant) |
| GET | `/api/workspace` | workspace.view |
| POST | `/api/workspace/invitations` | members.manage |
| DELETE | `/api/workspace/invitations/:id` | members.manage |
| DELETE | `/api/workspace/members/:userId` | members.manage |
| PUT | `/api/workspace/members/:userId/roles` | members.manage |
| PUT | `/api/workspace/members/:userId/teams` | members.manage |
| POST | `/api/workspace/roles` | roles.manage |
| PUT | `/api/workspace/roles/:roleId/permissions` | roles.manage |
| POST | `/api/workspace/teams` | members.manage |
| GET | `/files/*key` | public (rate limited where relevant) |

## Notes

- `POST /api/projects` takes `{ name, width?, height?, background? }` for a blank file, `{ name, preset }` for a
  built-in preset (see `shared/motion/presets.ts`) or `{ name, scene }` to import a motion file (migrated and
  validated before it is stored).
- `POST /api/exports` takes `{ source: { kind: 'project', id, animationId? }, format, settings }`. With an
  `animationId` that one move is rendered as a plain timeline; `scene-json` always exports the whole file
  including controls, moves, rules and slider links.
- `POST /api/community` publishes (or, if the file already has a live post, updates) a copy of a file. Body:
  `{ projectId, title, description?, tags?, category? }` where `category` is one of Characters, Interactive UI,
  Illustrations, Typography, Celebrations, Loaders; it is stored on the file and as the post's first tag
  (`?tag=interactive-ui` filters by it). Images and sounds are copied into community storage; the post never
  references the author's workspace. `POST /api/community/:id/remix` copies the post (and its images and
  sounds) into the caller's workspace.
- `GET /api/assistant/status` → `{ configured, model }`. `POST /api/assistant` (`scene.edit`, 12/min) with
  `{ doc, messages: [{ role, text }] }` → `{ reply, operations }` — Claude’s answer in the schema of
  `shared/motion/assistant.ts`; the client applies it. 503 `assistant_not_configured` without a credential.
- `POST /api/assets?kind=audio` accepts MP3, WAV or OGG (sniffed from the bytes, up to 10 MB).
- Outbound requests for user-supplied URLs (Figma) allow only http(s), refuse private, loopback and link-local
  addresses on every redirect hop, and cap size and time. Third-party tokens are stored AES-256-GCM encrypted.
