'use client';
// System — Team Permissions. Visual port of
// preview/elevate-dental-os-v2.html PAGES['team-permissions'], now wired to
// the live dynamic-RBAC backend.
//
// Data:
//   GET /api/admin/permissions  -> { catalog: {key:label}, roles:{...} }
//   PUT /api/admin/permissions/role { role, permission_key, allowed }
//
// Owner column is always-on (the backend keeps Owner full-access). Toggling
// a cell PUTs the change and optimistically updates the React Query cache.
// Owner-only screen — also gated server-side by permissions.manage and
// hidden from nav for non-holders.
import { useMemo } from 'react';
import { usePermissionsMatrix, useSetRolePermission } from '../hooks';
import { SECTION_COLOURS } from '../data';

const PM_BLUE = '#3B82F6';
const REC_GREEN = '#10B981';

/**
 * Visual grouping of catalogue permission keys into the prototype's coloured
 * sections. Keys absent here fall into "System".
 */
const KEY_SECTION: Record<string, string> = {
  'finance.view': 'Finance',
  'valuation.view': 'Finance',
  'businesshealth.manage': 'Business Health',
  'operations.view': 'Operations',
  'intelligence.view': 'Intelligence',
  'growth.view': 'Growth',
  'crm.view': 'Elevate CRM',
  'crm.manage': 'Elevate CRM',
  'wealth.view': 'Wealth',
  'training.view': 'Training',
  'system.manage': 'System',
  'users.invite': 'System',
  'users.manage': 'System',
  'permissions.manage': 'System',
};

const SECTION_ORDER = [
  'Finance',
  'Business Health',
  'Operations',
  'Intelligence',
  'Growth',
  'Elevate CRM',
  'Wealth',
  'Training',
  'System',
];

/** A small accessible toggle switch (prototype renderToggle). */
function Toggle({
  on,
  colour,
  disabled,
  onChange,
}: {
  on: boolean;
  colour: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        position: 'relative',
        display: 'inline-block',
        width: 40,
        height: 22,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ opacity: 0, width: 0, height: 0 }}
      />
      <span
        style={{
          position: 'absolute',
          cursor: disabled ? 'not-allowed' : 'pointer',
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
  const { data, isLoading, isError, error } = usePermissionsMatrix();
  const setRole = useSetRolePermission();

  // Group catalogue keys into the prototype's coloured sections, preserving
  // catalogue declaration order within each section.
  const grouped = useMemo(() => {
    const g: Record<string, { key: string; label: string }[]> = {};
    if (data) {
      Object.entries(data.catalog).forEach(([key, label]) => {
        const section = KEY_SECTION[key] || 'System';
        (g[section] ??= []).push({ key, label });
      });
    }
    return g;
  }, [data]);

  const totalPerms = data ? Object.keys(data.catalog).length : 0;
  const pmCount = data
    ? Object.values(data.roles.practice_manager).filter(Boolean).length
    : 0;
  const recCount = data
    ? Object.values(data.roles.reception).filter(Boolean).length
    : 0;

  function toggle(
    role: 'practice_manager' | 'reception',
    permission_key: string,
    allowed: boolean,
  ) {
    setRole.mutate({ role, permission_key, allowed });
  }

  if (isLoading) {
    return (
      <div className="mx-auto" style={{ maxWidth: 1280 }}>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Loading permissions...
        </p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto" style={{ maxWidth: 1280 }}>
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Team Permissions
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13, marginTop: 8 }}>
          Could not load permissions
          {error instanceof Error ? ` (${error.message})` : ''}. You may not
          have access to this screen.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          Team Permissions
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Choose which capabilities each role has · the Owner always has full
          access
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
              {pmCount} of {totalPerms} permissions
            </div>
          </div>
          <div>
            <div className="display font-bold" style={{ marginTop: 4 }}>
              Reception
            </div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              {recCount} of {totalPerms} permissions
            </div>
          </div>
        </div>
      </div>

      {/* Column headers */}
      <div
        className="card text-ink-muted"
        style={{
          padding: '10px 16px',
          marginBottom: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 90px 90px 90px',
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
        <div>Capability</div>
        <div style={{ textAlign: 'center' }}>Owner</div>
        <div style={{ textAlign: 'center', color: PM_BLUE }}>Manager</div>
        <div style={{ textAlign: 'center', color: REC_GREEN }}>Reception</div>
      </div>

      {/* Permission sections */}
      {SECTION_ORDER.map((sectionName) => {
        const rows = grouped[sectionName] || [];
        if (rows.length === 0) return null;
        const meta = SECTION_COLOURS[sectionName] || {
          colour: '#6B7280',
          bg: '#F3F4F6',
        };

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
                style={{ fontSize: 15, fontWeight: 600, color: meta.colour }}
              >
                {sectionName}
              </span>
            </div>
            {rows.map((row) => {
              const pmAllowed = !!data.roles.practice_manager[row.key];
              const recAllowed = !!data.roles.reception[row.key];
              return (
                <div
                  key={row.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 90px 90px 90px',
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
                    <span style={{ fontSize: 13 }}>{row.label}</span>
                    <span
                      className="text-ink-muted"
                      style={{
                        fontSize: 9,
                        padding: '2px 6px',
                        background: 'var(--bg)',
                        borderRadius: 3,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {row.key}
                    </span>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span
                      className="text-ink-muted"
                      style={{ fontSize: 11, opacity: 0.6 }}
                      title="Owner always has full access"
                    >
                      Always
                    </span>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <Toggle
                      on={pmAllowed}
                      colour={PM_BLUE}
                      disabled={setRole.isPending}
                      onChange={(v) =>
                        toggle('practice_manager', row.key, v)
                      }
                    />
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <Toggle
                      on={recAllowed}
                      colour={REC_GREEN}
                      disabled={setRole.isPending}
                      onChange={(v) => toggle('reception', row.key, v)}
                    />
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
          Toggle any capability for the Practice Manager or Reception role and
          it takes effect for everyone in that role immediately — the matching
          sidebar sections appear or disappear on their next page load. The{' '}
          <strong>Owner always keeps full access</strong> and cannot be
          restricted here. Reception is intentionally kept to the CRM
          essentials by default.
        </p>
      </div>
    </div>
  );
}
