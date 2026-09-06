-- ===========================================================================
-- Open days — named marketing events, and the campaigns that promoted them.
--
-- WHY EVENTS RATHER THAN A FLAG. This group runs an open day roughly every
-- two months, and each one is promoted by SEVERAL campaigns across SEVERAL
-- ad accounts: July 26 alone is five campaign names spanning Rochester,
-- Ashford and Barnet, split by theme (Implants, Cosmetic). A boolean would
-- add every open day ever run into one bucket and could never answer "what
-- did the July event cost and produce" — which is the only question anyone
-- asks about an event.
--
-- WHY EXPLICIT MAPPING AND NOT A NAME RULE. 37 of this org's 84 Meta
-- campaigns mention an open day, under names no regex survives: `05/25`,
-- `5/25`, `August 25`, `Aug 25`, `- Copy`, `LF TEST -`, and the practice
-- sometimes in the name and sometimes not. Same lesson as practice naming:
-- a match on a human-typed label is a silent misgrouping waiting to happen.
--
-- THE PARTITION IS ENFORCED BY THE PRIMARY KEY, not by application code.
-- (organisation_id, provider, campaign_id) means a campaign belongs to at
-- most ONE open day, so "always-on" is exactly "not in this table" and the
-- two buckets provably cover every campaign exactly once. The Facebook page
-- shows Always-on + Open days = Meta total as an on-screen identity; that
-- claim is only honest because the key below makes double-counting
-- impossible rather than merely unlikely.
--
-- provider is in the key though only Meta gets a UI. Google runs open days
-- too; one column now saves a second table later, and the CHECK keeps the
-- values closed.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.ad_open_days (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  -- Nullable: an owner recording a past event may not remember the date, and
  -- refusing the mapping over it would lose the campaign grouping, which is
  -- the part that carries the numbers.
  event_date      date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Lets the child table carry a COMPOSITE foreign key, so a mapping can
  -- never point at another tenant's event even if a service forgets to check.
  UNIQUE (organisation_id, id)
);

-- One event per name per org, case- and whitespace-insensitively: "July 26"
-- and "july 26 " are the same open day typed twice, and two of them would
-- split one event's spend across two rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_open_days_org_name
  ON public.ad_open_days (organisation_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_ad_open_days_org_date
  ON public.ad_open_days (organisation_id, event_date DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.ad_open_day_campaigns (
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  open_day_id     uuid NOT NULL,
  provider        text NOT NULL CHECK (provider IN ('meta_ads', 'google_ads')),
  -- The ad account the campaign belongs to. Denormalised so the mapping UI
  -- can group by account without joining ad_metrics, and because campaign
  -- NAMES repeat across accounts (the same name runs in two of them) while
  -- campaign_id does not.
  customer_id     text,
  campaign_id     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- THE PARTITION GUARANTEE. See this file's header.
  PRIMARY KEY (organisation_id, provider, campaign_id),
  FOREIGN KEY (organisation_id, open_day_id)
    REFERENCES public.ad_open_days (organisation_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ad_open_day_campaigns_event
  ON public.ad_open_day_campaigns (open_day_id);

-- RLS on, zero policies — the house convention for business tables here
-- (ad_channel_pipelines, ad_meta_ads, emergent_practice_map). Reads go
-- through repositories on the service client with an explicit
-- organisation_id filter; the switch being ON means a stray anon/authenticated
-- client gets nothing rather than everything.
ALTER TABLE public.ad_open_days           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_open_day_campaigns  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ad_open_days          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_open_day_campaigns FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ad_open_days           TO service_role;
GRANT ALL ON public.ad_open_day_campaigns  TO service_role;

NOTIFY pgrst, 'reload schema';
