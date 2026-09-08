// Crossing a session boundary must destroy everything the last session left
// behind in this tab.
//
// THE BUG THIS EXISTS FOR. Sign-out and sign-in both used router.push — a
// CLIENT-side navigation — so the React root was never torn down. The
// QueryClient is created once at that root (app/providers.tsx), every query
// key is keyed by what is being asked for and never by WHO is asking, and
// /auth/me is cached for five minutes. So signing in as a second person on the
// same computer served them the FIRST person's identity, navigation,
// permissions and every figure already fetched, until somebody happened to
// press refresh.
//
// The httpOnly cookie was replaced correctly the whole time, and every API
// response after the switch belonged to the new user — which is exactly why it
// was easy to miss. The leak was the browser's memory, not the token.
//
// A full document navigation is the fix rather than queryClient.clear(),
// because clear() only empties the store this module knows about: React state
// in mounted components, module-level singletons, in-flight requests and any
// future cache would all survive it. Reloading the document has none of those
// holes, and a session change is the one moment in the app where the cost of a
// reload is irrelevant.

/**
 * Leave for `destination`, discarding this tab's memory of the old session.
 * Use for sign-in, sign-out, and anything else that changes who the user is.
 */
export function leaveSession(destination: string) {
  // assign(), not replace(): the login page belongs in history so the back
  // button does not skip past it into a dashboard rendered for nobody.
  window.location.assign(destination);
}

// ONE DAY, then sign in again.
//
// Supabase's refresh token has no absolute expiry, so a session lasted as long
// as the browser kept using it — eight weeks, on the oldest live one on this
// project. Timeboxing it properly is a GoTrue dashboard setting that cannot be
// reached from code, so the deadline lives here: a marker cookie set at
// sign-in with a 24h max-age. The browser deletes it on our behalf, and
// middleware reads its absence beside a live Supabase session as "the day is
// over" and sends the person back to /login.
//
// It is a deadline, not a defence: the cookie is httpOnly, so page scripts
// cannot touch it, but somebody with devtools on their own machine could keep
// their own session alive. That is the same thing they could do by signing in
// again, so it costs nothing.
export const SESSION_MARKER = 'session_day';
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
