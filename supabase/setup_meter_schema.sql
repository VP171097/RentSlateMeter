-- RentSlate Meter inside the Finance Dashboard Supabase project.
-- Everything lives in its own schema "meter", so it cannot clash with or read
-- Finance Dashboard tables. Storage buckets are "meter-bills" and "meter-photos".
-- Run once in SQL Editor (safe to re-run only on an empty "meter" schema).
-- AFTER running: Project Settings → API (Data API) → Exposed schemas → add "meter".

create schema if not exists meter;
grant usage on schema meter to anon, authenticated, service_role;
alter default privileges in schema meter grant all on tables to anon, authenticated, service_role;
alter default privileges in schema meter grant all on functions to anon, authenticated, service_role;
alter default privileges in schema meter grant all on sequences to anon, authenticated, service_role;

-- ── from 20260927061615_initial_dynamic_qr_schema.sql ──
create extension if not exists pgcrypto;

create table meter.properties (id uuid primary key default gen_random_uuid(), name text not null, address text, created_at timestamptz not null default now());
create table meter.rooms (id uuid primary key default gen_random_uuid(), property_id uuid not null references meter.properties(id) on delete cascade, floor text not null, room_number text not null, created_at timestamptz not null default now(), unique(property_id,room_number));
create table meter.tenants (id uuid primary key default gen_random_uuid(), property_id uuid not null references meter.properties(id) on delete cascade, name text not null, phone text, notes text, created_at timestamptz not null default now());
create table meter.meters (id uuid primary key default gen_random_uuid(), property_id uuid not null references meter.properties(id) on delete cascade, room_id uuid references meter.rooms(id) on delete set null, meter_code text not null, meter_number text, meter_type text not null default 'Electricity', status text not null default 'active' check(status in ('active','inactive','maintenance')), public_token uuid not null default gen_random_uuid() unique, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(property_id,meter_code));
create table meter.tenant_assignments (id uuid primary key default gen_random_uuid(), meter_id uuid not null references meter.meters(id) on delete cascade, tenant_id uuid not null references meter.tenants(id) on delete cascade, room_id uuid references meter.rooms(id) on delete set null, move_in_date date not null default current_date, move_out_date date, created_at timestamptz not null default now(), check(move_out_date is null or move_out_date>=move_in_date));
create unique index one_active_tenant_per_meter on meter.tenant_assignments(meter_id) where move_out_date is null;
create table meter.meter_readings (id uuid primary key default gen_random_uuid(), meter_id uuid not null references meter.meters(id) on delete cascade, reading numeric(14,3) not null check(reading>=0), reading_date date not null default current_date, photo_url text, notes text, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now());
create table meter.admin_users (user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now());

alter table meter.properties enable row level security;
alter table meter.rooms enable row level security;
alter table meter.tenants enable row level security;
alter table meter.meters enable row level security;
alter table meter.tenant_assignments enable row level security;
alter table meter.meter_readings enable row level security;
alter table meter.admin_users enable row level security;

create or replace function meter.is_admin() returns boolean language sql stable security invoker set search_path=meter as $$ select exists(select 1 from meter.admin_users where user_id=(select auth.uid())) $$;

create policy "public scan active meters" on meter.meters for select to anon,authenticated using(status='active');
create policy "public scan rooms" on meter.rooms for select to anon,authenticated using(exists(select 1 from meter.meters m where m.room_id=rooms.id and m.status='active'));
create policy "public scan assignments" on meter.tenant_assignments for select to anon,authenticated using(move_out_date is null and exists(select 1 from meter.meters m where m.id=tenant_assignments.meter_id and m.status='active'));
create policy "public scan tenants" on meter.tenants for select to anon,authenticated using(exists(select 1 from meter.tenant_assignments a where a.tenant_id=tenants.id and a.move_out_date is null));

