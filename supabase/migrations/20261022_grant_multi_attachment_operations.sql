grant insert (id, task_id, path, file_name, content_type, size_bytes, uploaded_by, created_at, attachment_type) on public.task_attachments to authenticated;
grant delete on public.task_attachments to authenticated;
grant update (status, revision_note) on public.content_assets to authenticated;

drop policy if exists "ruang_kerja_storage_delete_team" on storage.objects;
create policy "ruang_kerja_storage_delete_team" on storage.objects
for delete to authenticated
using (
  bucket_id = 'ruang-kerja-files'
  and public.is_team_member()
  and (
    exists (select 1 from public.task_attachments a where a.path = storage.objects.name)
    or exists (select 1 from public.content_assets c where c.path = storage.objects.name)
    or (split_part(name, '/', 2) = (select auth.uid())::text
      and exists (select 1 from public.tasks t where t.id::text = split_part(name, '/', 1)))
    or name like ('content/' || (select auth.uid())::text || '/%')
  )
);
