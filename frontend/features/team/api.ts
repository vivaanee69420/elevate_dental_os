import { api } from '@/lib/api';

export type TeamRole = 'owner' | 'practice_manager' | 'reception' | 'analyst';

export interface TeamAccount {
  id: string;
  name: string | null;
  role: TeamRole;
}

export interface TeamMemberRow {
  id: string;
  organisation_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: TeamRole;
  status: 'invited' | 'active';
  is_agency_admin: boolean;
  last_active_at: string | null;
  /** Present only when the caller administers several accounts. */
  accounts?: TeamAccount[];
}

export interface TeamListResponse {
  members: TeamMemberRow[];
  /** True when this response spans the agency org and its sub-accounts. */
  agency_wide: boolean;
}

export interface MemberDetail {
  member: Omit<TeamMemberRow, 'accounts'>;
  /** Explicit per-user overrides only — a key absent here inherits the role. */
  overrides: Record<string, boolean>;
  /** Fully resolved map, what this person actually gets today. */
  effective: Record<string, boolean>;
  /**
   * Role defaults resolved for the MEMBER's organisation, keyed by role.
   * role_permissions is per-organisation, so an agency admin editing a
   * sub-account user must preview an unpinned row against that account's
   * defaults — the caller's own matrix would show a different answer from
   * the one the save writes.
   */
  role_defaults: Record<TeamRole, Record<string, boolean>>;
  accounts: TeamAccount[];
}

export interface SaveMemberInput {
  full_name?: string;
  phone?: string;
  role?: TeamRole;
  /** null REMOVES an override so the key inherits the role again. */
  permissions?: Record<string, boolean | null>;
  /** Agency actors only. Must include the member's home account. */
  organisation_ids?: string[];
}

export interface CreateMemberInput {
  email: string;
  full_name: string;
  role: TeamRole;
  /** Omit to send an email invite instead of setting a password. */
  password?: string;
  phone?: string;
  permissions?: Record<string, boolean>;
  home_organisation_id?: string;
  organisation_ids?: string[];
}

// NB: api() posts to the same-origin proxy, which forwards the path VERBATIM,
// so every path here carries the /api prefix the Express routers are mounted
// under. Dropping it 404s SILENTLY into an empty state.
export function getTeamList(): Promise<TeamListResponse> {
  return api<TeamListResponse>('/api/admin/team');
}

export function getMember(id: string): Promise<MemberDetail> {
  return api<MemberDetail>(`/api/admin/team/${id}`);
}

export function saveMember(
  id: string,
  body: SaveMemberInput,
): Promise<{ success: boolean; permissions: Record<string, boolean>; accounts?: string[] }> {
  return api(`/api/admin/team/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export function createMember(
  body: CreateMemberInput,
): Promise<{ success: boolean; user_id: string; status: string }> {
  return api('/api/admin/team', { method: 'POST', body: JSON.stringify(body) });
}

export function removeMember(user_id: string): Promise<{ success: boolean }> {
  return api('/api/admin/team/remove', { method: 'POST', body: JSON.stringify({ user_id }) });
}

export function setMemberPassword(input: {
  user_id: string;
  password: string;
}): Promise<{ success: boolean }> {
  return api('/api/admin/team/password', { method: 'POST', body: JSON.stringify(input) });
}
