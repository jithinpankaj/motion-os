export const PERMISSIONS = {
  'workspace.view': 'View the workspace',
  'workspace.manage': 'Rename the workspace',
  'members.manage': 'Invite, remove and assign roles',
  'roles.manage': 'Edit role permissions',
  'billing.manage': 'Manage billing',
  'scene.view': 'Open motion files',
  'scene.create': 'Create and remix motion files',
  'scene.edit': 'Edit motion files',
  'scene.delete': 'Delete motion files',
  'asset.view': 'View uploaded images',
  'asset.upload': 'Upload images and designs',
  'asset.manage': 'Delete uploads',
  'export.create': 'Export video, stills and motion files',
  'integration.view': 'See connections (Figma)',
  'integration.manage': 'Connect Figma',
  'community.publish': 'Publish to the community',
  'audit.view': 'Read the audit log',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as PermissionKey[];
const VIEWER: PermissionKey[] = ['workspace.view', 'scene.view', 'asset.view', 'export.create', 'integration.view'];
const MAKER: PermissionKey[] = [...VIEWER, 'scene.create', 'scene.edit', 'scene.delete', 'asset.upload', 'community.publish'];

/** Existing role keys are kept so stored memberships stay valid; makers all get the same tools. */
export const SYSTEM_ROLES: { key: string; name: string; description: string; permissions: PermissionKey[] }[] = [
  { key: 'owner', name: 'Owner', description: 'Full control, including billing.', permissions: ALL },
  { key: 'admin', name: 'Admin', description: 'Manages members, roles and connections.', permissions: ALL.filter((p) => p !== 'billing.manage') },
  { key: 'designer', name: 'Designer', description: 'Creates, animates, publishes and remixes motion.', permissions: [...MAKER, 'integration.manage'] },
  { key: 'marketing', name: 'Marketing', description: 'Creates, animates, publishes and remixes motion.', permissions: [...MAKER, 'integration.manage'] },
  { key: 'engineer', name: 'Engineer', description: 'Opens files, tries interactions and exports.', permissions: VIEWER },
  { key: 'operations', name: 'Operations', description: 'Makes and exports motion.', permissions: MAKER },
  { key: 'viewer', name: 'Viewer', description: 'Read-only.', permissions: ['workspace.view', 'scene.view', 'asset.view'] },
];

export const can = (perms: readonly string[] | Set<string> | undefined, key: PermissionKey) =>
  !!perms && (perms instanceof Set ? perms.has(key) : perms.includes(key));
