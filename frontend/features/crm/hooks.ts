import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCommunications,
  sendCommunication,
  fetchGhlWorkflows,
  fetchInbox,
  fetchThread,
  type CommunicationsListFilters,
  type InboxFilters,
  type SendCommunicationInput,
} from './api';

export function useGhlWorkflows(accountId?: string | null) {
  return useQuery({
    queryKey: ['ghl-workflows', accountId ?? 'all'],
    queryFn: () => fetchGhlWorkflows(accountId),
    staleTime: 60_000,
  });
}

export function useCommunications(filters: CommunicationsListFilters = {}) {
  return useQuery({
    queryKey: ['communications', filters],
    queryFn: () => fetchCommunications(filters),
    staleTime: 30_000,
  });
}

// Inbox thread list. placeholderData keeps the current page on screen while the
// next loads, so paging and typing in the search box do not flash the list away
// and back — the list is the page's whole content, and blanking it on every
// keystroke reads as the search having failed.
export function useInbox(filters: InboxFilters = {}) {
  return useQuery({
    queryKey: ['inbox', filters],
    queryFn: () => fetchInbox(filters),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useThread(threadKey: string | null) {
  return useQuery({
    queryKey: ['inbox-thread', threadKey],
    queryFn: () => fetchThread(threadKey as string),
    enabled: !!threadKey,
    staleTime: 15_000,
  });
}

export function useSendCommunication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendCommunicationInput) => sendCommunication(input),
    onSuccess: () => {
      // Both the thread list (unread counts, last message) and the open
      // conversation change when a reply goes out.
      qc.invalidateQueries({ queryKey: ['communications'] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      qc.invalidateQueries({ queryKey: ['inbox-thread'] });
    },
  });
}
