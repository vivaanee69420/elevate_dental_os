-- ============================================================================
-- Let a payment be stored whatever Dentally calls the method.
--
-- WHY. `payments_method_check` accepted nine values. mapPaymentMethod's fallback
-- slugified anything it did not recognise, so "Other" became 'other' and
-- "American Express" became 'american_express' — neither of which the constraint
-- allows. Postgres rejected the row, upsertChunked logged "skipped N unstorable
-- row(s)" and the sync carried on, so the payment was dropped SILENTLY and
-- Takings stayed short by exactly that much, permanently: the nightly pull is
-- `updated_after`-driven, so it never revisits a record it already failed on.
--
-- Measured on the live project over 12 months (Sep 2025 - Sep 2026), 13,390
-- Dentally payments compared row by row against ours: 183 could not be stored,
-- worth GBP 7,540.45.
--
--     Other             181    GBP 7,446.45
--     American Express    1    GBP   134.00
--     Cheque              1    GBP   -40.00
--
-- Note 'cheque' was already in the sync's own canon table while being absent
-- here — the two lists had simply never been checked against each other, which
-- is why the code side now pins this exact list in a test.
--
-- The full method vocabulary the live account sends, by volume: Debit Card,
-- Credit Card, Stripe, Cash, Other, BACS, Finance, Bank Transfer,
-- American Express, Cheque.
--
-- WHAT CHANGES. Three additions — 'cheque', 'amex', 'other'. The constraint is
-- kept (rather than dropped) because it still does real work: the mapper now
-- emits a CLOSED set and anything unrecognised is bucketed honestly as 'other',
-- so the constraint's job is to catch a future mapper that breaks that promise,
-- not to reject a payment for being unfamiliar. Folding cheque/amex into 'card'
-- would have stored the money while misreporting how it arrived.
--
-- No data migration: the rows this was rejecting were never written, so there is
-- nothing to correct in place. They are re-fetched from Dentally by
-- reconcileMissingRecords, which exists precisely because an `updated_after`
-- feed can never go back for a record it missed.
-- ============================================================================

alter table public.payments drop constraint if exists payments_method_check;

alter table public.payments add constraint payments_method_check
  check (method = any (array[
    'card', 'apple_pay', 'google_pay', 'bank_transfer', 'cash',
    'direct_debit', 'finance', 'card_on_file', 'pay_link',
    'cheque', 'amex', 'other'
  ]));

notify pgrst, 'reload schema';
