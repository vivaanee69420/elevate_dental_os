'use client';
// Settings → Team. One row per person, and — for an agency admin — one list
// across the agency org and every sub-account.
//
// The agency-only columns and filters are driven by the RESPONSE
// (`agency_wide`), not by a client-side role guess: the server decides whose
// people this caller may see, and the screen renders what it was given.
//
// Two columns are conditional on the DATA rather than on configuration:
// Phone appears only if somebody has one, and the agency marker appears only
// on the people it is true of. A column that reads the same in every row is
// not information, it is furniture — the old version rendered a Phone column
// of nothing but dashes and stamped "ACCOUNT" beside every name.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui';
import { useMe } from '@/hooks/useMe';
import { useTeamList, useRemoveMember } from '../hooks';
import type { TeamMemberRow, TeamRole } from '../api';

const ROLE_LABEL: Record<TeamRole, string> = {
  owner: 'Owner',
  practice_manager: 'Practice Manager',
  reception: 'Reception',
  analyst: 'Data Analyst',
};

function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

/** Small neutral marker. Used only where a row differs from the norm. */
function Marker({ children, tone }: { children: React.ReactNode; tone: 'gold' | 'brand' }) {
  const palette =
    tone === 'gold'
      ? { color: '#7A6224', background: '#F6EEDA', border: '#E7D6A8' }
      : { color: 'var(--brand-600)', background: 'var(--brand-50)', border: 'var(--brand-100)' };
  return (
    <span
      style={{
        fontSize: 10.5,
        lineHeight: 1.6,
        padding: '0 6px',
        borderRadius: 5,
        whiteSpace: 'nowrap',
        color: palette.color,
        background: palette.background,
        border: `1px solid ${palette.border}`,
      }}
    >
      {children}
    </span>
  );
}

/** Status as a dot and a word — a filled chip here competed with the account
 *  chips beside it for the same attention, and status is the quieter fact. */
function Status({ status }: { status: TeamMemberRow['status'] }) {
  const active = status === 'active';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: active ? 'var(--success)' : 'var(--warning)',
        }}
      />
      <span className={active ? undefined : 'text-ink-muted'}>
        {active ? 'Active' : 'Invited'}
      </span>
    </span>
  );
}

/** A filter control sized to its own label rather than stretched to fill. */
function Filter({
  value,
  onChange,
  children,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  width: number;
}) {
  return (
    <div style={{ position: 'relative', width }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input w-full"
        style={{
          height: 38,
          paddingRight: 28,
          appearance: 'none',
          background: 'var(--surface)',
          color: value ? 'var(--ink)' : 'var(--ink-muted)',
          cursor: 'pointer',
        }}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: 11,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          color: 'var(--ink-muted)',
          fontSize: 10,
        }}
      >
        ▾
      </span>
    </div>
  );
}

