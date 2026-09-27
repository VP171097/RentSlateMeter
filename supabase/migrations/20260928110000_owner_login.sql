-- Owner login: lets the sign-in page offer "Set up owner account" only until
-- the first administrator exists. Returns a boolean only — no user data.
create or replace function public.admin_exists()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admin_users) $$;

revoke all on function public.admin_exists() from public;
grant execute on function public.admin_exists() to anon, authenticated;
