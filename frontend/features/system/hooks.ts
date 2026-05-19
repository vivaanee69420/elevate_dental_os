import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPermissionsMatrix,
  setRolePermission,
  getTeam,
  inviteMember,
  removeMember,
  type PermissionsMatrix,
  type TeamResponse,
} from './api';

const KEY = ['admin', 'permissions'];
const TEAM_KEY = ['admin', 'team'];

export function usePermissionsMatrix() {
  return useQuery({ queryKey: KEY, queryFn: getPermissionsMatrix });
}

export function useSetRolePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setRolePermission,
    // Optimistic toggle: flip the cached cell immediately, roll back on error.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<PermissionsMatrix>(KEY);
      if (prev) {
        qc.setQueryData<PermissionsMatrix>(KEY, {
          ...prev,
          roles: {
            ...prev.roles,
            [vars.role]: {
              ...prev.roles[vars.role],
              [vars.permission_key]: vars.allowed,
            },
          },
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useTeam() {
  return useQuery({ queryKey: TEAM_KEY, queryFn: getTeam });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: inviteMember,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEAM_KEY });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeMember,
    // Optimistic removal: drop the row immediately, roll back on error.
    onMutate: async (user_id: string) => {
      await qc.cancelQueries({ queryKey: TEAM_KEY });
      const prev = qc.getQueryData<TeamResponse>(TEAM_KEY);
      if (prev) {
        qc.setQueryData<TeamResponse>(TEAM_KEY, {
          ...prev,
          members: prev.members.filter((m) => m.id !== user_id),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(TEAM_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TEAM_KEY });
    },
  });
}
