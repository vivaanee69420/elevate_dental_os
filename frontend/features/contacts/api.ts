import { api } from '@/lib/api';

// source filters by integration origin ('dentally' | 'gohighlevel') for the
// Dentally / GHL contact tabs; omit for all contacts.
export function listContacts(search: string, practiceId?: string | null, source?: string | null) {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  const ss = source ? `&source=${encodeURIComponent(source)}` : '';
  return api(`/api/contacts?search=${encodeURIComponent(search)}&limit=200${pp}${ss}`);
}
