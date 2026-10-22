-- Supabase Free plan friendly storage: private bucket, max 50 MiB per file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ruang-kerja-files', 'ruang-kerja-files', false, 52428800, null)
on conflict (id) do update
set public = false, file_size_limit = 52428800, allowed_mime_types = null;

alter table public.task_attachments
  drop constraint if exists task_attachments_size_bytes_check;
alter table public.task_attachments
  add constraint task_attachments_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 52428800);

drop policy if exists team_can_add_attachments on public.task_attachments;
create policy team_can_add_attachments on public.task_attachments
for insert to authenticated
with check (
  public.is_team_member()
  and (uploaded_by = (select auth.uid()) or public.current_user_role() = 'manager')
  and size_bytes > 0 and size_bytes <= 52428800
  and path like task_id::text || '/%'
  and exists (
    select 1 from public.tasks t
    where t.id = task_attachments.task_id
      and (public.current_user_role() = 'manager'
        or t.created_by = (select auth.uid())
        or t.assigned_to = (select auth.uid()))
  )
);

drop policy if exists "ruang_kerja_storage_select" on storage.objects;
create policy "ruang_kerja_storage_select" on storage.objects
for select to authenticated
using (
  bucket_id = 'ruang-kerja-files'
  and public.is_team_member()
  and exists (
    select 1 from public.tasks t
    where t.id::text = split_part(name, '/', 1)
      and (public.current_user_role() = 'manager'
        or t.created_by = (select auth.uid())
        or t.assigned_to = (select auth.uid()))
  )
);

drop policy if exists "ruang_kerja_storage_insert" on storage.objects;
create policy "ruang_kerja_storage_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'ruang-kerja-files'
  and public.is_team_member()
  and split_part(name, '/', 2) = (select auth.uid())::text
  and exists (
    select 1 from public.tasks t
    where t.id::text = split_part(name, '/', 1)
      and (public.current_user_role() = 'manager'
        or t.created_by = (select auth.uid())
        or t.assigned_to = (select auth.uid()))
  )
);

drop policy if exists "ruang_kerja_storage_delete_own_uploads" on storage.objects;
create policy "ruang_kerja_storage_delete_own_uploads" on storage.objects
for delete to authenticated
using (
  bucket_id = 'ruang-kerja-files'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and public.is_team_member()
  and exists (
    select 1 from public.tasks t
    where t.id::text = split_part(name, '/', 1)
      and (public.current_user_role() = 'manager'
        or t.created_by = (select auth.uid())
        or t.assigned_to = (select auth.uid()))
  )
);
