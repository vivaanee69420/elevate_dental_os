'use client';
// Per-page practice filter. value=null => "All practices" (org-wide). Renders
// nothing when the org has 0-1 practices (no point in a single tab). Tabs are
// built dynamically from GET /api/practices.
import { usePractices } from './hooks';

interface Props {
  value: string | null;
  onChange: (practiceId: string | null) => void;
  // Dentally-mapped sites only (pms_site_id set). GoHighLevel auto-creates
  // pms_site_id-null pseudo-practices for CRM scoping — pass this on analytics /
  // finance pages to drop them. Business Hub leaves it off to keep all.
  dentallyOnly?: boolean;
}

export default function PracticeTabs({ value, onChange, dentallyOnly = false }: Props) {
  const { data } = usePractices();
  const all: { id: string; name: string; pms_site_id: string | null }[] = data?.practices ?? [];
  const practices = dentallyOnly ? all.filter((p) => p.pms_site_id != null) : all;
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
