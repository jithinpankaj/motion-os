export const PERMISSIONS = {
  'workspace.view': 'View the workspace',
  'workspace.manage': 'Rename workspace, manage brands',
  'members.manage': 'Invite, remove and assign roles',
  'roles.manage': 'Edit role permissions',
  'billing.manage': 'Manage billing',
  'brand.view': 'View brand tokens',
  'brand.edit': 'Edit brand tokens and rules',
  'scene.view': 'Open motion projects',
  'scene.create': 'Create motion projects',
  'scene.edit': 'Edit scenes in Motion Studio',
  'scene.delete': 'Delete motion projects',
  'template.submit': 'Submit templates for review',
  'template.approve': 'Approve or reject templates',
  'template.publish': 'Publish approved templates',
  'template.deprecate': 'Deprecate and archive templates',
  'library.view': 'Browse the approved motion library',
  'template.use': 'Customise templates in the playground',
  'template.code': 'Access developer delivery configs',
  'campaign.view': 'View campaigns',
  'campaign.edit': 'Create and edit campaigns',
  'campaign.approve': 'Approve and publish campaigns',
  'asset.view': 'View assets',
  'asset.upload': 'Upload and replace assets',
  'asset.manage': 'Delete assets and manage collections',
  'export.create': 'Create export jobs',
  'integration.view': 'View integrations',
  'integration.manage': 'Connect and publish to integrations',
  'audit.view': 'Read the audit log',
  'analytics.view': 'See the performance dashboard',
  'analytics.manage': 'Connect analytics accounts and link posts',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as PermissionKey[];
const CONSUMER: PermissionKey[] = ['workspace.view', 'brand.view', 'library.view', 'template.use', 'asset.view', 'export.create', 'campaign.view', 'integration.view', 'analytics.view'];

export const SYSTEM_ROLES: { key: string; name: string; description: string; permissions: PermissionKey[] }[] = [
  { key: 'owner', name: 'Owner', description: 'Full control, including billing.', permissions: ALL },
  { key: 'admin', name: 'Admin', description: 'Manages members, governance and integrations.', permissions: ALL.filter((p) => p !== 'billing.manage') },
  { key: 'designer', name: 'Designer', description: 'Creates motion, defines parameters, submits for review.', permissions: [...CONSUMER, 'scene.view', 'scene.create', 'scene.edit', 'scene.delete', 'template.submit', 'template.publish', 'template.code', 'brand.edit', 'asset.upload', 'campaign.edit'] },
  { key: 'marketing', name: 'Marketing', description: 'Brand team: animates designs, imports the brand kit, runs campaigns and tracks results.', permissions: [...CONSUMER, 'scene.view', 'scene.create', 'scene.edit', 'brand.edit', 'campaign.edit', 'asset.upload', 'integration.manage', 'analytics.manage'] },
  { key: 'engineer', name: 'Engineer', description: 'Integrates approved motion via configs and SDKs.', permissions: [...CONSUMER, 'template.code'] },
  { key: 'operations', name: 'Operations', description: 'Produces deliverables from approved templates.', permissions: [...CONSUMER, 'asset.upload'] },
  { key: 'viewer', name: 'Viewer', description: 'Read-only access to the approved library.', permissions: ['workspace.view', 'brand.view', 'library.view', 'asset.view', 'campaign.view', 'analytics.view'] },
];

export const can = (perms: readonly string[] | Set<string> | undefined, key: PermissionKey) =>
  !!perms && (perms instanceof Set ? perms.has(key) : perms.includes(key));

export const TEMPLATE_STATUSES = ['draft', 'review', 'approved', 'published', 'deprecated', 'archived'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/** Allowed status transitions and the permission each requires. */
export const TEMPLATE_TRANSITIONS: Record<TemplateStatus, Partial<Record<TemplateStatus, PermissionKey>>> = {
  draft: { review: 'template.submit', archived: 'template.deprecate' },
  review: { approved: 'template.approve', draft: 'template.submit' },
  approved: { published: 'template.publish', draft: 'template.submit' },
  published: { deprecated: 'template.deprecate' },
  deprecated: { published: 'template.publish', archived: 'template.deprecate' },
  archived: {},
};

export function canTransition(from: TemplateStatus, to: TemplateStatus, perms: readonly string[]): { ok: boolean; reason?: string } {
  const need = TEMPLATE_TRANSITIONS[from]?.[to];
  if (!need) return { ok: false, reason: `Cannot move from ${from} to ${to}` };
  if (!perms.includes(need)) return { ok: false, reason: `Requires permission ${need}` };
  return { ok: true };
}
