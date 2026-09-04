-- ============================================================================
-- CallRail — tracked phone calls, one row per call, scoped to the CallRail
-- COMPANY (an integration_accounts row) that fetched it.
--
-- WHY NO TRACKING-NUMBER MAP: the owner holds one API key per CallRail
-- company and one company per practice. A call's practice therefore follows
-- from the key that fetched it — integration_accounts.practice_id — which
-- needs no mapping step, cannot drift, and reuses the pattern GoHighLevel
-- multi-subaccount already established here.
--
-- tracking_number and source are still stored. Not to classify with, but so
-- the first sync can SHOW what CallRail actually reports. The owner's
-- position is that every tracked call came from the ad — "if they see the ad
-- then only they call" — and that is very likely right for a CallRail set up
-- solely for Google Ads. Storing the source means that assumption is
-- checkable against real data rather than permanent and invisible.
--
-- WHY CALLS ARE NOT ROWS IN `leads`: writing them there puts rows with no
-- pipeline, no opportunity and no GHL id into a GoHighLevel-shaped table, and
-- makes the cross-source dedup implicit at write time — where it is invisible
-- and unfixable. A separate table makes dedup an explicit, testable read-time
-- step.
--
-- MULTI-TENANT: every row carries organisation_id; serviceClient bypasses RLS
-- so that filter IS the isolation. RLS on with no policy.
-- Idempotent + additive. After applying on hosted: NOTIFY pgrst,'reload schema';
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.callrail_calls (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id        uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  -- The CallRail company this call came from. Its practice_id is the call's
  -- practice; practice_id is denormalised here so a read never needs the join.
  --
  -- SET NULL, not CASCADE, and therefore nullable. Removing a company is a
  -- routine act — a key rotation, a misconfiguration fixed, a reconnect after
  -- a failure — and it is offered as a button in the panel. CASCADE would make
  -- that button silently delete every call the company ever fetched, including
  -- the `raw` payloads kept below for forensics, at exactly the moment someone
  -- is troubleshooting that connection. Because practice_id is denormalised
  -- onto the row, a call outlives its company with its attribution intact.
  -- Deleting calls, if ever wanted, must be an explicit act with its own
  -- confirmation, not a side effect of disconnecting.
  integration_account_id uuid REFERENCES integration_accounts(id) ON DELETE SET NULL,
  practice_id            uuid REFERENCES practices(id) ON DELETE SET NULL,
  -- CallRail's own id: the idempotency key. A webhook and a pull describing
  -- the same call must produce one row.
  callrail_id            text NOT NULL,
  tracking_number        text,
  caller_number          text,
  caller_phone10         text,     -- normalised; the dedup and matching key
  caller_name            text,
  caller_email           text,
  caller_email_norm      text,     -- normalised
  started_at             timestamptz NOT NULL,
  duration_seconds       integer,
  answered               boolean,
  first_call             boolean,  -- CallRail's own "first time this number called"
  gclid                  text,
  keywords               text,
  campaign               text,
  source                 text,     -- what CallRail itself attributes the call to
  raw                    jsonb,    -- payload as received, for forensics
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  UNIQUE (organisation_id, callrail_id)
);

DROP TRIGGER IF EXISTS callrail_calls_updated_at ON public.callrail_calls;
CREATE TRIGGER callrail_calls_updated_at BEFORE UPDATE ON public.callrail_calls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE public.callrail_calls ENABLE ROW LEVEL SECURITY;

-- The funnel reads one org's window; the matcher probes by phone; the panel
-- counts per company.
CREATE INDEX IF NOT EXISTS idx_callrail_calls_org_started
  ON public.callrail_calls (organisation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_callrail_calls_org_phone
  ON public.callrail_calls (organisation_id, caller_phone10)
  WHERE caller_phone10 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_callrail_calls_account
  ON public.callrail_calls (integration_account_id, started_at DESC);

NOTIFY pgrst, 'reload schema';
