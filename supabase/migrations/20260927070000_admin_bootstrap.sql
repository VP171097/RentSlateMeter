create or replace function public.bootstrap_admin()
returns boolean
language plpgsql
security invoker
set search_path=public
as $$
begin
  if (select auth.uid()) is null then return false; end if;
  if exists(select 1 from public.admin_users) then
    return exists(select 1 from public.admin_users where user_id=(select auth.uid()));
  end if;
  insert into public.admin_users(user_id) values((select auth.uid())) on conflict do nothing;
  return true;
end $$;

grant execute on function public.bootstrap_admin() to authenticated;
