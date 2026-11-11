-- Owner-only soft archive for test and cancelled customer records.
-- No auth user, Stripe, billing, property, report, or job records are deleted.
alter table public.customers
  add column if not exists archived_at timestamptz;
comment on column public.customers.archived_at is
  'Owner archive timestamp; null means active. Financial and service history remain preserved.';

create or replace function public.set_customer_archived(
  p_customer_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  record_to_archive public.customers%rowtype;
begin
  if (select auth.uid()) is null or not (select private.is_home_care_admin()) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  if p_customer_id is null or p_archived is null then
    raise exception 'A customer and an archive choice are required';
  end if;

  select * into record_to_archive
  from public.customers
  where id = p_customer_id
  for update;
  if not found then
    raise exception 'Customer not found';
  end if;

  -- Never archive the current owner, any recognised owner account, or the app-review demo.
  if record_to_archive.user_id = (select auth.uid())
    or exists (
      select 1
      from private.owner_identity o
      where o.email_hash = encode(
        extensions.digest(lower(coalesce(record_to_archive.email, ''))::bytea,'sha256'), 'hex'
      )
    )
    or lower(coalesce(record_to_archive.email, '')) = 'app-review@propertycare360.co.uk'
  then
    raise exception 'Owner and app-review accounts cannot be archived' using errcode = '42501';
  end if;

  -- Never hide a subscription still requiring operational or billing attention.
  if p_archived and exists (
    select 1 from public.subscriptions s
    where s.customer_id = p_customer_id
      and s.status in ('active','trialing','past_due','incomplete','paused','unpaid')
  ) then
    raise exception 'Cancel or resolve this customer subscription before archiving';
  end if;

  update public.customers
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
      updated_at = now()
  where id = p_customer_id;
end;
$function$;

revoke execute on function public.set_customer_archived(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_customer_archived(uuid, boolean) to authenticated;
