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
import { useMemo, useState } from 'react';
import { useMe } from '@/hooks/useMe';
import { Chip, Skeleton, SkeletonTable, type ChipColour } from '@/components/ui';
import {
  usePermissionsMatrix,
  useSetRolePermission,
  useTeam,
  useInviteMember,
  useRemoveMember,
  useProvisionMember,
  useSetMemberPassword,
} from '../hooks';
import type { TeamMember, EditableRole } from '../api';
import { SECTION_COLOURS } from '../data';
import { NAV } from '@/lib/nav';
import { ROUTE_PERMISSION, pageKey, PAGE_ENFORCED } from '@/lib/permissions';

/** Status -> chip colour, mirroring the STAGE_CHIP_COLOUR convention. */
const STATUS_CHIP_COLOUR: Record<TeamMember['status'], ChipColour> = {
  invited: 'amber',
  active: 'emerald',
};

const ROLE_LABEL: Record<TeamMember['role'], string> = {
  owner: 'Owner',
  practice_manager: 'Practice Manager',
  reception: 'Reception',
  analyst: 'Data Analyst',
};

/** Team members management — add (set-password / invite), list, remove,
 *  reset password. Set-password is the primary path; the email-invite mode
 *  is shown only once delivery is configured (me.invite_enabled). */
