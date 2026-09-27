-- Tenant readings must include a photo of the meter so the owner can verify
-- the reading before approving the bill.
alter table public.electricity_bills add column if not exists reading_photo_path text;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('meter-photos', 'meter-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Tenants upload through the meter-portal Edge Function (service role), so
-- only admins get direct access to the bucket.
drop policy if exists "admin meter photo read" on storage.objects;
create policy "admin meter photo read" on storage.objects for select to authenticated
using (bucket_id = 'meter-photos' and public.is_admin());
drop policy if exists "admin meter photo upload" on storage.objects;
create policy "admin meter photo upload" on storage.objects for insert to authenticated
with check (bucket_id = 'meter-photos' and public.is_admin());
drop policy if exists "admin meter photo delete" on storage.objects;
create policy "admin meter photo delete" on storage.objects for delete to authenticated
using (bucket_id = 'meter-photos' and public.is_admin());
