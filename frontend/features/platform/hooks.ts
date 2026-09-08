// Platform console — React Query hooks.
//
// Every key is prefixed 'platform' so a tenant-side invalidation can never
// sweep superadmin data, and so these caches are obviously separate from the
// tenant ones: the two are fetched with DIFFERENT tokens and must not be
// conflated.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPlatformOverview,
  getIntegrationHealth,
  listOrgs,
  getOrg,
  getOrgUsers,
  getOrgActivity,
  listPlatformUsers,
  listSignups,
  actOnSignup,
  listAudit,
  createOrgWithOwner,
} from './api';

export function usePlatformOverview(days = 30) {
  return useQuery({
    queryKey: ['platform', 'overview', days],
    queryFn: () => getPlatformOverview(days),
  });
}

export function useIntegrationHealth() {
  return useQuery({
    queryKey: ['platform', 'integration-health'],
    queryFn: getIntegrationHealth,
  });
}

// The params are part of the key, so paging and filtering are cached per
// combination and going back to a previous page is instant.
export function useOrgs(params: URLSearchParams) {
  const key = params.toString();
  return useQuery({
    queryKey: ['platform', 'orgs', key],
    queryFn: () => listOrgs(new URLSearchParams(key)),
  });
}

export function useOrg(id: string) {
  return useQuery({
    queryKey: ['platform', 'org', id],
    queryFn: () => getOrg(id),
    enabled: !!id,
  });
}

export function useOrgUsers(id: string) {
  return useQuery({
    queryKey: ['platform', 'org-users', id],
    queryFn: () => getOrgUsers(id),
    enabled: !!id,
  });
}

export function useOrgActivity(id: string) {
  return useQuery({
    queryKey: ['platform', 'org-activity', id],
    queryFn: () => getOrgActivity(id),
    enabled: !!id,
  });
}

// `enabled` carries the page's own rule that a search needs at least two
// characters — without it the hook would fire a request for every keystroke
// from the first one.
export function usePlatformUsers(params: URLSearchParams, enabled = true) {
  const key = params.toString();
  return useQuery({
    queryKey: ['platform', 'users', key],
    queryFn: () => listPlatformUsers(new URLSearchParams(key)),
    enabled,
  });
}

export function useSignups() {
  return useQuery({
    queryKey: ['platform', 'signups'],
    queryFn: listSignups,
  });
}

export function useAudit(params: URLSearchParams) {
  const key = params.toString();
  return useQuery({
    queryKey: ['platform', 'audit', key],
    queryFn: () => listAudit(new URLSearchParams(key)),
  });
}

// Approving or rejecting changes the signup list AND creates/blocks a user, so
// the user and org lists are invalidated too. The page used to reload only its
// own list, leaving the Users page stale until a hard refresh.
export function useActOnSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      actOnSignup(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'signups'] });
      qc.invalidateQueries({ queryKey: ['platform', 'users'] });
      qc.invalidateQueries({ queryKey: ['platform', 'orgs'] });
      qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
  });
}

// Creating an owner creates an organisation, so both lists and the headline
// counts change.
export function useCreateOrgWithOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => createOrgWithOwner(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform', 'orgs'] });
      qc.invalidateQueries({ queryKey: ['platform', 'users'] });
      qc.invalidateQueries({ queryKey: ['platform', 'overview'] });
    },
  });
}