create policy "admin properties" on meter.properties for all to authenticated using(meter.is_admin()) with check(meter.is_admin());
create policy "admin rooms" on meter.rooms for all to authenticated using(meter.is_admin()) with check(meter.is_admin());
create policy "admin tenants" on meter.tenants for all to authenticated using(meter.is_admin()) with check(meter.is_admin());
create policy "admin meters" on meter.meters for all to authenticated using(meter.is_admin()) with check(meter.is_admin());
create policy "admin assignments" on meter.tenant_assignments for all to authenticated using(meter.is_admin()) with check(meter.is_admin());
create policy "admin readings" on meter.meter_readings for all to authenticated using(meter.is_admin()) with check(meter.is_admin());
create policy "admin users self" on meter.admin_users for select to authenticated using(user_id=(select auth.uid()) or meter.is_admin());

create or replace function meter.set_updated_at() returns trigger language plpgsql set search_path=meter as $$ begin new.updated_at=now(); return new; end $$;
create trigger meters_updated_at before update on meter.meters for each row execute function meter.set_updated_at();

-- ── from 20260927062255_electricity_billing_system.sql ──
alter table meter.meters add column if not exists opening_reading numeric(14,3) not null default 0 check(opening_reading >= 0);

create table if not exists meter.billing_settings (
  property_id uuid primary key references meter.properties(id) on delete cascade,
  rate_per_unit numeric(12,2) not null default 10.00,
  fixed_charge numeric(12,2) not null default 0,
  tax_percent numeric(6,3) not null default 0,
  due_days integer not null default 7,
  currency text not null default 'INR',
  updated_at timestamptz not null default now()
);

create table if not exists meter.electricity_bills (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references meter.properties(id) on delete cascade,
  meter_id uuid not null references meter.meters(id) on delete restrict,
  tenant_id uuid references meter.tenants(id) on delete set null,
  bill_number text not null unique,
  bill_date date not null default current_date,
  previous_reading numeric(14,3) not null check(previous_reading >= 0),
  current_reading numeric(14,3) not null check(current_reading >= 0),
  reading_date date not null default current_date,
  units numeric(14,3) generated always as (current_reading - previous_reading) stored,
  rate_per_unit numeric(12,2) not null check(rate_per_unit >= 0),
  energy_charge numeric(14,2) not null default 0,
  fixed_charge numeric(14,2) not null default 0,
  other_charge numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  status text not null default 'PENDING_APPROVAL' check(status in ('PENDING_APPROVAL','APPROVED','PAID','CANCELLED')),
  source text not null check(source in ('TENANT','OWNER')),
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  pdf_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(current_reading >= previous_reading)
);
create index if not exists electricity_bills_meter_date_idx on meter.electricity_bills(meter_id,bill_date desc);
create index if not exists electricity_bills_tenant_date_idx on meter.electricity_bills(tenant_id,bill_date desc);

