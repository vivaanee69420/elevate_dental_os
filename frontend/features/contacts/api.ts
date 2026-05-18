import { api } from '@/lib/api';

export function listContacts(search: string) {
  return api(`/api/contacts?search=${encodeURIComponent(search)}&limit=200`);
}
