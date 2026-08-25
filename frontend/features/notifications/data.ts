'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type Notification = {
  id: string;
  category: string;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
};
export type Preference = { category: string; in_app: boolean; email: boolean; sms: boolean };

const CATEGORIES = ['account', 'team', 'integration', 'digest', 'system'];

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api<{ count: number }>('/api/notifications/unread-count').then((d) => d.count),
    refetchInterval: 60_000,
  });
}

export function useNotifications(unread = false) {
  return useQuery({
    queryKey: ['notifications', 'list', unread],
    queryFn: () =>
      api<{ notifications: Notification[] }>(`/api/notifications?unread=${unread}`).then((d) => d.notifications),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/api/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function usePreferences() {
  return useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: async () => {
      const { preferences: stored } = await api<{ preferences: Preference[] }>('/api/notifications/preferences');
      // Fill defaults for categories with no stored row.
      return CATEGORIES.map(
        (c) =>
          stored.find((p) => p.category === c) ?? {
            category: c,
            in_app: true,
            email: true,
            sms: c === 'integration',
          },
      );
    },
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: Preference[]) =>
      api('/api/notifications/preferences', { method: 'PUT', body: JSON.stringify({ preferences }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'preferences'] }),
  });
}