create table if not exists meter.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references meter.electricity_bills(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check(amount > 0),
  payment_mode text not null default 'Cash',
  receipt_no text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists meter.bill_events (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references meter.electricity_bills(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

drop policy if exists "public scan active meters" on meter.meters;
drop policy if exists "public scan rooms" on meter.rooms;
drop policy if exists "public scan assignments" on meter.tenant_assignments;
drop policy if exists "public scan tenants" on meter.tenants;

alter table meter.billing_settings enable row level security;
alter table meter.electricity_bills enable row level security;
alter table meter.bill_payments enable row level security;
alter table meter.bill_events enable row level security;

create policy "admin billing settings" on meter.billing_settings for all to authenticated using(meter.is_admin()) with check(meter.is_admin());
create policy "admin electricity bills" on meter.electricity_bills for all to authenticated using(meter.is_admin()) with check(meter.is_admin());
create policy "admin bill payments" on meter.bill_payments for all to authenticated using(meter.is_admin()) with check(meter.is_admin());
create policy "admin bill events" on meter.bill_events for select to authenticated using(meter.is_admin());

create or replace function meter.calculate_bill_amount(p_units numeric,p_rate numeric,p_fixed numeric,p_tax_percent numeric)
returns numeric language sql immutable set search_path=''
as $$ select round(greatest(p_units,0)*greatest(p_rate,0)+greatest(p_fixed,0)+((greatest(p_units,0)*greatest(p_rate,0)+greatest(p_fixed,0))*greatest(p_tax_percent,0)/100),2) $$;

create or replace function meter.set_bill_updated_at()
returns trigger language plpgsql set search_path=meter
as $$ begin new.updated_at=now(); return new; end $$;

drop trigger if exists electricity_bills_updated_at on meter.electricity_bills;
create trigger electricity_bills_updated_at before update on meter.electricity_bills for each row execute function meter.set_bill_updated_at();

insert into meter.billing_settings(property_id)
select id from meter.properties p
where not exists(select 1 from meter.billing_settings s where s.property_id=p.id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('meter-bills','meter-bills',false,5242880,array['application/pdf'])
on conflict(id) do nothing;

drop policy if exists "meter: admin bill pdf upload" on storage.objects;
create policy "meter: admin bill pdf upload" on storage.objects for insert to authenticated
with check(bucket_id='meter-bills' and meter.is_admin());
drop policy if exists "meter: admin bill pdf read" on storage.objects;
create policy "meter: admin bill pdf read" on storage.objects for select to authenticated
using(bucket_id='meter-bills' and meter.is_admin());
drop policy if exists "meter: admin bill pdf update" on storage.objects;
create policy "meter: admin bill pdf update" on storage.objects for update to authenticated
using(bucket_id='meter-bills' and meter.is_admin()) with check(bucket_id='meter-bills' and meter.is_admin());
drop policy if exists "meter: admin bill pdf delete" on storage.objects;
create policy "meter: admin bill pdf delete" on storage.objects for delete to authenticated
using(bucket_id='meter-bills' and meter.is_admin());

-- ── from 20260927070000_admin_bootstrap.sql ──
create or replace function meter.bootstrap_admin()
returns boolean
language plpgsql
security invoker
set search_path=meter
as $$
begin
  if (select auth.uid()) is null then return false; end if;
  if exists(select 1 from meter.admin_users) then
    return exists(select 1 from meter.admin_users where user_id=(select auth.uid()));
  end if;
  insert into meter.admin_users(user_id) values((select auth.uid())) on conflict do nothing;
  return true;
end $$;

grant execute on function meter.bootstrap_admin() to authenticated;

-- ── from 20260928090000_rentslate_meter_fixes.sql ──
-- RentSlate Meter: hardening and fixes.

-- 0. is_admin() ran as SECURITY INVOKER and reads admin_users, whose own
--    policy calls is_admin() — recursive once there is more than one admin.
--    As SECURITY DEFINER it reads admin_users without re-entering RLS.
create or replace function meter.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from meter.admin_users where user_id = (select auth.uid())) $$;

-- 1. bootstrap_admin() ran as SECURITY INVOKER, but admin_users only has a
--    SELECT policy, so the first-admin INSERT was always rejected by RLS.
--    Run it as the definer instead, serialised so two simultaneous first
--    sign-ins cannot both become admin.
create or replace function meter.bootstrap_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then return false; end if;
  perform pg_advisory_xact_lock(hashtext('meter.bootstrap_admin'));
  if exists (select 1 from meter.admin_users) then
    return exists (select 1 from meter.admin_users where user_id = uid);
  end if;
  insert into meter.admin_users(user_id) values (uid) on conflict do nothing;
  return true;
end $$;

revoke all on function meter.bootstrap_admin() from public, anon;
grant execute on function meter.bootstrap_admin() to authenticated;

-- 2. The owner console writes approval/payment audit events, but bill_events
--    only allowed SELECT, so those inserts silently failed.
drop policy if exists "admin bill events insert" on meter.bill_events;
create policy "admin bill events insert" on meter.bill_events for insert to authenticated
with check (meter.is_admin());

-- 3. Every property gets billing settings (default Rs. 10 / kWh).
create or replace function meter.create_default_billing_settings()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into meter.billing_settings(property_id) values (new.id) on conflict (property_id) do nothing;
  return new;
end $$;

drop trigger if exists properties_default_billing_settings on meter.properties;
create trigger properties_default_billing_settings after insert on meter.properties
for each row execute function meter.create_default_billing_settings();

insert into meter.billing_settings(property_id)
select id from meter.properties p
where not exists (select 1 from meter.billing_settings s where s.property_id = p.id);

-- 4. At most one open (pending or unpaid) bill per meter, enforced in the
--    database so the tenant portal and owner console cannot race each other.
--    Skipped (with a notice) if existing data already violates it.
do $$
begin
  if exists (
    select meter_id from meter.electricity_bills
    where status in ('PENDING_APPROVAL','APPROVED')
    group by meter_id having count(*) > 1
  ) then
    raise notice 'one_open_bill_per_meter not created: resolve meters with several open bills, then re-run this statement.';
  else
    create unique index if not exists one_open_bill_per_meter
      on meter.electricity_bills(meter_id) where status in ('PENDING_APPROVAL','APPROVED');
  end if;
end $$;

create index if not exists bill_payments_bill_date_idx on meter.bill_payments(bill_id, payment_date desc);

-- ── from 20260928100000_meter_photos.sql ──
-- Tenant readings must include a photo of the meter so the owner can verify
-- the reading before approving the bill.
alter table meter.electricity_bills add column if not exists reading_photo_path text;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('meter-photos', 'meter-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Tenants upload through the meter-portal Edge Function (service role), so
-- only admins get direct access to the bucket.
drop policy if exists "admin meter photo read" on storage.objects;
drop policy if exists "meter: admin meter photo read" on storage.objects;
create policy "meter: admin meter photo read" on storage.objects for select to authenticated
using (bucket_id = 'meter-photos' and meter.is_admin());
drop policy if exists "admin meter photo upload" on storage.objects;
drop policy if exists "meter: admin meter photo upload" on storage.objects;
create policy "meter: admin meter photo upload" on storage.objects for insert to authenticated
with check (bucket_id = 'meter-photos' and meter.is_admin());
drop policy if exists "admin meter photo delete" on storage.objects;
drop policy if exists "meter: admin meter photo delete" on storage.objects;
create policy "meter: admin meter photo delete" on storage.objects for delete to authenticated
using (bucket_id = 'meter-photos' and meter.is_admin());

-- ── from 20260928110000_owner_login.sql ──
-- Owner login: lets the sign-in page offer "Set up owner account" only until
-- the first administrator exists. Returns a boolean only — no user data.
create or replace function meter.admin_exists()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from meter.admin_users) $$;

revoke all on function meter.admin_exists() from public;
grant execute on function meter.admin_exists() to anon, authenticated;

-- ── from 20260928120000_delete_meter.sql ──
-- Delete a meter and everything that belongs to it in one transaction:
--   bills (+ their payments and audit events, via ON DELETE CASCADE),
--   tenant assignments and meter readings (cascade from meters),
--   tenant records left with no other room, and the room if now empty.
-- Stored PDFs / meter photos live under <property_id>/<meter_id>/ in the
-- electricity-bills and meter-photos buckets; the app removes that folder
-- through the Storage API after this succeeds (returned as storage_prefix).
create or replace function meter.delete_meter(p_meter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  v_tenants uuid[];
  v_bills int := 0;
  v_tenants_deleted int := 0;
  v_room_deleted boolean := false;
begin
  if not meter.is_admin() then
    raise exception 'Only the property owner can delete meters.' using errcode = '42501';
  end if;

  select id, property_id, room_id into m from meter.meters where id = p_meter_id for update;
  if not found then
    raise exception 'Meter not found.' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct tenant_id), '{}') into v_tenants
  from meter.tenant_assignments where meter_id = m.id;

  delete from meter.electricity_bills where meter_id = m.id;
  get diagnostics v_bills = row_count;

  delete from meter.meters where id = m.id;

  with gone as (
    delete from meter.tenants t
    where t.id = any (v_tenants)
      and not exists (select 1 from meter.tenant_assignments a where a.tenant_id = t.id)
    returning 1
  )
  select count(*) into v_tenants_deleted from gone;

  if m.room_id is not null and not exists (select 1 from meter.meters where room_id = m.room_id) then
    delete from meter.rooms where id = m.room_id;
    v_room_deleted := true;
  end if;

  return jsonb_build_object(
    'bills_deleted', v_bills,
    'tenants_deleted', v_tenants_deleted,
    'room_deleted', v_room_deleted,
    'storage_prefix', m.property_id::text || '/' || m.id::text
  );
end $$;

revoke all on function meter.delete_meter(uuid) from public, anon;
grant execute on function meter.delete_meter(uuid) to authenticated;

-- ── from 20260928130000_delete_meter_tenants.sql ──
-- delete_meter(): also delete the tenant details of everyone who was ever
-- assigned to the meter. The only tenants kept are those currently living in
-- another room (an active assignment on a different meter), since deleting
-- them would remove that room's current tenant.
create or replace function meter.delete_meter(p_meter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
  v_tenants uuid[];
  v_bills int := 0;
  v_tenants_deleted int := 0;
  v_tenants_kept int := 0;
  v_room_deleted boolean := false;
begin
  if not meter.is_admin() then
    raise exception 'Only the property owner can delete meters.' using errcode = '42501';
  end if;

  select id, property_id, room_id into m from meter.meters where id = p_meter_id for update;
  if not found then
    raise exception 'Meter not found.' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct tenant_id), '{}') into v_tenants
  from meter.tenant_assignments where meter_id = m.id;

  -- Bills first (payments and audit events cascade); bills.meter_id is ON DELETE RESTRICT.
  delete from meter.electricity_bills where meter_id = m.id;
  get diagnostics v_bills = row_count;

  -- Meter next (its tenant assignments and readings cascade).
  delete from meter.meters where id = m.id;

  -- Tenant details: delete everyone linked to this meter unless they currently
  -- live in another room. Their remaining past assignments elsewhere cascade.
  with gone as (
    delete from meter.tenants t
    where t.id = any (v_tenants)
      and not exists (
        select 1 from meter.tenant_assignments a
        where a.tenant_id = t.id and a.move_out_date is null
      )
    returning 1
  )
  select count(*) into v_tenants_deleted from gone;
  v_tenants_kept := cardinality(v_tenants) - v_tenants_deleted;

  if m.room_id is not null and not exists (select 1 from meter.meters where room_id = m.room_id) then
    delete from meter.rooms where id = m.room_id;
    v_room_deleted := true;
  end if;

  return jsonb_build_object(
    'bills_deleted', v_bills,
    'tenants_deleted', v_tenants_deleted,
    'tenants_kept_active_elsewhere', v_tenants_kept,
    'room_deleted', v_room_deleted,
    'storage_prefix', m.property_id::text || '/' || m.id::text
  );
end $$;

revoke all on function meter.delete_meter(uuid) from public, anon;
grant execute on function meter.delete_meter(uuid) to authenticated;

-- ── from 20260928140000_bill_rent.sql ──
-- Optional rent on an electricity bill. When rent_amount is 0 (the default),
-- the bill is electricity-only and rent is not shown anywhere.
alter table meter.electricity_bills
  add column if not exists rent_amount numeric(14,2) not null default 0,
  add column if not exists rent_period text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'electricity_bills_rent_amount_check') then
    alter table meter.electricity_bills add constraint electricity_bills_rent_amount_check check (rent_amount >= 0);
  end if;
end $$;


-- Table/function access goes through RLS above; grant the API roles access to the schema's objects.
grant all on all tables in schema meter to anon, authenticated, service_role;
grant all on all functions in schema meter to anon, authenticated, service_role;
grant all on all sequences in schema meter to anon, authenticated, service_role;
-- Functions that must not be callable by anonymous visitors.
revoke all on function meter.bootstrap_admin() from public, anon;
revoke all on function meter.delete_meter(uuid) from public, anon;
grant execute on function meter.admin_exists() to anon, authenticated;
