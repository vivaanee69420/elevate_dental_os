import { useQuery } from '@tanstack/react-query';
import { listContacts } from './api';

export function useContacts(search: string, practiceId: string | null = null) {
  return useQuery({
    queryKey: ['contacts', search, practiceId],
    queryFn: () => listContacts(search, practiceId),
  });
}
