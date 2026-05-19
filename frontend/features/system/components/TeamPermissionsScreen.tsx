'use client';
// System — Team Permissions. Pixel-faithful port of
// preview/elevate-dental-os-v2.html PAGES['team-permissions'].
//
// State model (local, no API — mirrors the prototype's localStorage):
//   perms = { practice_manager: string[], reception: string[] }
//   showMinor (All pages / Big picture only)
//
// Render pipeline:
//   PAGE_META -> group by section -> SECTION_ORDER
//     -> per section, filter (showMinor ? all : major)
//       -> rows with two toggles (PM blue, Reception green);
//          owner-only pages render a locked indicator instead.
//
// Toggling never grants an owner-only page (project rule 5: Wealth /
// owner-only stay owner-only). Prototype emoji glyphs dropped per rule 7.
import { useMemo, useState } from 'react';
import {
  PAGE_META,
  DEFAULT_PM_PAGES,
  DEFAULT_RECEPTION_PAGES,
  SECTION_COLOURS,
  SECTION_ORDER,
} from '../data';

const TEAL = '#0E7C7B';
const PM_BLUE = '#3B82F6';
const REC_GREEN = '#10B981';

/** Role -> granted page-id list. */
interface Perms {
  practice_manager: string[];
  reception: string[];
}

/** A small accessible toggle switch (prototype renderToggle). */
function Toggle({
  on,
  colour,
  onChange,
}: {
  on: boolean;
  colour: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        position: 'relative',
        display: 'inline-block',
        width: 40,
        height: 22,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        style={{ opacity: 0, width: 0, height: 0 }}
      />
      <span
        style={{
          position: 'absolute',
          cursor: 'pointer',
          inset: 0,
          background: on ? colour : '#cbd5e0',
          transition: '0.2s',
          borderRadius: 22,
        }}
      >
        <span
          style={{
            position: 'absolute',
            height: 16,
            width: 16,
            left: on ? 21 : 3,
            bottom: 3,
            background: 'white',
            transition: '0.2s',
            borderRadius: '50%',
            display: 'block',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          }}
        />
      </span>
    </label>
  );
}

