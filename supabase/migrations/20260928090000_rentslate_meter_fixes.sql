-- RentSlate Meter: hardening and fixes.

-- 0. is_admin() ran as SECURITY INVOKER and reads admin_users, whose own
--    policy calls is_admin() — recursive once there is more than one admin.
--    As SECURITY DEFINER it reads admin_users without re-entering RLS.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admin_users where user_id = (select auth.uid())) $$;

-- 1. bootstrap_admin() ran as SECURITY INVOKER, but admin_users only has a
--    SELECT policy, so the first-admin INSERT was always rejected by RLS.
--    Run it as the definer instead, serialised so two simultaneous first
--    sign-ins cannot both become admin.
create or replace function public.bootstrap_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then return false; end if;
  perform pg_advisory_xact_lock(hashtext('public.bootstrap_admin'));
  if exists (select 1 from public.admin_users) then
    return exists (select 1 from public.admin_users where user_id = uid);
  end if;
  insert into public.admin_users(user_id) values (uid) on conflict do nothing;
  return true;
end $$;

revoke all on function public.bootstrap_admin() from public, anon;
grant execute on function public.bootstrap_admin() to authenticated;

-- 2. The owner console writes approval/payment audit events, but bill_events
--    only allowed SELECT, so those inserts silently failed.
drop policy if exists "admin bill events insert" on public.bill_events;
create policy "admin bill events insert" on public.bill_events for insert to authenticated
with check (public.is_admin());

-- 3. Every property gets billing settings (default Rs. 10 / kWh).
create or replace function public.create_default_billing_settings()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.billing_settings(property_id) values (new.id) on conflict (property_id) do nothing;
  return new;
end $$;

drop trigger if exists properties_default_billing_settings on public.properties;
create trigger properties_default_billing_settings after insert on public.properties
for each row execute function public.create_default_billing_settings();

insert into public.billing_settings(property_id)
select id from public.properties p
where not exists (select 1 from public.billing_settings s where s.property_id = p.id);

-- 4. At most one open (pending or unpaid) bill per meter, enforced in the
--    database so the tenant portal and owner console cannot race each other.
--    Skipped (with a notice) if existing data already violates it.
do $$
begin
  if exists (
    select meter_id from public.electricity_bills
    where status in ('PENDING_APPROVAL','APPROVED')
    group by meter_id having count(*) > 1
  ) then
    raise notice 'one_open_bill_per_meter not created: resolve meters with several open bills, then re-run this statement.';
  else
    create unique index if not exists one_open_bill_per_meter
      on public.electricity_bills(meter_id) where status in ('PENDING_APPROVAL','APPROVED');
  end if;
end $$;

create index if not exists bill_payments_bill_date_idx on public.bill_payments(bill_id, payment_date desc);
