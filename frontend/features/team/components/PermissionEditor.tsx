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
  /**
   * Grantable ACTION permissions from the backend catalog — the capabilities
   * a tab cannot express. Empty/absent hides the section rather than showing
   * an empty heading.
   */
  actions?: Array<{ key: string; label: string }>;
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

// ONE row, used by the tab list and the action list alike. They were written
// separately at first and immediately drifted — different checkbox spacing,
// different reset affordance — which is what makes a screen feel assembled
// rather than designed. The whole row is the hit target, not the 13px label.
function PermRow({
  id,
  label,
  checked,
  pinned,
  note,
  title,
  onToggle,
  onReset,
}: {
  id: string;
  label: string;
  checked: boolean;
  pinned: boolean;
  note?: string;
  title?: string;
  onToggle: (next: boolean) => void;
  onReset: () => void;
}) {
  return (
    <label
      htmlFor={id}
      title={title}
      className="perm-row"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 8px', margin: '0 -8px', borderRadius: 8,
        cursor: 'pointer', minWidth: 0,
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        style={{ accentColor: 'var(--brand)', width: 15, height: 15, flexShrink: 0, cursor: 'pointer' }}
      />
      <span style={{ fontSize: 13, color: 'var(--ink)', minWidth: 0 }}>{label}</span>
      {note && (
        <span className="text-ink-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          {note}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {pinned && (
        <button
          type="button"
          // The label is the row, so a button inside it would toggle the
          // checkbox on its way to its own handler.
          onClick={(e) => { e.preventDefault(); onReset(); }}
          title="Set for this person — reset to follow their role"
          aria-label={`Reset ${label} to follow the role`}
          className="perm-reset"
          style={{
            border: '1px solid var(--border)', background: 'var(--surface)',
            borderRadius: 999, padding: '2px 8px', cursor: 'pointer',
            fontSize: 10.5, color: 'var(--ink-muted)', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          set for this person ↺
        </button>
      )}
    </label>
  );
}

export function PermissionEditor({
  effective,
  overrides,
  roleDefaults,
  patch,
  onChange,
  actions,
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

  // The same search box filters the actions, so a person looking for "export"
  // finds it without knowing whether it is a tab or a capability.
  const actionRows = (actions ?? []).filter(
    (a) => !q || a.label.toLowerCase().includes(q) || a.key.toLowerCase().includes(q),
  );

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
              <div className="perm-reveal" style={{ marginTop: 8, paddingLeft: 52, display: 'grid', gap: 2 }}>
                {matching.map((t) => {
                  const key = pageKey(t.id);
                  return (
                    <PermRow
                      key={t.id}
                      id={`perm-${key}`}
                      label={t.label}
                      checked={valueOf(key)}
                      pinned={isPinned(key)}
                      // Accurate rather than alarming. Granting this tab DOES
                      // open the data behind it; what it cannot do is fence
                      // that data off from the section's other tabs, because
                      // they share one endpoint and the API cannot tell them
                      // apart. Only the denial is nav-deep.
                      note={PAGE_ENFORCED.has(t.id) ? undefined : 'shared data'}
                      title={PAGE_ENFORCED.has(t.id)
                        ? undefined
                        : 'This tab shares its data endpoint with the rest of the section: switching it off hides the tab, but anyone who can open another tab here can still reach the same data.'}
                      onToggle={(next) => onChange(key, next)}
                      onReset={() => onChange(key, null)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* ACTIONS — the half of the matrix this screen could not reach.
          A tab grants a place to look; these grant a thing to DO, and several
          of them (approving payroll, exporting raw data, editing the team)
          have no tab at all. They were defined in the catalog, checked by the
          API, and grantable nowhere — which is why routes that needed them
          were still written as "owner only". They are listed last because
          most people need none of them. */}
      {actionRows.length > 0 && (
        <div id={sectionAnchor('Actions')} style={{ padding: '14px 0', scrollMarginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Toggle
              on={actionRows.some((a) => valueOf(a.key))}
              onChange={(next) => { for (const a of actionRows) onChange(a.key, next); }}
              label="All actions"
            />
            <span className="display" style={{ fontSize: 15, fontWeight: 600 }}>Actions</span>
            <span className="text-ink-muted" style={{ fontSize: 11 }}>
              {actionRows.filter((a) => valueOf(a.key)).length} of {actionRows.length} granted
            </span>
          </div>
          <p className="text-ink-muted" style={{ fontSize: 12, margin: '6px 0 10px', paddingLeft: 52 }}>
            Things this person may do, rather than pages they may open — off for
            everyone but the owner until you grant them.
          </p>
          <div style={{ paddingLeft: 52 }}>
          <div style={{ display: 'grid', gap: 2 }}>
            {actionRows.map(({ key, label }) => (
              <PermRow
                key={key}
                id={`perm-${key}`}
                label={label}
                checked={valueOf(key)}
                pinned={isPinned(key)}
                title={key}
                onToggle={(next) => onChange(key, next)}
                onReset={() => onChange(key, null)}
              />
            ))}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
