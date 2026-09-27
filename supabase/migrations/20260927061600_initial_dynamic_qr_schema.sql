create extension if not exists pgcrypto;

create table public.properties (id uuid primary key default gen_random_uuid(), name text not null, address text, created_at timestamptz not null default now());
create table public.rooms (id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade, floor text not null, room_number text not null, created_at timestamptz not null default now(), unique(property_id,room_number));
create table public.tenants (id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade, name text not null, phone text, notes text, created_at timestamptz not null default now());
create table public.meters (id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade, room_id uuid references public.rooms(id) on delete set null, meter_code text not null, meter_number text, meter_type text not null default 'Electricity', status text not null default 'active' check(status in ('active','inactive','maintenance')), public_token uuid not null default gen_random_uuid() unique, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(property_id,meter_code));
create table public.tenant_assignments (id uuid primary key default gen_random_uuid(), meter_id uuid not null references public.meters(id) on delete cascade, tenant_id uuid not null references public.tenants(id) on delete cascade, room_id uuid references public.rooms(id) on delete set null, move_in_date date not null default current_date, move_out_date date, created_at timestamptz not null default now(), check(move_out_date is null or move_out_date>=move_in_date));
create unique index one_active_tenant_per_meter on public.tenant_assignments(meter_id) where move_out_date is null;
create table public.meter_readings (id uuid primary key default gen_random_uuid(), meter_id uuid not null references public.meters(id) on delete cascade, reading numeric(14,3) not null check(reading>=0), reading_date date not null default current_date, photo_url text, notes text, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now());
create table public.admin_users (user_id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now());

alter table public.properties enable row level security;
alter table public.rooms enable row level security;
alter table public.tenants enable row level security;
alter table public.meters enable row level security;
alter table public.tenant_assignments enable row level security;
alter table public.meter_readings enable row level security;
alter table public.admin_users enable row level security;

create or replace function public.is_admin() returns boolean language sql stable security invoker set search_path=public as $$ select exists(select 1 from public.admin_users where user_id=(select auth.uid())) $$;

create policy "public scan active meters" on public.meters for select to anon,authenticated using(status='active');
create policy "public scan rooms" on public.rooms for select to anon,authenticated using(exists(select 1 from public.meters m where m.room_id=rooms.id and m.status='active'));
create policy "public scan assignments" on public.tenant_assignments for select to anon,authenticated using(move_out_date is null and exists(select 1 from public.meters m where m.id=tenant_assignments.meter_id and m.status='active'));
create policy "public scan tenants" on public.tenants for select to anon,authenticated using(exists(select 1 from public.tenant_assignments a where a.tenant_id=tenants.id and a.move_out_date is null));

create policy "admin properties" on public.properties for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin rooms" on public.rooms for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin tenants" on public.tenants for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin meters" on public.meters for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin assignments" on public.tenant_assignments for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin readings" on public.meter_readings for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy "admin users self" on public.admin_users for select to authenticated using(user_id=(select auth.uid()) or public.is_admin());

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end $$;
create trigger meters_updated_at before update on public.meters for each row execute function public.set_updated_at();
