-- Immutable, customer-visible evidence of agreeing to a twelve-month
-- initial minimum term for each individual property before Stripe checkout.
CREATE TABLE IF NOT EXISTS public.membership_checkout_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  terms_version text NOT NULL CHECK (terms_version = '1.2'),
  monthly_price_pence integer NOT NULL CHECK (monthly_price_pence IN (4900, 4400, 3900)),
  initial_term_months integer NOT NULL DEFAULT 12 CHECK (initial_term_months = 12),
  first_year_total_pence integer GENERATED ALWAYS AS (monthly_price_pence * initial_term_months) STORED,
  early_service_requested boolean NOT NULL DEFAULT false,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS membership_checkout_consents_customer_property_idx
ON public.membership_checkout_consents(customer_id, property_id, accepted_at DESC);
ALTER TABLE public.membership_checkout_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_checkout_consents FROM anon;
GRANT SELECT, INSERT ON public.membership_checkout_consents TO authenticated;

CREATE POLICY "Customer can view own checkout consents"
ON public.membership_checkout_consents FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = customer_id AND c.user_id = (SELECT auth.uid())
  )
);
CREATE POLICY "Customer can accept terms for own property"
ON public.membership_checkout_consents FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.customers c
    JOIN public.properties p ON p.customer_id = c.id
    WHERE c.id = customer_id
      AND p.id = property_id
      AND c.user_id = (SELECT auth.uid())
  )
);
COMMENT ON TABLE public.membership_checkout_consents IS
  'Append-only acceptance evidence for each property checkout. No customer update/delete policies; initial term begins at first successful payment, not at consent.';
