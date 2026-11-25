-- Keep membership, checkout and service history intact when removing an unused property.
create or replace function public.delete_unused_property(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.properties%rowtype;
begin
  if (select auth.uid()) is null or not (select private.is_home_care_admin()) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  -- A foreign-key insert referencing this property must wait for the row lock.
  select * into target from public.properties where id = p_property_id for update;
  if not found then
    return;
  end if;

  if not exists (
    select 1 from public.customers c
    where c.id = target.customer_id
      and c.archived_at is null
      and c.user_id is distinct from (select auth.uid())
      and lower(coalesce(c.email, '')) <> 'app-review@propertycare360.co.uk'
      and not exists (
        select 1 from private.owner_identity o
        where o.email_hash = encode(
          extensions.digest(lower(coalesce(c.email, ''))::bytea, 'sha256'), 'hex'
        )
      )
  ) then
    raise exception 'Only properties on live customer accounts can be removed' using errcode = '42501';
  end if;

  if exists (select 1 from public.property_cover where property_id = target.id)
    or exists (select 1 from public.membership_checkout_consents where property_id = target.id)
    or exists (select 1 from public.jobs where property_id = target.id)
    or exists (select 1 from public.reports where property_id = target.id)
    or exists (select 1 from public.billing_records where property_id = target.id)
  then
    raise exception 'This property has membership, checkout, service or billing records';
  end if;

  delete from public.properties where id = target.id;
end;
$$;

revoke execute on function public.delete_unused_property(uuid) from public, anon, authenticated;
grant execute on function public.delete_unused_property(uuid) to authenticated;
