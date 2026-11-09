-- Version 1.7 permits identical online rates for eligible gas, LPG and oil properties.
-- Keep historical membership terms versions and prices legally intact.
ALTER TABLE public.membership_checkout_consents
  DROP CONSTRAINT IF EXISTS membership_checkout_consents_version_price_check;
ALTER TABLE public.membership_checkout_consents
  ADD CONSTRAINT membership_checkout_consents_version_price_check
  CHECK (
    (terms_version = '1.2' AND monthly_price_pence IN (4900, 4400, 3900))
    OR (terms_version = '1.3' AND monthly_price_pence = 1999)
    OR (terms_version IN ('1.4', '1.5', '1.6', '1.7') AND monthly_price_pence IN (1999, 1799))
  );
