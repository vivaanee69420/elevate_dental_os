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

/** A team member as returned by GET /api/admin/team. */
export interface TeamMember {
  id: string;
  email: string;
  full_name: string | null;
  role: 'owner' | 'practice_manager' | 'reception';
  status: 'invited' | 'active';
  last_active_at: string | null;
}

export interface TeamResponse {
  members: TeamMember[];
}

export function getTeam(): Promise<TeamResponse> {
  return api<TeamResponse>('/api/admin/team');
}

export interface InviteMemberInput {
  email: string;
  full_name: string;
  role: 'owner' | 'practice_manager' | 'reception';
  /** Optional per-member permission overrides (catalogue key -> allowed). */
  permissions?: Record<string, boolean>;
}

export function inviteMember(
  body: InviteMemberInput,
): Promise<{ success: boolean; user_id: string; status: 'invited' }> {
  return api('/api/admin/team/invite', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function removeMember(
  user_id: string,
): Promise<{ success: boolean }> {
  return api('/api/admin/team/remove', {
    method: 'POST',
    body: JSON.stringify({ user_id }),
  });
}
