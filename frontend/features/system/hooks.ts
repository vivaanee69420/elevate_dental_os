import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPermissionsMatrix,
  setRolePermission,
  type PermissionsMatrix,
} from './api';

const KEY = ['admin', 'permissions'];

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
