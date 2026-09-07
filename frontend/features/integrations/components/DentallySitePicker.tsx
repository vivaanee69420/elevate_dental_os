'use client';
// Which Dentally practices this account pulls.
//
// A Dentally login covers the whole group, so connecting it inside a
// sub-account hands us a token that can read every practice in it. Connecting
// used to start pulling immediately: in one live case that put 9,446 patients
// and 21,800 appointments from four other practices into an account meant to
// hold one. The sync now stops here and waits for an answer.
//
// It renders only while that answer is outstanding, or when someone opens it
// to change a previous one — an account with a single practice is never asked,
// because there is nothing to choose.

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDentallySites, selectDentallySites, type DentallySite } from '../api';
import { useSyncToast } from '../sync-toast';

export function DentallySitePicker() {
  const qc = useQueryClient();
  const { start: startSyncToast } = useSyncToast();
  const { data, isLoading, error } = useQuery({
    queryKey: ['integrations', 'dentally', 'sites'],
    queryFn: getDentallySites,
    staleTime: 60_000,
  });

  const [picked, setPicked] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);

  // Seed the tick boxes from the server once, then leave them to the user.
  useEffect(() => {
    if (data && picked === null) {
      setPicked(data.selected ?? data.sites.map((s) => s.site_id));
    }
  }, [data, picked]);

  if (isLoading) return null;
  if (error) {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--danger, #b91c1c)', marginTop: 8 }}>
        Could not load the Dentally practice list: {(error as Error).message}
      </p>
    );
  }
  if (!data) return null;

  // Nothing to decide: one practice on the login, and it is already chosen.
  if (data.sites.length < 2 && !data.awaiting) return null;
  // Answered already — offer a way back in, but stay out of the way.
  if (!data.awaiting && !editing) {
    const chosen = data.selected;
    return (
      <div style={{ marginTop: 12, fontSize: 12.5 }} className="text-ink-muted">
        Pulling{' '}
        <strong className="text-ink">
          {chosen === null
            ? 'every practice on this Dentally login'
            : `${chosen.length} of ${data.sites.length} practices`}
        </strong>
        .{' '}
        <button
          type="button"
          className="text-brand hover:underline"
          onClick={() => setEditing(true)}
        >
          Change
        </button>
      </div>
    );
  }

  const sel = picked ?? [];
  const toggle = (id: string) =>
    setPicked(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);

  async function save() {
    if (sel.length === 0) return;
    setSaving(true);
    setErr('');
    try {
      await selectDentallySites(sel);
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ['integrations'] });
      // Saving starts the pull that was held back, so show it landing.
      startSyncToast('dentally');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 12,
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 14,
        background: 'var(--bg)',
      }}
    >
      <h4 style={{ fontSize: 14, fontWeight: 600 }} className="text-ink">
        Which practices should this account pull?
      </h4>
      <p className="text-ink-muted" style={{ fontSize: 12.5, marginTop: 3 }}>
        This Dentally login can read {data.sites.length} practices. Only the ones you tick will
        have their patients, appointments and payments brought into this account. Nothing is
        pulled until you choose.
      </p>

      <ul style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {data.sites.map((s: DentallySite) => (
          <li key={s.site_id}>
            <label
              className="hover:bg-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '7px 8px',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={sel.includes(s.site_id)}
                onChange={() => toggle(s.site_id)}
              />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  className="text-ink"
                  style={{ display: 'block', fontSize: 13, fontWeight: 500 }}
                >
                  {s.name || 'Unnamed practice'}
                </span>
                {/* The id is shown because two sites can share a name, and it is
                    what the practice mapping below is keyed on. */}
                <span
                  className="text-ink-muted"
                  style={{ display: 'block', fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }}
                >
                  {s.site_id}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {err && (
        <p style={{ fontSize: 12.5, marginTop: 8, color: 'var(--danger, #b91c1c)' }}>{err}</p>
      )}

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={save}
          disabled={saving || sel.length === 0}
          className="btn-primary"
          style={{ opacity: saving || sel.length === 0 ? 0.5 : 1 }}
        >
          {saving ? 'Starting…' : `Pull ${sel.length === 1 ? 'this practice' : `these ${sel.length}`}`}
        </button>
        {sel.length === 0 && (
          <span className="text-ink-muted" style={{ fontSize: 12 }}>
            Tick at least one — an account that pulls nothing is a disconnected one.
          </span>
        )}
        {editing && (
          <button
            type="button"
            className="text-ink-muted hover:text-ink"
            style={{ fontSize: 12.5 }}
            onClick={() => {
              setEditing(false);
              setPicked(data.selected ?? data.sites.map((s) => s.site_id));
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