/** Team Permissions screen. */
export default function TeamPermissionsScreen() {
  const [perms, setPerms] = useState<Perms>({
    practice_manager: [...DEFAULT_PM_PAGES],
    reception: [...DEFAULT_RECEPTION_PAGES],
  });
  const [showMinor, setShowMinor] = useState(true);

  // Group pages by section (declaration order within each section).
  const grouped = useMemo(() => {
    const g: Record<string, typeof PAGE_META> = {};
    PAGE_META.forEach((p) => {
      (g[p.section] ??= []).push(p);
    });
    return g;
  }, []);

  const totalNonOwnerPages = PAGE_META.filter((p) => !p.ownerOnly).length;
  const pmCount = perms.practice_manager.length;
  const recCount = perms.reception.length;

  /** Toggle a single page for a single role (owner-only guarded). */
  function togglePage(
    role: 'practice_manager' | 'reception',
    pageId: string,
    value: boolean,
  ) {
    const meta = PAGE_META.find((p) => p.id === pageId);
    if (meta?.ownerOnly) return; // never grant owner-only pages
    setPerms((prev) => {
      const list = prev[role];
      const next = value
        ? list.includes(pageId)
          ? list
          : [...list, pageId]
        : list.filter((p) => p !== pageId);
      return { ...prev, [role]: next };
    });
  }

  /** Bulk-set every non-owner page for the Practice Manager. */
  function bulkPm(action: 'all' | 'none') {
    setPerms((prev) => ({
      ...prev,
      practice_manager:
        action === 'all'
          ? PAGE_META.filter((p) => !p.ownerOnly).map((p) => p.id)
          : [],
    }));
  }

  /** Restore both roles to their default starter grants. */
  function resetDefaults() {
    setPerms({
      practice_manager: [...DEFAULT_PM_PAGES],
      reception: [...DEFAULT_RECEPTION_PAGES],
    });
  }

  /** Pill-style control button (prototype controls bar). */
  const ctrlBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    background: active ? TEAL : 'white',
    color: active ? 'white' : 'var(--ink)',
  });

  const plainBtn: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    background: 'white',
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Team Permissions
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Tick which pages each role can see · Wealth pages are owner-only
          forever
        </p>
      </div>

      {/* Summary card */}
      <div
        className="card-padded"
        style={{
          background: 'linear-gradient(135deg, #0E7C7B 0%, #085857 100%)',
          color: 'white',
          border: 'none',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 24,
            textAlign: 'center',
          }}
        >
          <div>
            <div className="display font-bold" style={{ marginTop: 4 }}>
              Owner
            </div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              Sees everything always
            </div>
          </div>
          <div
            style={{
              borderLeft: '1px solid rgba(255,255,255,0.2)',
              borderRight: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            <div className="display font-bold" style={{ marginTop: 4 }}>
              Practice Manager
            </div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              {pmCount} of {totalNonOwnerPages} pages
            </div>
          </div>
          <div>
            <div className="display font-bold" style={{ marginTop: 4 }}>
              Reception
            </div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              {recCount} of {totalNonOwnerPages} pages
            </div>
          </div>
        </div>
      </div>

      {/* Controls bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span
            className="text-ink-muted"
            style={{
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            View:
          </span>
          <button
            onClick={() => setShowMinor(true)}
            style={ctrlBtn(showMinor)}
          >
            All pages
          </button>
          <button
            onClick={() => setShowMinor(false)}
            style={ctrlBtn(!showMinor)}
          >
            Big picture only
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => bulkPm('all')} style={plainBtn}>
            Grant all to PM
          </button>
          <button onClick={() => bulkPm('none')} style={plainBtn}>
            Revoke all from PM
          </button>
          <button onClick={resetDefaults} style={plainBtn}>
            Reset to defaults
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div
        className="card text-ink-muted"
        style={{
          padding: '10px 16px',
          marginBottom: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 90px 90px',
          gap: 12,
          alignItems: 'center',
          background: 'var(--bg)',
          borderRadius: '10px 10px 0 0',
          borderBottom: '2px solid var(--border)',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 700,
        }}
      >
        <div>Page</div>
        <div style={{ textAlign: 'center', color: PM_BLUE }}>Manager</div>
        <div style={{ textAlign: 'center', color: REC_GREEN }}>
          Reception
        </div>
      </div>

      {/* Permission sections */}
      {SECTION_ORDER.map((sectionName) => {
        const pages = grouped[sectionName] || [];
        const filtered = showMinor
          ? pages
          : pages.filter((p) => p.importance === 'major');
        if (filtered.length === 0) return null;
        const meta = SECTION_COLOURS[sectionName];
        const isOwnerOnlySection = sectionName === 'Wealth';

        return (
          <div
            key={sectionName}
            className="card"
            style={{
              marginBottom: 10,
              borderLeft: `4px solid ${meta.colour}`,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '10px 14px',
                background: meta.bg,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span
                className="display"
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: meta.colour,
                }}
              >
                {sectionName}
              </span>
              {isOwnerOnlySection && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '3px 8px',
                    background: 'white',
                    color: meta.colour,
                    borderRadius: 4,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Owner only
                </span>
              )}
            </div>
            {filtered.map((page) => {
              const isOwnerOnlyPage = !!page.ownerOnly;
              const pmAllowed = perms.practice_manager.includes(page.id);
              const recAllowed = perms.reception.includes(page.id);
              return (
                <div
                  key={page.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 90px 90px',
                    gap: 12,
                    alignItems: 'center',
                    padding: '9px 14px',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 13 }}>{page.label}</span>
                    {page.importance === 'minor' && (
                      <span
                        className="text-ink-muted"
                        style={{
                          fontSize: 9,
                          padding: '2px 6px',
                          background: 'var(--bg)',
                          borderRadius: 3,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        minor
                      </span>
                    )}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    {isOwnerOnlyPage ? (
                      <span
                        className="text-ink-muted"
                        style={{ fontSize: 11, opacity: 0.6 }}
                        title="Owner only"
                      >
                        Owner
                      </span>
                    ) : (
                      <Toggle
                        on={pmAllowed}
                        colour={PM_BLUE}
                        onChange={(v) =>
                          togglePage('practice_manager', page.id, v)
                        }
                      />
                    )}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    {isOwnerOnlyPage ? (
                      <span
                        className="text-ink-muted"
                        style={{ fontSize: 11, opacity: 0.6 }}
                        title="Owner only"
                      >
                        Owner
                      </span>
                    ) : (
                      <Toggle
                        on={recAllowed}
                        colour={REC_GREEN}
                        onChange={(v) =>
                          togglePage('reception', page.id, v)
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* How this works */}
      <div
        className="card-padded"
        style={{ marginTop: 16, background: 'var(--brand-50)' }}
      >
        <strong style={{ fontSize: 14 }}>How this works</strong>
        <p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
          Tick any page for either role and it appears in their sidebar
          immediately. Untick to remove access.{' '}
          <strong>Wealth pages stay owner-only</strong> (you&apos;d never
          want a team member seeing your personal pensions/property). Use
          &quot;Big picture only&quot; to focus on the major pages and skip
          the minor ones. Test by switching role in the sidebar at the
          bottom left.
        </p>
      </div>
    </div>
  );
}
