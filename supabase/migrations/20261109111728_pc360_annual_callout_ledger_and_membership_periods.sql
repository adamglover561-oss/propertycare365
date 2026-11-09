-- Property Care 360: keep the contractual annual allowance anchored to first payment.
alter table public.property_cover
  add column if not exists membership_started_at timestamptz,
  add column if not exists annual_callouts_included integer
    check (annual_callouts_included between 0 and 20);

create table if not exists public.member_callout_usage (
  id uuid primary key default gen_random_uuid(),
  property_cover_id uuid not null references public.property_cover(id) on delete restrict,
  job_id uuid not null unique references public.jobs(id) on delete restrict,
  attended_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index if not exists member_callout_usage_cover_attended_idx
  on public.member_callout_usage(property_cover_id, attended_at);
alter table public.member_callout_usage enable row level security;

create policy "members_read_own_callout_usage" on public.member_callout_usage
  for select to authenticated
  using (
    (select private.is_home_care_admin())
    or exists (
      select 1 from public.property_cover pc
      join public.subscriptions s on s.id = pc.subscription_id
      join public.customers c on c.id = s.customer_id
      where pc.id = member_callout_usage.property_cover_id and c.user_id = (select auth.uid())
    )
  );

-- Completed breakdown and repair visits are attendance, not requests or annual service.
create or replace function private.record_completed_member_callout()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare cover_uuid uuid;
begin
  if new.status = 'completed'
    and old.status is distinct from 'completed'
    and new.job_type in ('breakdown','repair') then
    select pc.id into cover_uuid
    from public.property_cover pc
    join public.subscriptions s on s.id = pc.subscription_id
    where pc.property_id = new.property_id
      and pc.active
      and s.status in ('active','trialing')
      and pc.membership_started_at is not null
      and pc.annual_callouts_included is not null
    order by pc.membership_started_at asc limit 1;
    if cover_uuid is not null then
      insert into public.member_callout_usage(property_cover_id,job_id,attended_at)
      values(cover_uuid,new.id,coalesce(new.completed_at, now()))
      on conflict(job_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.record_completed_member_callout() from public;
drop trigger if exists record_completed_member_callout on public.jobs;
create trigger record_completed_member_callout
after update of status on public.jobs
for each row execute function private.record_completed_member_callout();

create or replace view public.membership_callout_balances
with (security_invoker = true) as
select pc.id as cover_id, pc.property_id,
  pc.membership_started_at, pc.annual_callouts_included,
  yrs.year_start as membership_year_start,
  yrs.year_start + interval '1 year' as membership_year_end,
  coalesce(used.used_callouts,0) as used_callouts,
  greatest(0, pc.annual_callouts_included - coalesce(used.used_callouts,0)) as remaining_callouts
from public.property_cover pc
cross join lateral (
  select max(pc.membership_started_at + (n * interval '1 year')) as year_start
  from generate_series(0,99) as n
  where pc.membership_started_at + (n * interval '1 year') <= now()
) yrs
cross join lateral (
  select count(*)::integer as used_callouts
  from public.member_callout_usage u
  where u.property_cover_id = pc.id
    and u.attended_at >= yrs.year_start
    and u.attended_at < yrs.year_start + interval '1 year'
) used
where pc.membership_started_at is not null
  and pc.annual_callouts_included is not null;
revoke all on public.membership_callout_balances from anon;
grant select on public.membership_callout_balances to authenticated;
