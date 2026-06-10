'use client';

// Review-source manager (owner-only). Connect each practice's Google Business
// listing (search by name → place_id, via the Places API) and Facebook Page
// (from the connected Meta account), assign it to a practice, pick which feed
// the Reviews screen, and trigger a live pull. This IS the "accounts" the filter
// bar slices by. Google needs GOOGLE_PLACES_API_KEY; Facebook reuses the Meta
// connection (page scopes pending App Review → it lists pages once granted).

import { useState } from 'react';
import { Card, Chip } from '@/components/ui';
import { usePractices } from '@/features/integrations/hooks';
import {
  useReviewSources,
  useSearchReviewSources,
  useAddReviewSource,
  useRemoveReviewSource,
  useSetReviewSourcePractice,
  useSetReviewSourceSelection,
  useTriggerReviewsSync,
  useReviewsSyncProgress,
} from '../reviewsHooks';
import type { ReviewProvider, ReviewSearchResult, ReviewSource } from '../reviewsApi';

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontSize: 12, color: 'var(--brand)', fontWeight: 600,
};

export default function ReviewSourcesPanel({ onClose }: { onClose?: () => void }) {
  const { data, isLoading } = useReviewSources();
  const { data: practicesData } = usePractices();
  const practices = practicesData?.practices ?? [];
  const sources = data?.sources ?? [];

  const setPractice = useSetReviewSourcePractice();
  const setSelection = useSetReviewSourceSelection();
  const remove = useRemoveReviewSource();
  const triggerSync = useTriggerReviewsSync();
  const [syncing, setSyncing] = useState(false);
  const progress = useReviewsSyncProgress(syncing);

  // Stop polling once the run completes.
  if (syncing && progress.data?.done) setTimeout(() => setSyncing(false), 1500);

  function toggleSelected(s: ReviewSource) {
    const next = sources.filter((x) => (x.id === s.id ? !x.is_selected : x.is_selected)).map((x) => x.id);
    setSelection.mutate(next);
  }

  function runSync() {
    setSyncing(true);
    triggerSync.mutate();
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h2 className="display font-semibold" style={{ fontSize: 17 }}>Review sources</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={runSync} disabled={triggerSync.isPending || syncing} style={linkBtn}>
            {syncing ? `Syncing… ${progress.data?.pct ?? 0}%` : 'Sync now'}
          </button>
          {onClose && <button onClick={onClose} style={linkBtn}>Close</button>}
        </div>
      </div>
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Connect each practice&rsquo;s Google listing and Facebook page. Untick a source to hide it from
        the dashboards (its synced reviews are kept). Google returns up to ~5 recent reviews plus the
        overall rating &amp; total count; replies are recorded here only (Google/Facebook are read-only).
      </p>

      {isLoading ? (
        <p className="text-ink-muted" style={{ fontSize: 13 }}>Loading…</p>
      ) : sources.length === 0 ? (
        <p className="text-ink-muted" style={{ fontSize: 13, marginBottom: 12 }}>
          No sources yet — add one below.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {sources.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
              }}
            >
              <input type="checkbox" checked={s.is_selected} onChange={() => toggleSelected(s)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name || s.external_id}
                  </strong>
                  <Chip colour={s.provider === 'google' ? 'blue' : 'brand'}>
                    {s.provider === 'google' ? 'Google' : 'Facebook'}
                  </Chip>
                  {s.rating != null && (
                    <span className="text-ink-muted" style={{ fontSize: 11 }}>
                      {s.rating} {'★'} · {(s.total_count ?? 0).toLocaleString('en-GB')}
                    </span>
                  )}
                </div>
                {s.last_error && (
                  <div style={{ fontSize: 11, color: 'var(--danger, #c0392b)', marginTop: 2 }}>
                    {s.last_error}
                  </div>
                )}
              </div>
              <select
                value={s.practice_id ?? ''}
                onChange={(e) => setPractice.mutate({ id: s.id, practiceId: e.target.value || null })}
                style={{ fontSize: 12, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }}
              >
                <option value="">Unassigned</option>
                {practices.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button onClick={() => remove.mutate(s.id)} style={{ ...linkBtn, color: 'var(--ink-muted)' }}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <AddSourceForm practices={practices} />
    </Card>
  );
}

function AddSourceForm({ practices }: { practices: { id: string; name: string }[] }) {
  const [provider, setProvider] = useState<ReviewProvider>('google');
  const [query, setQuery] = useState('');
  const [practiceId, setPracticeId] = useState('');
  const search = useSearchReviewSources();
  const add = useAddReviewSource();
  const results: ReviewSearchResult[] = search.data?.results ?? [];

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    search.mutate({ provider, q: query });
  }

  function addResult(r: ReviewSearchResult) {
    add.mutate({
      provider,
      external_id: r.place_id,
      name: r.name,
      address: r.address,
      practice_id: practiceId || null,
    });
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <h3 className="display" style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Add a source</h3>
      <form onSubmit={submitSearch} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={provider}
          onChange={(e) => { setProvider(e.target.value as ReviewProvider); search.reset(); }}
          style={{ fontSize: 13, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
        >
          <option value="google">Google</option>
          <option value="facebook">Facebook</option>
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={provider === 'google' ? 'Search business name + town…' : 'Filter your Facebook pages…'}
          style={{ flex: 1, minWidth: 200, fontSize: 13, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
        />
        <select
          value={practiceId}
          onChange={(e) => setPracticeId(e.target.value)}
          style={{ fontSize: 13, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
        >
          <option value="">Assign practice…</option>
          {practices.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={search.isPending} style={{ fontSize: 13 }}>
          {search.isPending ? 'Searching…' : 'Search'}
        </button>
      </form>

      {search.isError && (
        <p style={{ fontSize: 12, color: 'var(--danger, #c0392b)', marginTop: 8 }}>
          {(search.error as Error)?.message || 'Search failed'}
        </p>
      )}

      {search.isSuccess && results.length === 0 && (
        <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 8 }}>No matches.</p>
      )}

      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {results.map((r) => (
            <div
              key={r.place_id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{r.name || r.place_id}</strong>
                {r.address && (
                  <div className="text-ink-muted" style={{ fontSize: 11 }}>{r.address}</div>
                )}
              </div>
              {r.rating != null && (
                <span className="text-ink-muted" style={{ fontSize: 11 }}>
                  {r.rating} {'★'} · {(r.total_count ?? 0).toLocaleString('en-GB')}
                </span>
              )}
              <button
                onClick={() => addResult(r)}
                className="btn btn-primary"
                disabled={add.isPending}
                style={{ fontSize: 12, padding: '6px 12px' }}
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
