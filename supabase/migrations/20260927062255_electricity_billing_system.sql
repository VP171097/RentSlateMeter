alter table public.meters add column if not exists opening_reading numeric(14,3) not null default 0 check(opening_reading >= 0);

create table if not exists public.billing_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  rate_per_unit numeric(12,2) not null default 8.00,
  fixed_charge numeric(12,2) not null default 0,
  tax_percent numeric(6,3) not null default 0,
  due_days integer not null default 7,
  currency text not null default 'INR',
  updated_at timestamptz not null default now()
);

create table if not exists public.electricity_bills (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  meter_id uuid not null references public.meters(id) on delete restrict,
  tenant_id uuid references public.tenants(id) on delete set null,
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
create index if not exists electricity_bills_meter_date_idx on public.electricity_bills(meter_id,bill_date desc);
create index if not exists electricity_bills_tenant_date_idx on public.electricity_bills(tenant_id,bill_date desc);

create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.electricity_bills(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check(amount > 0),
  payment_mode text not null default 'Cash',
  receipt_no text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.bill_events (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.electricity_bills(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

drop policy if exists "public scan active meters" on public.meters;
drop policy if exists "public scan rooms" on public.rooms;
drop policy if exists "public scan assignments" on public.tenant_assignments;
drop policy if exists "public scan tenants" on public.tenants;

alter table public.billing_settings enable row level security;
alter table public.electricity_bills enable row level security;
alter table public.bill_payments enable row level security;
alter table public.bill_events enable row level security;

create policy "admin billing settings" on public.billing_settings for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin electricity bills" on public.electricity_bills for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin bill payments" on public.bill_payments for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin bill events" on public.bill_events for select to authenticated using(public.is_admin());

create or replace function public.calculate_bill_amount(p_units numeric,p_rate numeric,p_fixed numeric,p_tax_percent numeric)
returns numeric language sql immutable set search_path=''
as $$ select round(greatest(p_units,0)*greatest(p_rate,0)+greatest(p_fixed,0)+((greatest(p_units,0)*greatest(p_rate,0)+greatest(p_fixed,0))*greatest(p_tax_percent,0)/100),2) $$;

create or replace function public.set_bill_updated_at()
returns trigger language plpgsql set search_path=public
as $$ begin new.updated_at=now(); return new; end $$;

drop trigger if exists electricity_bills_updated_at on public.electricity_bills;
create trigger electricity_bills_updated_at before update on public.electricity_bills for each row execute function public.set_bill_updated_at();

insert into public.billing_settings(property_id)
select id from public.properties p
where not exists(select 1 from public.billing_settings s where s.property_id=p.id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('electricity-bills','electricity-bills',false,5242880,array['application/pdf'])
on conflict(id) do nothing;

create policy "admin bill pdf upload" on storage.objects for insert to authenticated
with check(bucket_id='electricity-bills' and public.is_admin());
create policy "admin bill pdf read" on storage.objects for select to authenticated
using(bucket_id='electricity-bills' and public.is_admin());
create policy "admin bill pdf update" on storage.objects for update to authenticated
using(bucket_id='electricity-bills' and public.is_admin()) with check(bucket_id='electricity-bills' and public.is_admin());
create policy "admin bill pdf delete" on storage.objects for delete to authenticated
using(bucket_id='electricity-bills' and public.is_admin());