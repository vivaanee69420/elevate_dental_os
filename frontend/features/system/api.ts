import { api } from '@/lib/api';

/** Role keys the permissions matrix is editable for (Owner is implicit-all). */
export type EditableRole = 'practice_manager' | 'reception' | 'analyst';

/** All roles a user account can hold. */
export type Role = 'owner' | 'practice_manager' | 'reception' | 'analyst';

/** Shape of GET /api/admin/permissions. */
export interface PermissionsMatrix {
  /** permission key -> human label */
  catalog: Record<string, string>;
  /** page id -> the section key it inherits from, when not overridden */
  pages?: Record<string, string>;
  /** role -> { 'page:<id>' -> allowed } for EXPLICIT overrides only */
  overrides?: Record<string, Record<string, boolean>>;
  /** role -> { permission key -> allowed }, page keys included and resolved */
  roles: {
    owner: Record<string, boolean>;
    practice_manager: Record<string, boolean>;
    reception: Record<string, boolean>;
    analyst: Record<string, boolean>;
  };
}

export function getPermissionsMatrix(): Promise<PermissionsMatrix> {
  return api<PermissionsMatrix>('/api/admin/permissions');
}

export function setRolePermission(input: {
  role: EditableRole;
  permission_key: string;
  /** null clears the row: a page override goes back to inheriting its section. */
  allowed: boolean | null;
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
  role: Role;
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
  role: Role;
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

export interface ProvisionMemberInput {
  email: string;
  full_name: string;
  role: Role;
  password: string;
  /** Optional per-member permission overrides (bounded server-side by the
   *  caller's own grants). */
  permissions?: Record<string, boolean>;
}

/** Add a member with a password set by the admin (active immediately). */
export function provisionMember(
  body: ProvisionMemberInput,
): Promise<{ success: boolean; user_id: string; status: 'active' }> {
  return api('/api/admin/team/provision', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Reset an existing member's password. */
export function setMemberPassword(input: {
  user_id: string;
  password: string;
}): Promise<{ success: boolean }> {
  return api('/api/admin/team/password', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
