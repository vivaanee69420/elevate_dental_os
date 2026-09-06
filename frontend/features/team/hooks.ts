import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTeamList, getMember, saveMember, createMember, removeMember, setMemberPassword,
  type SaveMemberInput, type CreateMemberInput, type TeamListResponse,
} from './api';

const LIST_KEY = ['team', 'list'];
const memberKey = (id: string) => ['team', 'member', id];

export function useTeamList() {
  return useQuery({ queryKey: LIST_KEY, queryFn: getTeamList });
}

export function useMember(id: string | undefined) {
  return useQuery({
    queryKey: memberKey(id ?? ''),
    queryFn: () => getMember(id as string),
    enabled: Boolean(id),
  });
}

export function useSaveMember(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveMemberInput) => saveMember(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memberKey(id) });
      qc.invalidateQueries({ queryKey: LIST_KEY });
      // A save can change the CALLER's own permissions, and /auth/me is
      // cached for 5 minutes — without this the nav keeps showing what they
      // could reach before the change.
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMemberInput) => createMember(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeMember,
    onMutate: async (user_id: string) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<TeamListResponse>(LIST_KEY);
      if (prev) {
        qc.setQueryData<TeamListResponse>(LIST_KEY, {
          ...prev,
          members: prev.members.filter((m) => m.id !== user_id),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(LIST_KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useSetMemberPassword() {
  return useMutation({ mutationFn: setMemberPassword });
}
