-- integrations.secrets must hold a base64 STRING, not raw bytea.
--
-- A Node Buffer passed to supabase-js `.upsert()` is JSON-serialized to
-- {"type":"Buffer","data":[...]}, so the bytea column stored that JSON rather
-- than the ciphertext, and decryption failed at sync time ("undecryptable API
-- key", integration stuck on status='failed'/no_auth). lib/crypto.js now
-- stores and reads a base64 string; this column becomes TEXT so the value
-- round-trips verbatim.
--
-- Existing values are the corrupt JSON-buffer form and cannot be decrypted, so
-- they are dropped — providers reconnect (connect re-encrypts the token). On a
-- clean db reset the column is created fresh; this ALTER is then a no-op-ish
-- retype with no rows.

ALTER TABLE public.integrations ALTER COLUMN secrets TYPE TEXT USING NULL::text;

UPDATE public.integrations
   SET status = 'pending', last_error = 'reconnect required (secret storage upgrade)'
 WHERE secrets IS NULL AND status <> 'revoked';

-- After hosted apply: PostgREST schema cache goes stale (recurring gotcha).
NOTIFY pgrst, 'reload schema';
