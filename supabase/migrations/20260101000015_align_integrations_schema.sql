-- Align the legacy manually-created `integrations` table to the schema the
-- code (and migration 000008) expects.
--
-- On the hosted project the `integrations` table predated the migration ledger,
-- so 000008's `CREATE TABLE IF NOT EXISTS` no-op'd and the table kept the old
-- columns (encrypted_credentials / last_synced_at) and an old status vocabulary
-- (connected/disconnected/error/expired). The code uses `secrets` + `last_sync_at`
-- and the status lifecycle pending|verifying|active|failed|revoked, which made
-- every connect 500 with `integrations_status_check` violation.
--
-- This brings any such drifted table into line. Idempotent — on a clean
-- `supabase db reset` (where 000008 already created the correct table) every
-- statement is a guarded no-op.

ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS secrets BYTEA;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS scopes TEXT[];
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS refresh_in_progress_at TIMESTAMPTZ;

ALTER TABLE public.integrations ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.integrations DROP CONSTRAINT IF EXISTS integrations_status_check;
ALTER TABLE public.integrations ADD CONSTRAINT integrations_status_check
  CHECK (status IN ('pending','verifying','active','failed','revoked'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_integrations_org_provider
  ON public.integrations (organisation_id, provider);

-- After hosted apply: PostgREST schema cache goes stale (recurring gotcha).
NOTIFY pgrst, 'reload schema';
