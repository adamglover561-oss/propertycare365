alter policy jobs_insert_own_or_admin on public.jobs with check (
  (select private.is_home_care_admin())
  or (
    exists(select 1 from public.customers c join public.properties p on p.customer_id=c.id
      where c.id=jobs.customer_id and c.user_id=(select auth.uid()) and p.id=jobs.property_id)
    and status='requested' and booking_source='customer'
    and calendar_event_id is null and calendar_event_url is null and completed_at is null
    and materials_charge_pence=0
    and (not labour_covered or exists(select 1 from public.property_cover pc join public.subscriptions s on s.id=pc.subscription_id where pc.property_id=jobs.property_id and pc.active and s.status in ('active','trialing','past_due')))
    and (scheduled_for is null or (
      scheduled_for>now() and calendar_sync_status='pending'
      and exists(select 1 from public.property_cover pc join public.subscriptions s on s.id=pc.subscription_id where pc.property_id=jobs.property_id and pc.active and s.status in ('active','trialing','past_due'))
    ))
  )
);
