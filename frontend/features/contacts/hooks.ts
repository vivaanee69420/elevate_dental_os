import { useQuery } from '@tanstack/react-query';
import { listContacts } from './api';

export function useContacts(search: string) {
  return useQuery({
    queryKey: ['contacts', search],
    queryFn: () => listContacts(search),
  });
}
