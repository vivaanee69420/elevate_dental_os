import { api } from '@/lib/api';

export interface ContactsListResponse {
  contacts: any[];
  total: number;
  page: number;
  limit: number;
}

// source filters by integration origin ('dentally' | 'gohighlevel') for the
// Dentally / GHL contact tabs; omit for all contacts. Paginated via page+limit.
export function listContacts(
  search: string,
  practiceId?: string | null,
  source?: string | null,
  page = 1,
  limit = 50,
) {
  const pp = practiceId ? `&practice_id=${practiceId}` : '';
  const ss = source ? `&source=${encodeURIComponent(source)}` : '';
  return api<ContactsListResponse>(
    `/api/contacts?search=${encodeURIComponent(search)}&limit=${limit}&page=${page}${pp}${ss}`,
  );
}
