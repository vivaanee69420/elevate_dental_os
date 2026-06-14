import { useQuery } from '@tanstack/react-query';
import { listContacts } from './api';

export function useContacts(
  search: string,
  practiceId: string | null = null,
  source: string | null = null,
  page = 1,
  limit = 50,
  integrationAccountId: string | null = null,
) {
  return useQuery({
    queryKey: ['contacts', search, practiceId, source, page, limit, integrationAccountId],
    queryFn: () => listContacts(search, practiceId, source, page, limit, integrationAccountId),
    placeholderData: (prev) => prev, // keep prior page visible while the next loads
  });
}
