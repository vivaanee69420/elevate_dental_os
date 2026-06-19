-- Loop-closing webhook diagnostics. Records the outcome of the LAST inbound
-- real-time webhook delivery (verified | bad_signature | no_secret) so the
-- owner UI can show a truthful, time-stamped status instead of a blanket
-- "every delivery failing — the secret must match" message that cannot tell a
-- genuine secret mismatch from a stale cumulative failure count.
--
-- A dedicated column (not a config key) is deliberate: writing it is a single
-- atomic UPDATE that touches nothing else. The bug this hardens against was a
-- config read-modify-write CLOBBERING webhook_secret on OAuth refresh — so the
-- diagnostic must never itself read-modify-write config.
alter table public.integrations
  add column if not exists webhook_last_result jsonb;

comment on column public.integrations.webhook_last_result is
  'Outcome of the most recent inbound real-time webhook delivery: { outcome, at, ... }. Powers the owner-facing webhook health banner. Set atomically on each delivery; never merged into config.';

notify pgrst, 'reload schema';
