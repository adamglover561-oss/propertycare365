ALTER TABLE public.membership_checkout_consents DROP CONSTRAINT membership_checkout_consents_version_price_check;
ALTER TABLE public.membership_checkout_consents ADD CONSTRAINT membership_checkout_consents_version_price_check CHECK ((terms_version = '1.2' AND monthly_price_pence IN (4900,4400,3900)) OR (terms_version = '1.3' AND monthly_price_pence = 1999) OR (terms_version = '1.4' AND monthly_price_pence IN (1999,1799)));
ALTER POLICY "Customer can accept terms for own property" ON public.membership_checkout_consents WITH CHECK (
EXISTS (SELECT 1 FROM public.customers c JOIN public.properties p ON p.customer_id=c.id
WHERE c.id=membership_checkout_consents.customer_id AND p.id=membership_checkout_consents.property_id AND c.user_id=(SELECT auth.uid()))
AND (monthly_price_pence<>1799 OR EXISTS (
SELECT 1 FROM public.property_cover pc JOIN public.subscriptions s ON s.id=pc.subscription_id JOIN public.plans pl ON pl.id=pc.plan_id
WHERE s.customer_id=membership_checkout_consents.customer_id AND pc.property_id<>membership_checkout_consents.property_id
AND pc.active AND s.status='active' AND pl.code='home_care_core_1999')));
