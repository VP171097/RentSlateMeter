-- Optional rent on an electricity bill. When rent_amount is 0 (the default),
-- the bill is electricity-only and rent is not shown anywhere.
alter table public.electricity_bills
  add column if not exists rent_amount numeric(14,2) not null default 0,
  add column if not exists rent_period text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'electricity_bills_rent_amount_check') then
    alter table public.electricity_bills add constraint electricity_bills_rent_amount_check check (rent_amount >= 0);
  end if;
end $$;
