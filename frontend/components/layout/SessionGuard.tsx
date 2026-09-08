'use client';
// Catches a session that changed WITHOUT going through this tab's sign-in or
// sign-out buttons — the case those two fixes cannot reach.
//
// The cookie is httpOnly and shared across tabs, so signing in as somebody
// else in a second tab silently re-points this one at a different person while
// it carries on rendering the previous user's navigation, permissions and
// figures out of the query cache. Nothing in the tab is wrong exactly: every
// request it makes from that moment returns the NEW user's data. It is the
// memory of the old one that has no right to still be on screen.
//
// So: watch the identity, and if it ever changes under us, reload rather than
// patch. Reloading throws away the query cache, component state, module
// singletons and any in-flight request together; clearing the cache alone
// leaves the other three.
import { useEffect, useRef } from 'react';
import { useMe } from '@/hooks/useMe';
import { leaveSession } from '@/lib/session-boundary';

export function SessionGuard() {
  const { data: me } = useMe();
  // The identity this tab has been rendering for. A ref, not state: changing
  // it must not itself cause a render.
  const seen = useRef<string | null>(null);

  useEffect(() => {
    const id = me?.id;
    // No identity yet (first load, or /auth/me failed) is not a change. Acting
    // on it would reload a tab that is merely signed out, forever.
    if (!id) return;
    if (seen.current === null) { seen.current = id; return; }
    if (seen.current === id) return;

    // Reload in place: the person is legitimately signed in, they are just
    // somebody else now, and their own version of this page is the right
    // destination.
    seen.current = id;
    leaveSession(window.location.pathname + window.location.search);
  }, [me?.id]);

  return null;
}
