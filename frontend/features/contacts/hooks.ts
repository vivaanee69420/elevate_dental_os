import { useQuery } from '@tanstack/react-query';
import { listContacts } from './api';

export function useContacts(search: string, practiceId: string | null = null, source: string | null = null) {
  return useQuery({
    queryKey: ['contacts', search, practiceId, source],
    queryFn: () => listContacts(search, practiceId, source),
  });
}
