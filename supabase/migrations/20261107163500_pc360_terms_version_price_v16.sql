-- Allow new Property Care 360 contract terms to be accepted at checkout.
-- Older accepted agreements and their permitted prices remain valid.
-- Live production was repaired on 2026-11-07 using Supabase migration
-- accept_pc360_terms_v15_v16_checkout_prices; this file keeps code deployments aligned.
ALTER TABLE public.membership_checkout_consents
  DROP CONSTRAINT IF EXISTS membership_checkout_consents_version_price_check;
ALTER TABLE public.membership_checkout_consents
  ADD CONSTRAINT membership_checkout_consents_version_price_check
  CHECK (
    (terms_version = '1.2' AND monthly_price_pence IN (4900, 4400, 3900))
    OR (terms_version = '1.3' AND monthly_price_pence = 1999)
    OR (terms_version IN ('1.4', '1.5', '1.6') AND monthly_price_pence IN (1999, 1799))
  );
