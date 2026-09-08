'use client';
// The practice's chairs. These used to be free text on every grid row, so the
// chair count was DISTINCT chair_name — meaning "Surgery 1" and "Surgery 1 "
// were two chairs and the practice's capacity silently doubled. They are rows
// now, so a rename keeps its history and a duplicate is refused.

import { useState } from 'react';
import type { ChairWeek } from '../chair-entry-api';

export function ChairsPanel({
  chairs, selectedId, onSelect, onAdd, onRename, onRetire, busy, error,
}: {
  chairs: ChairWeek['chairs'];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRetire: (id: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    // NOT a disabled button. A disabled control that looks enabled just does
    // nothing when clicked and explains nothing — and the placeholder reads
    // like a filled-in default, so "Add chair" on an empty box is the obvious
    // thing to try. Say what is needed instead of silently refusing.
    if (!name) {
      setHint('Type a name for the chair first — for example, Surgery 1.');
      return;
    }
    setHint(null);
    onAdd(name);
    setNewName('');
  }

  function commitRename(e: React.FormEvent) {
    e.preventDefault();
    const name = renameValue.trim();
    if (!name || !renamingId) return;
    onRename(renamingId, name);
    setRenamingId(null);
  }

  return (
    <div className="card-padded" style={{ marginBottom: 16 }}>
      <h2 className="display font-bold" style={{ fontSize: 17, marginBottom: 4 }}>Chairs</h2>
      <p className="text-ink-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        One row per surgery. Renaming a chair keeps everything already entered against it.
      </p>

      {chairs.length === 0 && (
        <p className="text-ink-muted" style={{ fontSize: 13, marginBottom: 12 }}>
          No chairs yet. Add your first surgery below to start entering its week.
        </p>
      )}

      {chairs.length > 0 && (
        <div className="flex flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
          {chairs.map((c) => {
            const selected = c.id === selectedId;
            return (
              <div key={c.id} className="flex items-center" style={{ gap: 4 }}>
                {renamingId === c.id ? (
                  <form onSubmit={commitRename} className="flex items-center" style={{ gap: 4 }}>
                    <input
                      autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                      aria-label={`Rename ${c.name}`}
                      style={{ fontSize: 12, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', width: 130 }}
                    />
                    <button type="submit" className="btn-ghost" style={{ fontSize: 12 }}>Save</button>
                    <button type="button" className="btn-ghost" style={{ fontSize: 12 }}
                      onClick={() => setRenamingId(null)}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <button type="button" onClick={() => onSelect(c.id)}
                      aria-pressed={selected}
                      style={{
                        fontSize: 13, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                        border: `1px solid ${selected ? 'var(--brand)' : 'var(--border)'}`,
                        background: selected ? 'var(--brand)' : 'transparent',
                        color: selected ? '#fff' : 'inherit',
                        fontWeight: selected ? 600 : 400,
                      }}>
                      {c.name}
                    </button>
                    <button type="button" className="btn-ghost" style={{ fontSize: 11 }}
                      onClick={() => { setRenamingId(c.id); setRenameValue(c.name); }}>
                      Rename
                    </button>
                    <button type="button" className="btn-ghost" style={{ fontSize: 11, color: '#991B1B' }}
                      onClick={() => onRetire(c.id)}>
                      Retire
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={add} className="flex items-center" style={{ gap: 8 }}>
        <input
          value={newName}
          onChange={(e) => { setNewName(e.target.value); if (hint) setHint(null); }}
          // "e.g." so the placeholder cannot be mistaken for a filled-in value.
          placeholder="e.g. Surgery 1"
          aria-label="New chair name"
          style={{ fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', width: 200 }}
        />
        <button
          type="submit"
          className="btn-ghost"
          // Disabled ONLY while a save is in flight, never for an empty box —
          // that case is answered with words above.
          disabled={busy}
          style={{
            fontSize: 13, border: '1px solid var(--border)', padding: '8px 14px',
            borderRadius: 8, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Adding…' : 'Add chair'}
        </button>
      </form>

      {hint && <div className="text-ink-muted" style={{ fontSize: 13, marginTop: 10 }}>{hint}</div>}
      {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</div>}
    </div>
  );
}
