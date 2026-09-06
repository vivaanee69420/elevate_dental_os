'use client';
// Per-person tab access. One row per nav SECTION: a master toggle that reveals
// that section's tabs as checkboxes, so access is granted a tab at a time
// rather than a whole area at a time.
//
// Why tabs and not capability keys: every screen in this product is a tab
// inside a section, and that is the unit people actually think in ("can she
// see Patient Payments?"). The backend already stores a `page:<id>` override
// per tab, resolved ABOVE the section's own permission key, so a tick here is
// the real boundary and not a nav-only cosmetic — except where a tab shares
// its data endpoint with the rest of its section, which is labelled.
//
// A pinned tab is one where this person has been singled out; it is marked,
// with a reset that puts it back to following their role. Showing pinned and
// inherited alike would hide the fact that someone has an exception.
import { useMemo, useState } from 'react';
import { NAV } from '@/lib/nav';
import { pageKey, PAGE_ENFORCED } from '@/lib/permissions';

export interface PermissionEditorProps {
  /** Fully resolved map for this person, before any unsaved edits. */
  effective: Record<string, boolean>;
  /** Keys explicitly pinned on this person, before any unsaved edits. */
  overrides: Record<string, boolean>;
  /**
   * Fully resolved defaults for the role currently selected in the form — the
   * baseline a reset previews against, before any save/refetch.
   */
  roleDefaults: Record<string, boolean>;
  /** Unsaved edits. null means "unpin". */
  patch: Record<string, boolean | null>;
  onChange: (key: string, value: boolean | null) => void;
  /** Search text, owned by the parent so the section list can filter with it. */
  search: string;
  onSearchChange: (next: string) => void;
}

/** Stable DOM id for a section, so the left column can scroll to it. */
export const sectionAnchor = (label: string) =>
  `perm-section-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        position: 'relative',
        width: 40,
        height: 22,
        flexShrink: 0,
        borderRadius: 22,
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        background: on ? 'var(--brand)' : '#cbd5e0',
        transition: 'background 0.2s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          height: 16,
          width: 16,
          left: on ? 21 : 3,
          top: 3,
          background: '#FFFFFF',
          borderRadius: '50%',
          transition: 'left 0.2s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          display: 'block',
        }}
      />
    </button>
  );
}

export function PermissionEditor({
  effective,
  overrides,
  roleDefaults,
  patch,
  onChange,
  search,
  onSearchChange,
}: PermissionEditorProps) {
  // Sections that the toggle has been opened for in this session, so a section
  // whose tabs are all off can still be opened and granted one tab.
  const [forcedOpen, setForcedOpen] = useState<Record<string, boolean>>({});

  const sections = useMemo(
    () => NAV.map((s) => ({ label: s.label, tabs: s.items.map((i) => ({ id: i.id, label: i.label })) })),
    [],
  );

  /** Current value of a tab key, unsaved edits first. */
  const valueOf = (key: string): boolean => {
    const p = patch[key];
    if (p === undefined) return effective[key] === true;
    // A reset previews the ROLE's baseline: `effective` is still the
    // pre-reset, overridden value until a save and refetch.
    if (p === null) return roleDefaults[key] === true;
    return p === true;
  };

  /** True when this person has been singled out on this tab. */
  const isPinned = (key: string): boolean =>
    patch[key] === undefined ? overrides[key] !== undefined : patch[key] !== null;

  const q = search.trim().toLowerCase();

  return (
    <div>
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search"
        aria-label="Search tabs"
        className="input w-full mb-5"
      />

      {sections.map(({ label, tabs }) => {
        const matching = q
          ? tabs.filter(
              (t) => t.label.toLowerCase().includes(q) || label.toLowerCase().includes(q),
            )
          : tabs;
        if (matching.length === 0) return null;

        const granted = tabs.filter((t) => valueOf(pageKey(t.id))).length;
        // Open when anything is granted, when the search put the user here, or
        // when they opened it deliberately — otherwise a fully-denied section
        // could never be granted its first tab.
        const open = granted > 0 || !!forcedOpen[label] || !!q;

        const setAll = (next: boolean) => {
          setForcedOpen((f) => ({ ...f, [label]: next }));
          for (const t of tabs) onChange(pageKey(t.id), next);
        };

        return (
          <div
            key={label}
            id={sectionAnchor(label)}
            style={{ borderBottom: '1px solid var(--border)', padding: '14px 0', scrollMarginTop: 12 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Toggle
                on={granted > 0}
                onChange={setAll}
                label={`All ${label} tabs`}
              />
              <span className="display" style={{ fontSize: 15, fontWeight: 600 }}>
                {label}
              </span>
              <span className="text-ink-muted" style={{ fontSize: 11 }}>
                {granted} of {tabs.length} tabs
              </span>
            </div>

            {open && (
              <div style={{ marginTop: 10, paddingLeft: 52, display: 'grid', gap: 8 }}>
                {matching.map((t) => {
                  const key = pageKey(t.id);
                  const pinned = isPinned(key);
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        id={`perm-${key}`}
                        checked={valueOf(key)}
                        onChange={(e) => onChange(key, e.target.checked)}
                      />
                      <label htmlFor={`perm-${key}`} style={{ fontSize: 13 }}>
                        {t.label}
                      </label>
                      {!PAGE_ENFORCED.has(t.id) && (
                        <span
                          title="This tab shares its data endpoint with others in the section, so turning it off hides the tab but does not block the data."
                          style={{
                            fontSize: 9,
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: '#FEF3C7',
                            color: '#92400E',
                          }}
                        >
                          nav only
                        </span>
                      )}
                      {pinned && (
                        <button
                          type="button"
                          onClick={() => onChange(key, null)}
                          title="Set for this person — reset to follow their role"
                          aria-label={`Reset ${t.label} to follow the role`}
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            fontSize: 11,
                            color: 'var(--ink-muted)',
                          }}
                        >
                          ↺ set for this person
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
