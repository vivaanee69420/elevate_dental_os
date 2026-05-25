import { api } from '@/lib/api';

export function listContacts(search: string, practiceId?: string | null) {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  return api(`/api/contacts?search=${encodeURIComponent(search)}&limit=200${pp}`);
}
