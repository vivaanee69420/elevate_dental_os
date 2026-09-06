'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui';
import { useMe, isAgencyActor } from '@/hooks/useMe';
import { useSubaccounts } from '@/features/agency/api';
import { useMember, useSaveMember, useCreateMember, useSetMemberPassword } from '../hooks';
import { NAV } from '@/lib/nav';
import { PermissionEditor, sectionAnchor } from './PermissionEditor';
import type { TeamRole } from '../api';

const ROLES: { value: TeamRole; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'practice_manager', label: 'Practice Manager' },
  { value: 'reception', label: 'Reception' },
  { value: 'analyst', label: 'Data Analyst' },
];

export default function UserEditScreen() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const userId = params.userId;
  const isNew = userId === 'new';

  const { data: me } = useMe();
  const agencyActor = isAgencyActor(me);
  // Whether email delivery is configured for invites (TEAM_INVITE_ENABLED on
  // the backend, surfaced by /auth/me). With it off, leaving the password
  // blank creates an 'invited' login whose invite never arrives — a person
  // who cannot sign in and no sign that anything is wrong. So where it is
  // off, a password is required and the "leave blank" affordance is gone.
  const inviteEnabled = !!me?.invite_enabled;
  const { data: detail, isLoading, isError } = useMember(isNew ? undefined : userId);
  // Options for the "Add sub-accounts" picker come from three places, unioned
  // by id — NOT from the team list. A sub-account with no users yet appears
  // in nobody's `accounts[]`, so deriving options from the team list would
  // hide it exactly when an agency admin needs it most: adding the first
  // person to a new account.
  const { data: subaccounts } = useSubaccounts(agencyActor);
  const save = useSaveMember(userId);
  const create = useCreateMember();
  const setPassword = useSetMemberPassword();

  const [pane, setPane] = useState<'info' | 'perms'>('info');
  // Owned here so the section list can clear it before scrolling.
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', password: '', role: 'reception' as TeamRole,
  });
  const [touched, setTouched] = useState(false);
  const [accounts, setAccounts] = useState<string[] | null>(null);
  // Create-only: the single home account for a brand-new member. Unlike
  // `accounts`, this can never be edited later — `users.organisation_id` is
  // fixed at creation — so it gets its own picker instead of reusing the
  // edit-mode multi-select.
  const [homeOrgId, setHomeOrgId] = useState<string | null>(null);
  const [patch, setPatch] = useState<Record<string, boolean | null>>({});
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  // Server values until the field is touched, so a load that lands after the
  // first render does not blank what someone has already typed.
  const values = touched || isNew
    ? form
    : {
        full_name: detail?.member.full_name ?? '',
        email: detail?.member.email ?? '',
        phone: detail?.member.phone ?? '',
        password: '',
        role: (detail?.member.role ?? 'reception') as TeamRole,
      };

  const selectedAccounts = accounts ?? (detail?.accounts ?? []).map((a) => a.id);
  const selectedHomeOrgId = homeOrgId ?? me?.organisation_id ?? '';

  // Union of: (1) the agency's own sub-accounts, (2) the agency's home
  // organisation — a person can belong to the agency org itself, and
  // useSubaccounts returns only children — (3) the caller's own (currently
  // acting) organisation, and (4) this member's existing accounts, so an
  // account they are already in always appears even if it is not in the
  // other lists.
  //
  // (3) matters on its own: `me.agency.home_org` is populated only while
  // switched INTO a sub-account (backend/src/controllers/auth.controller.js),
  // while the agency-wide scope that makes this picker offer more than one
  // choice applies only when NOT switched (team.service.js adminScope). So in
  // the one state where this select actually has options, neither (1) nor
  // (2) names the agency's own org — and the create-mode default below is
  // `me.organisation_id`. Without this source the default would match no
  // <option>, and a <select> whose value matches nothing silently displays
  // the first option instead — the exact "form shows one thing, sends
  // another" bug this screen exists to avoid.
  const accountOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const s of subaccounts?.subaccounts ?? []) byId.set(s.id, s.name ?? s.id);
    if (me?.agency?.home_org) {
      byId.set(me.agency.home_org.id, me.agency.home_org.name ?? me.agency.home_org.id);
    }
    if (me?.organisation_id) {
      byId.set(me.organisation_id, me.organisation_name ?? me.organisation_id);
    }
    for (const a of detail?.accounts ?? []) byId.set(a.id, a.name ?? a.id);
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [subaccounts, me, detail]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setTouched(true);
    setForm({ ...values, [key]: value });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setOkMsg('');
    const onError = (err: unknown) =>
      setError(err instanceof Error ? err.message : 'Could not save');

    if (isNew) {
      // `required` on the field alone is not enough: the password lives on
      // the Info pane and the panes are conditionally RENDERED, so submitting
      // from the Permissions pane leaves nothing for the browser to validate.
      if (!inviteEnabled && !values.password) {
        setPane('info');
        setError('Set a password — email invites are not configured, so an invited member would never receive one.');
        return;
      }
      create.mutate(
        {
          email: values.email.trim(),
          full_name: values.full_name.trim(),
          phone: values.phone.trim() || undefined,
          role: values.role,
          password: values.password || undefined,
          // The home account is fixed for life (`users.organisation_id` can
          // never move), so on create it is its own field rather than the
          // edit-mode multi-select. Extra accounts are added afterwards, on
          // the edit screen.
          ...(agencyActor ? { home_organisation_id: selectedHomeOrgId } : {}),
        },
        { onSuccess: () => router.push('/team-permissions'), onError },
      );
      return;
    }

    save.mutate(
      {
        full_name: values.full_name.trim(),
        phone: values.phone.trim(),
        role: values.role,
        permissions: patch,
        ...(agencyActor && accounts ? { organisation_ids: accounts } : {}),
      },
      {
        onSuccess: () => {
          setPatch({});
          setOkMsg('Saved.');
        },
        onError,
      },
    );
  }

  function onSetPassword() {
    const pw = window.prompt(
      `Set a new password for ${values.full_name || values.email} (min 8 characters). They will be signed out of existing sessions.`,
    );
    if (pw == null) return;
    if (pw.length < 8) {
      window.alert('Password must be at least 8 characters.');
      return;
    }
    setPassword.mutate(
      { user_id: userId, password: pw },
      {
        onSuccess: () => window.alert('Password updated.'),
        onError: (err) => window.alert(err instanceof Error ? err.message : 'Could not set password'),
      },
    );
  }

  if (!isNew && isLoading) {
    return <div className="space-y-3" style={{ maxWidth: 900 }}>
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
    </div>;
  }

  // A failed fetch must not fall through to the form: its fields would show
  // their empty/default fallbacks (blank name, 'reception' role) as if that
  // were the person's real data, and role in particular has no visible tell —
  // saving over a network blip would silently demote them.
  if (!isNew && isError) {
    return (
      <div className="mx-auto" style={{ maxWidth: 900 }}>
        <Link href="/team-permissions" className="text-brand" style={{ fontSize: 13 }}>
          ← Back
        </Link>
        <p className="text-danger mt-4" style={{ fontSize: 14 }}>
          Could not load this member. Refresh to try again.
        </p>
      </div>
    );
  }

  const busy = save.isPending || create.isPending;

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      <Link href="/team-permissions" className="text-brand" style={{ fontSize: 13 }}>
        ← Back
      </Link>
      <h1 className="display font-bold mt-2 mb-5" style={{ fontSize: 22 }}>
        {isNew ? 'Add a team member' : 'Edit or manage your team'}
      </h1>

      <div className="flex gap-6 items-start">
        {/* Left column: the two panes, with Roles & Permissions opening into
            every nav section. Clicking a section scrolls the panel to it, so
            the list is a map of the whole product rather than a second set of
            controls that could disagree with the panel. */}
        <nav className="w-60 shrink-0 space-y-1">
          <button
            type="button"
            onClick={() => setPane('info')}
            className={`w-full text-left rounded-lg px-3 py-2 text-[13px] ${
              pane === 'info' ? 'bg-brand-50 font-semibold text-brand' : 'text-ink-muted hover:bg-bg'
            }`}
            style={{ border: 'none', cursor: 'pointer' }}
          >
            User Info
          </button>

          <button
            type="button"
            aria-expanded={pane === 'perms'}
            onClick={() => setPane('perms')}
            className={`w-full text-left rounded-lg px-3 py-2 text-[13px] flex items-center justify-between ${
              pane === 'perms' ? 'bg-brand-50 font-semibold text-brand' : 'text-ink-muted hover:bg-bg'
            }`}
            style={{ border: 'none', cursor: 'pointer' }}
          >
            <span>Roles &amp; Permissions</span>
            <span aria-hidden="true" style={{ fontSize: 10 }}>{pane === 'perms' ? '▾' : '▸'}</span>
          </button>

          {pane === 'perms' && !isNew && (
            <div className="space-y-0.5 pt-1" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {NAV.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => {
                    setSearch('');
                    // Defer so a cleared search has re-rendered the section
                    // before we scroll to it.
                    requestAnimationFrame(() =>
                      document
                        .getElementById(sectionAnchor(s.label))
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                    );
                  }}
                  className="w-full text-left rounded-lg py-1.5 pl-6 pr-3 text-[13px] text-ink-muted hover:bg-bg hover:text-ink"
                  style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </nav>

        <form onSubmit={onSubmit} className="card-padded flex-1 min-w-0">
          {pane === 'info' && (
            <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label className="block">
                <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                  Full name
                </span>
                <input
                  className="input w-full"
                  required
                  value={values.full_name}
                  onChange={(e) => set('full_name', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                  Email
                </span>
                <input
                  type="email"
                  className="input w-full"
                  required
                  disabled={!isNew}
                  value={values.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </label>
              <label className="block">
                <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                  Phone
                </span>
                <input
                  className="input w-full"
                  value={values.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </label>
              {isNew && (
                <label className="block">
                  <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                    Password
                  </span>
                  <input
                    className="input w-full"
                    required={!inviteEnabled}
                    minLength={8}
                    value={values.password}
                    onChange={(e) => set('password', e.target.value)}
                    placeholder={inviteEnabled ? 'Leave blank to send an email invite' : undefined}
                  />
                  {!inviteEnabled && (
                    <span className="block text-ink-muted mt-1" style={{ fontSize: 11 }}>
                      Email invites are not configured, so set a password here and share it with
                      them.
                    </span>
                  )}
                </label>
              )}
              {!isNew && (
                <div className="col-span-2">
                  <button type="button" onClick={onSetPassword} className="btn-ghost">
                    Set password
                  </button>
                </div>
              )}
            </div>
          )}

          {pane === 'perms' && (
            <div>
              <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <label className="block">
                  <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                    User Role
                  </span>
                  <select
                    className="input w-full"
                    value={values.role}
                    onChange={(e) => set('role', e.target.value as TeamRole)}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </label>
                {!isNew && (
                  <div>
                    <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                      User Type
                    </span>
                    <p style={{ fontSize: 13, paddingTop: 8 }}>
                      {detail?.member.is_agency_admin ? 'Agency' : 'Account'}
                    </p>
                  </div>
                )}
              </div>

              {/* Create: a single home account, since `users.organisation_id`
                  can never move afterwards — this is the one chance to place
                  a new member somewhere other than the caller's own org. */}
              {isNew && agencyActor && accountOptions.length > 0 && (
                <div className="mb-4">
                  <label className="block">
                    <span className="block text-ink-muted mb-1" style={{ fontSize: 11, fontWeight: 600 }}>
                      Account
                    </span>
                    <select
                      className="input w-full"
                      value={selectedHomeOrgId}
                      onChange={(e) => setHomeOrgId(e.target.value)}
                    >
                      {accountOptions.map(([id, name]) => (
                        <option key={id} value={id}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <p className="text-ink-muted mt-2" style={{ fontSize: 11 }}>
                    Extra accounts can be added once the member has been created — they start in
                    this account only.
                  </p>
                </div>
              )}

              {/* Edit: the full multi-select — extra accounts alongside the
                  fixed home account. */}
              {!isNew && agencyActor && accountOptions.length > 0 && (
                <fieldset className="mb-4">
                  <legend className="text-ink-muted mb-2" style={{ fontSize: 11, fontWeight: 600 }}>
                    Add sub-accounts
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {accountOptions.map(([id, name]) => {
                      const on = selectedAccounts.includes(id);
                      return (
                        <label
                          key={id}
                          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
                            on ? 'border-brand bg-brand-50 text-brand' : 'border-border text-ink-muted'
                          }`}
                          style={{ fontSize: 12, cursor: 'pointer' }}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) =>
                              setAccounts(
                                e.target.checked
                                  ? [...selectedAccounts, id]
                                  : selectedAccounts.filter((x) => x !== id),
                              )
                            }
                          />
                          {name}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-ink-muted mt-2" style={{ fontSize: 11 }}>
                    The role and permissions on this page apply to every account ticked here.
                    A member&rsquo;s home account cannot be removed.
                  </p>
                </fieldset>
              )}

              {!isNew && detail && (
                <PermissionEditor
                  effective={detail.effective}
                  overrides={detail.overrides}
                  // The role currently selected in the form, not the one on
                  // the server — so an unsaved role change previews against
                  // the new role's defaults too. The defaults come from the
                  // MEMBER's own detail, not from the caller's permissions
                  // matrix: role_permissions is per-organisation, so for a
                  // sub-account user the caller's matrix answers for the
                  // wrong org while the save writes the right one.
                  roleDefaults={detail.role_defaults?.[values.role] ?? {}}
                  patch={patch}
                  onChange={(key, value) => setPatch((p) => ({ ...p, [key]: value }))}
                  search={search}
                  onSearchChange={setSearch}
                />
              )}
              {isNew && (
                <p className="text-ink-muted" style={{ fontSize: 12 }}>
                  Permissions can be set once the member has been created — they start on their
                  role&rsquo;s defaults.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-danger mt-4" style={{ fontSize: 13 }}>{error}</p>}
          {okMsg && <p className="mt-4" style={{ fontSize: 13, color: '#059669' }}>{okMsg}</p>}

          <div className="flex justify-end gap-3 mt-6">
            <Link href="/team-permissions" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
