// Platform (superadmin) console — data access.
//
// These types were previously redeclared inline in each page, which is how
// `Org` came to mean two different shapes: the list endpoint returns no
// user_count, the detail endpoint does. They are named apart here rather than
// merged, so neither page can read a field the other's endpoint never sends.
//
// Every call goes through platformApi, which carries the PLATFORM token, not a
// tenant session. That separation is deliberate and must not be blurred.
import { platformApi } from '@/lib/platform-api';

export type PlatformOverview = {
  total_orgs: number;
  total_users: number;
  new_orgs_window: number;
  new_users_window: number;
  window_days: number;
};

export type IntegrationHealthRow = {
  provider: string;
  connected: number;
  error: number;
  total: number;
};

/** The /orgs LIST shape — no user_count. */
export type OrgRow = {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  created_at: string;
};

/** The /orgs/:id DETAIL shape — carries user_count. */
export type OrgDetail = OrgRow & { user_count: number };

export type PlatformUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  organisation_id: string;
  status: string | null;
  created_at: string;
};

/** The per-org user list returns a narrower row than /users does. */
export type OrgUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string | null;
  last_seen_at: string | null;
};

export type OrgActivity = {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  created_at: string;
};

export type Signup = {
  id: string;
  email: string;
  full_name: string;
  organisation_id: string;
  organisation_name: string | null;
  organisation_slug: string | null;
  status: string;
  created_at: string;
};

export type AuditRow = {
  id: string;
  organisation_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  ip_address: string | null;
  created_at: string;
};

/** Returned ONCE, on creation. The temp password is never retrievable again. */
export type CreatedOwner = {
  organisation_id: string;
  owner_id: string;
  email: string;
  temp_password: string;
};

export function getPlatformOverview(days = 30) {
  return platformApi<PlatformOverview>(`/metrics/overview?days=${days}`);
}

export function getIntegrationHealth() {
  return platformApi<IntegrationHealthRow[]>('/metrics/integrations');
}

export function listOrgs(params: URLSearchParams) {
  return platformApi<{ rows: OrgRow[]; total: number }>(`/orgs?${params}`);
}

export function getOrg(id: string) {
  return platformApi<OrgDetail>(`/orgs/${id}`);
}

export function getOrgUsers(id: string) {
  return platformApi<OrgUser[]>(`/orgs/${id}/users`);
}

export function getOrgActivity(id: string) {
  return platformApi<OrgActivity[]>(`/orgs/${id}/activity`);
}

export function listPlatformUsers(params: URLSearchParams) {
  return platformApi<PlatformUser[]>(`/users?${params}`);
}

export function listSignups() {
  return platformApi<Signup[]>('/signups');
}

export function actOnSignup(id: string, action: 'approve' | 'reject') {
  return platformApi<unknown>(`/signups/${id}/${action}`, { method: 'POST' });
}

export function listAudit(params: URLSearchParams) {
  return platformApi<{ rows: AuditRow[]; total: number }>(`/audit?${params}`);
}

export function createOrgWithOwner(body: unknown) {
  return platformApi<CreatedOwner>('/orgs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
