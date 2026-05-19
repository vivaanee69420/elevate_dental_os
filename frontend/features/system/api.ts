import { api } from '@/lib/api';

/** Role keys the permissions matrix is editable for (Owner is implicit-all). */
export type EditableRole = 'practice_manager' | 'reception';

/** Shape of GET /api/admin/permissions. */
export interface PermissionsMatrix {
  /** permission key -> human label */
  catalog: Record<string, string>;
  /** role -> { permission key -> allowed } */
  roles: {
    owner: Record<string, boolean>;
    practice_manager: Record<string, boolean>;
    reception: Record<string, boolean>;
  };
}

export function getPermissionsMatrix(): Promise<PermissionsMatrix> {
  return api<PermissionsMatrix>('/api/admin/permissions');
}

export function setRolePermission(input: {
  role: EditableRole;
  permission_key: string;
  allowed: boolean;
}): Promise<unknown> {
  return api('/api/admin/permissions/role', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
