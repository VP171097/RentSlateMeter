-- Delete a meter and everything that belongs to it in one transaction:
--   bills (+ their payments and audit events, via ON DELETE CASCADE),
--   tenant assignments and meter readings (cascade from meters),
--   tenant records left with no other room, and the room if now empty.
-- Stored PDFs / meter photos live under <property_id>/<meter_id>/ in the
-- electricity-bills and meter-photos buckets; the app removes that folder
-- through the Storage API after this succeeds (returned as storage_prefix).
create or replace function public.delete_meter(p_meter_id uuid)
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
  if not public.is_admin() then
    raise exception 'Only the property owner can delete meters.' using errcode = '42501';
  end if;

  select id, property_id, room_id into m from public.meters where id = p_meter_id for update;
  if not found then
    raise exception 'Meter not found.' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct tenant_id), '{}') into v_tenants
  from public.tenant_assignments where meter_id = m.id;

  delete from public.electricity_bills where meter_id = m.id;
  get diagnostics v_bills = row_count;

  delete from public.meters where id = m.id;

  with gone as (
    delete from public.tenants t
    where t.id = any (v_tenants)
      and not exists (select 1 from public.tenant_assignments a where a.tenant_id = t.id)
    returning 1
  )
  select count(*) into v_tenants_deleted from gone;

  if m.room_id is not null and not exists (select 1 from public.meters where room_id = m.room_id) then
    delete from public.rooms where id = m.room_id;
    v_room_deleted := true;
  end if;

  return jsonb_build_object(
    'bills_deleted', v_bills,
    'tenants_deleted', v_tenants_deleted,
    'room_deleted', v_room_deleted,
    'storage_prefix', m.property_id::text || '/' || m.id::text
  );
end $$;

revoke all on function public.delete_meter(uuid) from public, anon;
grant execute on function public.delete_meter(uuid) to authenticated;