function TeamMembers() {
  const { data, isLoading, isError } = useTeam();
  const invite = useInviteMember();
  const provision = useProvisionMember();
  const setPassword = useSetMemberPassword();
  const remove = useRemoveMember();
  // Shared cached identity (same /auth/me cache as sidebar/topbar) — used to
  // block self-actions and gate the invite mode.
  const { data: me } = useMe();
  const inviteEnabled = !!me?.invite_enabled;

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<TeamMember['role']>('reception');
  const [password, setPassword2] = useState('');
  // 'password' = admin sets the password (default, no email needed).
  // 'invite'   = Supabase invite email (only when inviteEnabled).
  const [mode, setMode] = useState<'password' | 'invite'>('password');
  const [formError, setFormError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const busy = invite.isPending || provision.isPending;

  function resetForm() {
    setEmail('');
    setFullName('');
    setRole('reception');
    setPassword2('');
  }

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setOkMsg('');
    const onError = (err: unknown) =>
      setFormError(
        err instanceof Error ? err.message : 'Could not add member',
      );

    if (mode === 'invite' && inviteEnabled) {
      invite.mutate(
        { email: email.trim(), full_name: fullName.trim(), role },
        {
          onSuccess: () => {
            setOkMsg(
              'Invite sent. The member appears as Invited until they accept and set a password.',
            );
            resetForm();
          },
          onError,
        },
      );
      return;
    }
    provision.mutate(
      {
        email: email.trim(),
        full_name: fullName.trim(),
        role,
        password,
      },
      {
        onSuccess: () => {
          setOkMsg(
            'Member added and active. Share the password securely and ask them to change it after first login.',
          );
          resetForm();
        },
        onError,
      },
    );
  }

  function onSetPassword(member: TeamMember) {
    const pw = window.prompt(
      `Set a new password for ${member.full_name || member.email} (min 8 characters). They will be signed out of existing sessions.`,
    );
    if (pw == null) return;
    if (pw.length < 8) {
      window.alert('Password must be at least 8 characters.');
      return;
    }
    setPassword.mutate(
      { user_id: member.id, password: pw },
      {
        onSuccess: () =>
          window.alert(`Password updated for ${member.full_name || member.email}.`),
        onError: (err) =>
          window.alert(
            err instanceof Error ? err.message : 'Could not set password',
          ),
      },
    );
  }

  function onRemove(member: TeamMember) {
    if (
      !window.confirm(
        `Remove ${member.full_name || member.email} from this organisation?`,
      )
    ) {
      return;
    }
    remove.mutate(member.id);
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="card overflow-hidden" style={{ marginBottom: 16 }}>
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            className="display"
            style={{ fontSize: 16, fontWeight: 600 }}
          >
            Team members
          </span>
          <p
            className="text-ink-muted"
            style={{ fontSize: 12, marginTop: 2 }}
          >
            People with access to this organisation
          </p>
        </div>

        {isLoading && (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}

        {isError && (
          <div
            className="text-ink-muted"
            style={{ padding: '16px', fontSize: 13 }}
          >
            Could not load team members.
          </div>
        )}

        {data && (
          <table className="w-full text-sm">
            <thead className="bg-bg border-b border-border">
              <tr>
                <th className="text-left p-3 font-semibold">Name</th>
                <th className="text-left p-3 font-semibold">Role</th>
                <th className="text-left p-3 font-semibold">Status</th>
                <th className="text-left p-3 font-semibold">Last active</th>
                <th className="text-right p-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const isSelf = !!me?.id && m.id === me.id;
                return (
                  <tr
                    key={m.id}
                    className="border-b border-border hover:bg-bg"
                  >
                    <td className="p-3">
                      <div style={{ fontWeight: 500 }}>
                        {m.full_name || '—'}
                      </div>
                      <div
                        className="text-ink-muted"
                        style={{ fontSize: 12 }}
                      >
                        {m.email}
                      </div>
                    </td>
                    <td className="p-3">{ROLE_LABEL[m.role]}</td>
                    <td className="p-3">
                      <Chip colour={STATUS_CHIP_COLOUR[m.status]}>
                        {m.status === 'invited' ? 'Invited' : 'Active'}
                      </Chip>
                    </td>
                    <td className="p-3 text-ink-muted">
                      {m.last_active_at
                        ? new Date(m.last_active_at).toLocaleDateString(
                            'en-GB',
                          )
                        : '—'}
                    </td>
                    <td className="p-3 text-right">
                      {isSelf ? (
                        <span
                          className="text-ink-muted"
                          style={{ fontSize: 12 }}
                          title="You cannot remove your own account"
                        >
                          You
                        </span>
                      ) : (
                        <span
                          style={{
                            display: 'inline-flex',
                            gap: 14,
                            justifyContent: 'flex-end',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => onSetPassword(m)}
                            disabled={setPassword.isPending}
                            style={{
                              fontSize: 13,
                              background: 'none',
                              border: 'none',
                              cursor: setPassword.isPending
                                ? 'not-allowed'
                                : 'pointer',
                              opacity: setPassword.isPending ? 0.5 : 1,
                              color: 'var(--brand)',
                            }}
                          >
                            Set password
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemove(m)}
                            disabled={remove.isPending}
                            className="text-danger"
                            style={{
                              fontSize: 13,
                              background: 'none',
                              border: 'none',
                              cursor: remove.isPending
                                ? 'not-allowed'
                                : 'pointer',
                              opacity: remove.isPending ? 0.5 : 1,
                            }}
                          >
                            Remove
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.members.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="p-3 text-ink-muted"
                    style={{ fontSize: 13 }}
                  >
                    No team members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Add member */}
      <div className="card-padded">
        <strong style={{ fontSize: 14 }}>Add member</strong>
        <p
          className="text-ink-muted"
          style={{ fontSize: 12, marginTop: 2, marginBottom: 12 }}
        >
          {mode === 'invite'
            ? 'We will email an invitation. The member appears as Invited until they accept and set a password.'
            : 'Set a password for the member. They become active immediately and can log in straight away.'}
        </p>

        {inviteEnabled && (
          <div
            style={{ display: 'flex', gap: 8, marginBottom: 12 }}
            role="radiogroup"
            aria-label="How to add the member"
          >
            {(
              [
                ['password', 'Set a password'],
                ['invite', 'Send email invite'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={mode === value ? 'btn-primary' : 'btn-ghost'}
                style={{ padding: '6px 12px', fontSize: 12 }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={submitAdd}
          style={{
            display: 'grid',
            gridTemplateColumns:
              mode === 'password'
                ? '1fr 1fr 160px 160px auto'
                : '1fr 1fr 180px auto',
            gap: 12,
            alignItems: 'end',
          }}
        >
          <div>
            <label
              className="block text-ink-muted"
              style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}
            >
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@practice.co.uk"
              className="input w-full"
            />
          </div>
          <div>
            <label
              className="block text-ink-muted"
              style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}
            >
              Full name
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
              className="input w-full"
            />
          </div>
          <div>
            <label
              className="block text-ink-muted"
              style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}
            >
              Role
            </label>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as TeamMember['role'])
              }
              className="input w-full"
            >
              <option value="owner">Owner</option>
              <option value="practice_manager">Practice Manager</option>
              <option value="reception">Reception</option>
              <option value="analyst">Data Analyst</option>
            </select>
          </div>
          {mode === 'password' && (
            <div>
              <label
                className="block text-ink-muted"
                style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}
              >
                Password
              </label>
              <input
                type="text"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="Min 8 characters"
                className="input w-full"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="btn-primary"
            style={{ padding: '8px 16px' }}
          >
            {busy
              ? 'Saving...'
              : mode === 'invite'
                ? 'Send invite'
                : 'Add member'}
          </button>
        </form>
        {formError && (
          <div
            className="text-danger"
            style={{ fontSize: 13, marginTop: 10 }}
          >
            {formError}
          </div>
        )}
        {okMsg && (
          <div style={{ fontSize: 13, marginTop: 10, color: '#059669' }}>
            {okMsg}
          </div>
        )}
      </div>
    </div>
  );
}

const PM_BLUE = '#3B82F6';
const REC_GREEN = 'var(--success)';
const AN_SLATE = '#475569';

/**
 * Visual grouping of catalogue permission keys into the prototype's coloured
 * sections. Keys absent here fall into "System".
 */
const KEY_SECTION: Record<string, string> = {
  'finance.view': 'Finance',
  'valuation.view': 'Finance',
  'businesshealth.manage': 'Business Health',
  'overview.view': 'Overview',
  'operations.view': 'Operations',
  'payrun.manage': 'Operations',
  'intelligence.view': 'Intelligence',
  'growth.view': 'Growth',
  'crm.view': 'Elevate CRM',
  'crm.manage': 'Elevate CRM',
  'wealth.view': 'Wealth',
  'training.view': 'Training',
  'marketing.view': 'Marketing',
  // Was falling through to 'System', which buried the Data Room toggle in with
  // user admin. It is its own nav section, so it gets its own matrix section.
  'data.export': 'Data Room',
  'system.manage': 'System',
  'users.invite': 'System',
  'users.manage': 'System',
  'permissions.manage': 'System',
};

const SECTION_ORDER = [
  // Overview first, matching the sidebar order.
  'Overview',
  'Finance',
  'Business Health',
  'Operations',
  'Intelligence',
  'Growth',
  'Elevate CRM',
  'Wealth',
  'Training',
  'Marketing',
  'Data Room',
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

  // Which pages sit under each permission key, in sidebar order. This is what
  // lets an owner hand out one page instead of a whole section: the key row is
  // the default, each page row below it can override that default on or off.
  const pagesForKey = useMemo(() => {
    const m: Record<string, { id: string; label: string; section: string }[]> = {};
    for (const section of NAV) {
      for (const item of section.items) {
        const key = ROUTE_PERMISSION[item.id];
        if (key) (m[key] ??= []).push({ id: item.id, label: item.label, section: section.label });
      }
    }
    return m;
  }, []);

  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});

  // Counts are about the permission CATALOG, not the resolved page keys the
  // matrix now also carries — otherwise every section grant would inflate them.
  const countFor = (role: EditableRole) =>
    data ? Object.keys(data.catalog).filter((k) => data.roles[role][k]).length : 0;

  const totalPerms = data ? Object.keys(data.catalog).length : 0;
  const pmCount = countFor('practice_manager');
  const recCount = countFor('reception');
  const anCount = countFor('analyst');

  function toggle(
    role: EditableRole,
    permission_key: string,
    allowed: boolean | null,
  ) {
    setRole.mutate({ role, permission_key, allowed });
  }

  /** True when this role has pinned this page rather than inheriting it. */
  const isOverridden = (role: EditableRole, pageId: string) =>
    data?.overrides?.[role]?.[pageKey(pageId)] !== undefined;

  if (isLoading) {
    return (
      <div className="mx-auto" style={{ maxWidth: 1280 }}>
        <TeamMembers />
        <SkeletonTable rows={6} cols={5} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto" style={{ maxWidth: 1280 }}>
        <TeamMembers />
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
      <TeamMembers />

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
          background: 'linear-gradient(135deg, var(--brand) 0%, #085857 100%)',
          color: 'white',
          border: 'none',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr',
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
            }}
          >
            <div className="display font-bold" style={{ marginTop: 4 }}>
              Practice Manager
            </div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              {pmCount} of {totalPerms} permissions
            </div>
          </div>
          <div
            style={{
              borderLeft: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            <div className="display font-bold" style={{ marginTop: 4 }}>
              Reception
            </div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              {recCount} of {totalPerms} permissions
            </div>
          </div>
          <div
            style={{
              borderLeft: '1px solid rgba(255,255,255,0.2)',
            }}
          >
            <div className="display font-bold" style={{ marginTop: 4 }}>
              Data Analyst
            </div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              {anCount} of {totalPerms} permissions
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
          gridTemplateColumns: '1fr 90px 90px 90px 90px',
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
        <div style={{ textAlign: 'center', color: AN_SLATE }}>Data Analyst</div>
      </div>

      {/* Permission sections */}
      {SECTION_ORDER.map((sectionName) => {
        const rows = grouped[sectionName] || [];
        if (rows.length === 0) return null;
        const meta = SECTION_COLOURS[sectionName] || {
          colour: 'var(--ink-muted)',
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
              const anAllowed = !!data.roles.analyst[row.key];
              const pages = pagesForKey[row.key] ?? [];
              const open = !!openKeys[row.key];
              return (
                <div key={row.key}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 90px 90px 90px 90px',
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
                    {/* Expands the pages this key covers, so access can be
                        given one page at a time instead of the whole section. */}
                    {pages.length > 0 && (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`${open ? 'Hide' : 'Show'} the ${pages.length} pages under ${row.label}`}
                        onClick={() => setOpenKeys((o) => ({ ...o, [row.key]: !open }))}
                        style={{
                          border: '1px solid var(--border)', background: '#FFFFFF',
                          borderRadius: 6, cursor: 'pointer', fontSize: 10,
                          lineHeight: 1, padding: '3px 5px', color: 'var(--ink-muted)',
                          minWidth: 34, textAlign: 'center',
                        }}
                      >
                        {open ? '▾' : '▸'} {pages.length}
                      </button>
                    )}
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
                  <div style={{ textAlign: 'center' }}>
                    <Toggle
                      on={anAllowed}
                      colour={AN_SLATE}
                      disabled={setRole.isPending}
                      onChange={(v) => toggle('analyst', row.key, v)}
                    />
                  </div>
                </div>

                {/* Per-page overrides. A page follows the section above unless
                    it is pinned here; ↺ removes the pin and lets it follow
                    again. Pages whose data is shared with other pages on one
                    endpoint are marked — hiding those is nav-only. */}
                {open && pages.map((pg) => (
                  <div
                    key={pg.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 90px 90px 90px 90px',
                      gap: 12,
                      alignItems: 'center',
                      padding: '7px 14px 7px 34px',
                      borderBottom: '1px solid var(--border)',
                      background: 'var(--bg)',
                    }}
                  >
                    <div className="text-ink-muted" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <span>{pg.label}</span>
                      {!PAGE_ENFORCED.has(pg.id) && (
                        <span
                          title="This page shares its data endpoint with others in the section, so turning it off hides the page but does not block the data."
                          style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#FEF3C7', color: '#92400E' }}
                        >
                          nav only
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <span className="text-ink-muted" style={{ fontSize: 11, opacity: 0.6 }}>Always</span>
                    </div>
                    {(['practice_manager', 'reception', 'analyst'] as const).map((role) => {
                      const colour = role === 'practice_manager' ? PM_BLUE : role === 'reception' ? REC_GREEN : AN_SLATE;
                      const on = !!data.roles[role][pageKey(pg.id)];
                      const pinned = isOverridden(role, pg.id);
                      return (
                        <div key={role} style={{ textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <Toggle
                            on={on}
                            colour={colour}
                            disabled={setRole.isPending}
                            onChange={(v) => toggle(role, pageKey(pg.id), v)}
                          />
                          <button
                            type="button"
                            title={pinned ? 'Reset: follow the section again' : 'Following the section'}
                            aria-label={`Reset ${pg.label} for ${role} to follow the section`}
                            disabled={!pinned || setRole.isPending}
                            onClick={() => toggle(role, pageKey(pg.id), null)}
                            style={{
                              border: 'none', background: 'none', fontSize: 11, lineHeight: 1,
                              padding: 2, cursor: pinned ? 'pointer' : 'default',
                              color: 'var(--ink-muted)', opacity: pinned ? 1 : 0.25,
                            }}
                          >
                            ↺
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
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