export default function TeamListScreen() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data, isLoading, isError } = useTeamList();
  const remove = useRemoveMember();

  const [userType, setUserType] = useState('');
  const [role, setRole] = useState('');
  const [account, setAccount] = useState('');
  const [search, setSearch] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const agencyWide = data?.agency_wide === true;
  const members = useMemo(() => data?.members ?? [], [data]);

  // Columns that earn their place from the data in front of us.
  const showPhone = members.some((m) => !!m.phone);

  const accountOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const m of members) {
      for (const a of m.accounts ?? []) byId.set(a.id, a.name ?? a.id);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [members]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (role && m.role !== role) return false;
      if (userType === 'agency' && !m.is_agency_admin) return false;
      if (userType === 'account' && m.is_agency_admin) return false;
      if (account && !(m.accounts ?? []).some((a) => a.id === account)) return false;
      if (q && !`${m.full_name ?? ''} ${m.email}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [members, role, userType, account, search]);

  const filtered = rows.length !== members.length;
  const columnCount = 3 + (showPhone ? 1 : 0) + (agencyWide ? 1 : 0);

  function onRemove(m: TeamMemberRow) {
    const who = m.full_name || m.email;
    if (!window.confirm(`Remove ${who}? They lose access immediately.`)) return;
    setRemoving(who);
    remove.mutate(m.id);
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 1180 }}>
      <div className="flex items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="display font-bold" style={{ fontSize: 24, letterSpacing: '-0.01em' }}>
            Team
          </h1>
          <p className="text-ink-muted" style={{ fontSize: 13, marginTop: 2 }}>
            {agencyWide
              ? 'Everyone across your organisation and its sub-accounts'
              : 'People with access to this organisation'}
          </p>
        </div>
        <Link
          href="/team-permissions/new"
          className="btn-primary shrink-0"
          style={{ height: 38, display: 'inline-flex', alignItems: 'center', padding: '0 16px' }}
        >
          Add user
        </Link>
      </div>

      <div className="card overflow-hidden">
        {/* Filter bar sits inside the card, so the controls read as belonging
            to the table they act on rather than floating above it. */}
        <div
          className="flex flex-wrap items-center gap-2"
          style={{ padding: 12, borderBottom: '1px solid var(--border)' }}
        >
          <div style={{ position: 'relative', width: 260 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email"
              aria-label="Search name or email"
              className="input w-full"
              style={{ height: 38, paddingLeft: 32 }}
            />
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{
                position: 'absolute',
                left: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--ink-muted)',
              }}
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </div>

          <Filter value={role} onChange={setRole} width={168}>
            <option value="">All roles</option>
            {Object.entries(ROLE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </Filter>

          {agencyWide && (
            <Filter value={userType} onChange={setUserType} width={140}>
              <option value="">Agency and client</option>
              <option value="agency">Agency only</option>
              <option value="account">Client only</option>
            </Filter>
          )}

          {agencyWide && accountOptions.length > 0 && (
            <Filter value={account} onChange={setAccount} width={190}>
              <option value="">All accounts</option>
              {accountOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </Filter>
          )}

          <span className="text-ink-muted ml-auto" style={{ fontSize: 12 }}>
            {filtered
              ? `${rows.length} of ${members.length} people`
              : `${members.length} ${members.length === 1 ? 'person' : 'people'}`}
          </span>
        </div>

        {remove.isError && (
          <div
            role="alert"
            style={{
              padding: '10px 16px',
              fontSize: 13,
              background: '#FBECE8',
              borderBottom: '1px solid var(--border)',
              color: '#8A3A2B',
            }}
          >
            {removing ? `${removing} was not removed. ` : 'Could not remove that person. '}
            {remove.error instanceof Error ? remove.error.message : 'Please try again.'}
          </div>
        )}

        {isLoading && (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}

        {isError && (
          <div className="text-ink-muted" style={{ padding: 20, fontSize: 13 }}>
            Could not load the team. Refresh to try again.
          </div>
        )}

        {data && (
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="bg-bg" style={{ borderBottom: '1px solid var(--border)' }}>
                <th className="text-left font-semibold" style={{ padding: '9px 16px' }}>Name</th>
                {showPhone && (
                  <th className="text-left font-semibold" style={{ padding: '9px 12px' }}>Phone</th>
                )}
                <th className="text-left font-semibold" style={{ padding: '9px 12px' }}>Role</th>
                {agencyWide && (
                  <th className="text-left font-semibold" style={{ padding: '9px 12px' }}>Accounts</th>
                )}
                <th className="text-left font-semibold" style={{ padding: '9px 12px' }}>Status</th>
                <th style={{ padding: '9px 16px', width: 92 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const isSelf = !!me?.id && m.id === me.id;
                const accounts = m.accounts ?? [];
                const name = m.full_name || m.email.split('@')[0];
                return (
                  <tr
                    key={m.id}
                    className="group cursor-pointer"
                    style={{ borderBottom: '1px solid var(--line-2)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                    onClick={() => router.push(`/team-permissions/${m.id}`)}
                  >
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                          aria-hidden="true"
                          style={{
                            width: 32,
                            height: 32,
                            flexShrink: 0,
                            borderRadius: '50%',
                            background: 'var(--brand-50)',
                            color: 'var(--brand-600)',
                            border: '1px solid var(--brand-100)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: '0.02em',
                          }}
                        >
                          {initials(name) || 'U'}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontWeight: 600,
                              color: 'var(--ink)',
                            }}
                          >
                            <span className="truncate">{name}</span>
                            {/* Markers only where a row is the exception. */}
                            {m.is_agency_admin && <Marker tone="gold">Agency</Marker>}
                            {isSelf && <Marker tone="brand">You</Marker>}
                          </span>
                          <span className="block truncate text-ink-muted" style={{ fontSize: 12 }}>
                            {m.email}
                          </span>
                        </span>
                      </div>
                    </td>

                    {showPhone && (
                      <td className="text-ink-muted" style={{ padding: '10px 12px' }}>
                        {m.phone || '—'}
                      </td>
                    )}

                    <td style={{ padding: '10px 12px' }}>{ROLE_LABEL[m.role]}</td>

                    {agencyWide && (
                      <td style={{ padding: '10px 12px' }}>
                        {accounts.length === 0 ? (
                          <span className="text-ink-muted">—</span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className="truncate" style={{ maxWidth: 190 }}>
                              {accounts[0].name ?? 'Unnamed account'}
                            </span>
                            {accounts.length > 1 && (
                              <span
                                className="text-ink-muted"
                                title={accounts
                                  .slice(1)
                                  .map((a) => a.name ?? 'Unnamed account')
                                  .join(', ')}
                                style={{ fontSize: 12 }}
                              >
                                +{accounts.length - 1}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                    )}

                    <td style={{ padding: '10px 12px' }}>
                      <Status status={m.status} />
                    </td>

                    <td
                      style={{ padding: '10px 16px', textAlign: 'right' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Quiet until the row is hovered or focused: a red word on
                          every row makes deletion the loudest thing on the page. */}
                      <span
                        className="inline-flex gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                        style={{ fontSize: 12.5 }}
                      >
                        <Link href={`/team-permissions/${m.id}`} className="text-brand">
                          Edit
                        </Link>
                        {!isSelf && (
                          <button
                            type="button"
                            onClick={() => onRemove(m)}
                            disabled={remove.isPending}
                            className="text-danger"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          >
                            Remove
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={columnCount} style={{ padding: '32px 16px', textAlign: 'center' }}>
                    <p style={{ fontSize: 13, color: 'var(--ink)' }}>
                      {members.length === 0 ? 'No one here yet' : 'No one matches those filters'}
                    </p>
                    <p className="text-ink-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                      {members.length === 0 ? (
                        <>Add your first team member to give them access.</>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setSearch('');
                            setRole('');
                            setUserType('');
                            setAccount('');
                          }}
                          className="text-brand"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          Clear the filters
                        </button>
                      )}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
