-- ============================================================================
-- LOCAL DEV: Custom Access Token Hook
-- ============================================================================
-- README principle #9: without this, RLS returns zero rows and the app
-- appears broken with no errors. Repo defines it in the Supabase dashboard
-- for prod; this migration provides the equivalent for local dev.
-- Injects organisation_id + role claims from public.users into the JWT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  u public.users%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = (event->>'user_id')::uuid;

  claims := event->'claims';

  IF u.id IS NOT NULL THEN
    claims := jsonb_set(claims, '{organisation_id}', to_jsonb(u.organisation_id));
    claims := jsonb_set(claims, '{role}', to_jsonb(u.role));
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT ALL ON TABLE public.users TO supabase_auth_admin;
