# API reference

Base path `/api`. JSON bodies unless noted. Errors: `{ "error": { "code", "message", "details?" } }`.
Authentication: `mos_session` httpOnly cookie (or `Authorization: Bearer`). Tenant routes require
`X-Workspace-Id`; membership and permissions are re-checked on every request (permission changes apply
immediately, including in open editors). Permission keys are listed in `shared/permissions.ts`.

Notable status codes: `401 unauthenticated`, `403 forbidden | workspace_access_lost`, `409 conflict`
(stale scene revision — `details` carries the server document), `413 too_large`, `422 format_unavailable |
connector_unavailable`, `429 rate_limited | quota`.

## Routes

| Method | Path | Permission |
|---|---|---|
| GET | `/api/approvals` | workspace.view |
| POST | `/api/approvals/:id/decide` | template.approve or campaign.approve (checked in handler; no self-approval unless owner/admin) |
| GET | `/api/assets` | asset.view |
| POST | `/api/assets` | asset.upload |
| DELETE | `/api/assets/:id` | asset.manage |
| GET | `/api/assets/:id` | asset.view |
| PATCH | `/api/assets/:id` | asset.upload |
| POST | `/api/assets/:id/references/:refId/follow` | asset.upload |
| POST | `/api/assets/:id/replace` | asset.upload |
| POST | `/api/assets/resolve` | asset.view |
| POST | `/api/assistant` | library.view |
| GET | `/api/audit` | audit.view |
| POST | `/api/auth/login` | session / public |
| POST | `/api/auth/logout` | session / public |
| POST | `/api/auth/password` | session / public |
| POST | `/api/auth/register` | session / public |
| POST | `/api/auth/reset/confirm` | session / public |
| POST | `/api/auth/reset/request` | session / public |
| GET | `/api/auth/sessions` | session / public |
| DELETE | `/api/auth/sessions/:prefix` | session / public |
| GET | `/api/brands/:id/tokens` | brand.view |
| PUT | `/api/brands/:id/tokens` | brand.edit |
| GET | `/api/brands/:id/versions` | brand.view |
| POST | `/api/brands/:id/versions/:version/restore` | brand.edit |
| GET | `/api/campaigns` | campaign.view |
| POST | `/api/campaigns` | campaign.edit |
| GET | `/api/campaigns/:id` | campaign.view |
| PUT | `/api/campaigns/:id/master` | campaign.edit |
| POST | `/api/campaigns/:id/publish` | campaign.approve |
| POST | `/api/campaigns/:id/submit` | campaign.edit |
| POST | `/api/campaigns/:id/upgrade` | campaign.edit |
| POST | `/api/campaigns/:id/variations` | campaign.edit |
| DELETE | `/api/campaigns/:id/variations/:vid` | campaign.edit |
| DELETE | `/api/campaigns/:id/variations/:vid/overrides/:key` | campaign.edit |
| PUT | `/api/campaigns/:id/variations/:vid/overrides/:key` | campaign.edit |
| GET | `/api/dev/mailbox` | session / public |
| GET | `/api/exports` | export.create |
| POST | `/api/exports` | export.create |
| PATCH | `/api/exports/:id` | export.create |
| POST | `/api/exports/:id/cancel` | export.create |
| PUT | `/api/exports/:id/result` | export.create |
| POST | `/api/exports/:id/retry` | export.create |
| GET | `/api/exports/:id/scene` | export.create |
| GET | `/files/*` | signed URL |
| GET | `/api/home` | workspace.view |
| GET | `/api/integrations` | integration.view |
| POST | `/api/integrations/:provider/connect` | integration.manage |
| DELETE | `/api/integrations/connections/:id` | integration.manage |
| POST | `/api/integrations/connections/:id/publish` | integration.manage |
| POST | `/api/integrations/package` | export.create |
| GET | `/api/invitations/:token` | session / public |
| POST | `/api/invitations/:token/accept` | session / public |
| GET | `/api/library` | library.view |
| GET | `/api/projects` | scene.view |
| POST | `/api/projects` | scene.create |
| DELETE | `/api/projects/:id` | scene.delete |
| GET | `/api/projects/:id` | scene.view |
| PATCH | `/api/projects/:id` | scene.edit |
| POST | `/api/projects/:id/duplicate` | scene.create |
| PUT | `/api/projects/:id/scene` | scene.edit |
| POST | `/api/projects/:id/submit` | template.submit |
| GET | `/api/projects/:id/versions` | scene.view |
| POST | `/api/projects/:id/versions` | scene.edit |
| GET | `/api/projects/:id/versions/:vid` | scene.view |
| POST | `/api/projects/:id/versions/:vid/branch` | scene.create |
| POST | `/api/projects/:id/versions/:vid/restore` | scene.edit |
| GET | `/api/session` | session / public |
| DELETE | `/api/templates/:id` | template.deprecate |
| GET | `/api/templates/:id` | library.view |
| GET | `/api/templates/:id/delivery` | template.code |
| POST | `/api/templates/:id/publish` | template.publish |
| POST | `/api/templates/:id/resolve` | template.use |
| POST | `/api/templates/:id/status` | per transition (`TEMPLATE_TRANSITIONS`) |
| GET | `/api/workspace` | workspace.view |
| POST | `/api/workspace/invitations` | members.manage |
| DELETE | `/api/workspace/invitations/:id` | members.manage |
| DELETE | `/api/workspace/members/:userId` | members.manage |
| PUT | `/api/workspace/members/:userId/roles` | members.manage |
| PUT | `/api/workspace/members/:userId/teams` | members.manage |
| POST | `/api/workspace/roles` | roles.manage |
| PUT | `/api/workspace/roles/:roleId/permissions` | roles.manage |
| POST | `/api/workspace/teams` | members.manage |

Binary uploads (`POST /assets`, `POST /assets/:id/replace`, `PUT /exports/:id/result`) take the raw file
as the request body; metadata goes in the query string. Files are classified by magic bytes; active SVG
content is rejected. Downloads use `/files/<key>?exp=&sig=` signed URLs (HMAC, expiring, Range-capable).

## Export job lifecycle

`POST /exports { source, format, settings, channel? }` → server resolves the scene (project draft, or
template version + `applyParameters(values)` with the caller's roles, or campaign variation), adapts it to
the channel, stores a snapshot → `queued`. The client worker `PATCH`es `processing` + progress, renders,
then `PUT /exports/:id/result` (validated against format and dimensions) → `completed`. `scene-json` and
`embed` complete on the server immediately. `POST /exports/:id/cancel | retry`.
