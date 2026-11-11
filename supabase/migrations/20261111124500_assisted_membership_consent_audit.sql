-- Preserve evidence of informed, customer-performed assisted subscription acceptance.
-- The existing consent table remains owner/customer read-protected by RLS.
alter table public.membership_checkout_consents
  add column if not exists acceptance_channel text not null default 'self_service',
  add column if not exists accepted_by_name text,
  add column if not exists assisted_by uuid references auth.users(id);
alter table public.membership_checkout_consents
  add constraint pc360_assisted_acceptance_channel_check
  check (acceptance_channel in ('self_service','assisted_in_person'));
alter table public.membership_checkout_consents
  add constraint pc360_assisted_customer_name_required
  check (acceptance_channel <> 'assisted_in_person' or
    (accepted_by_name is not null and length(trim(accepted_by_name)) >= 3 and assisted_by is not null));
