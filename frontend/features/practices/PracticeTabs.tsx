'use client';
// Per-page practice filter. value=null => "All practices" (org-wide). Renders
// nothing when the org has 0-1 practices (no point in a single tab). Tabs are
// built dynamically from GET /api/practices.
import { usePractices } from './hooks';

interface Props {
  value: string | null;
  onChange: (practiceId: string | null) => void;
}

export default function PracticeTabs({ value, onChange }: Props) {
  const { data } = usePractices();
  const practices: { id: string; name: string }[] = data?.practices ?? [];
  if (practices.length <= 1) return null;

  const tab = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: active ? 'var(--brand)' : 'white',
    color: active ? 'white' : 'var(--ink)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <button style={tab(value === null)} onClick={() => onChange(null)}>
        All practices
      </button>
      {practices.map((p) => (
        <button key={p.id} style={tab(value === p.id)} onClick={() => onChange(p.id)}>
          {p.name}
        </button>
      ))}
    </div>
  );
}
