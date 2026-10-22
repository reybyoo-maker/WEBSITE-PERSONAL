alter table public.task_attachments
  add column if not exists attachment_type text not null default 'work';
alter table public.task_attachments
  drop constraint if exists task_attachments_attachment_type_check;
alter table public.task_attachments
  add constraint task_attachments_attachment_type_check check (attachment_type in ('work','example'));

alter table public.content_assets add column if not exists content_group_id uuid;
update public.content_assets set content_group_id = id where content_group_id is null;
alter table public.content_assets alter column content_group_id set default gen_random_uuid();
alter table public.content_assets alter column content_group_id set not null;
alter table public.content_assets add column if not exists status text not null default 'todo';
alter table public.content_assets drop constraint if exists content_assets_status_check;
alter table public.content_assets add constraint content_assets_status_check
  check (status in ('todo','in_review','changes_requested','done'));
alter table public.content_assets add column if not exists revision_note text not null default '';
alter table public.content_assets drop constraint if exists content_assets_revision_note_check;
alter table public.content_assets add constraint content_assets_revision_note_check
  check (char_length(revision_note) <= 3000);
alter table public.content_assets add column if not exists content_format text not null default 'feed';
alter table public.content_assets drop constraint if exists content_assets_content_format_check;
alter table public.content_assets add constraint content_assets_content_format_check
  check (content_format in ('reels','feed','carousel'));
create index if not exists content_assets_group_idx on public.content_assets(content_group_id);
create index if not exists content_assets_status_idx on public.content_assets(status);

create or replace function public.enforce_task_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := public.current_user_role();
  if v_role is null then
    raise exception 'Akun bukan anggota tim';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Pembuat tugas tidak boleh diubah';
  end if;
  if new.status is distinct from old.status then
    if old.status in ('todo','changes_requested') and new.status in ('in_progress','in_review') then
      null;
    elsif old.status = 'in_progress' and new.status = 'in_review' then
      null;
    elsif old.status = 'in_review' and new.status in ('changes_requested','done') then
      null;
    elsif old.status = 'approved' and new.status = 'done' then
      null;
    else
      raise exception 'Perubahan status tidak mengikuti alur kerja yang diizinkan';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.enforce_task_workflow() from public, anon, authenticated;

drop policy if exists team_can_create_tasks on public.tasks;
create policy team_can_create_tasks on public.tasks
for insert to authenticated with check (
  public.is_team_member()
  and created_by = (select auth.uid())
  and status = 'todo'
);
drop policy if exists permitted_team_updates_tasks on public.tasks;
create policy permitted_team_updates_tasks on public.tasks
for update to authenticated using (public.is_team_member())
with check (public.is_team_member());

drop policy if exists team_can_add_comments on public.task_comments;
create policy team_can_add_comments on public.task_comments
for insert to authenticated with check (
  public.is_team_member()
  and user_id = (select auth.uid())
  and char_length(trim(comment)) between 1 and 3000
  and exists (select 1 from public.tasks t where t.id = task_comments.task_id)
);

drop policy if exists team_can_read_attachments on public.task_attachments;
create policy team_can_read_attachments on public.task_attachments
for select to authenticated
using (public.is_team_member() and exists (select 1 from public.tasks t where t.id = task_attachments.task_id));
drop policy if exists team_can_add_attachments on public.task_attachments;
create policy team_can_add_attachments on public.task_attachments
for insert to authenticated with check (
  public.is_team_member()
  and uploaded_by = (select auth.uid())
  and size_bytes > 0 and size_bytes <= 52428800
  and path like task_id::text || '/%'
  and exists (select 1 from public.tasks t where t.id = task_attachments.task_id)
);
drop policy if exists team_can_delete_attachments on public.task_attachments;
create policy team_can_delete_attachments on public.task_attachments
for delete to authenticated
using (public.is_team_member() and exists (select 1 from public.tasks t where t.id = task_attachments.task_id));

drop policy if exists "ruang_kerja_storage_select" on storage.objects;
create policy "ruang_kerja_storage_select" on storage.objects
for select to authenticated
using (
  bucket_id = 'ruang-kerja-files'
  and public.is_team_member()
  and (
    exists (select 1 from public.task_attachments a where a.path = storage.objects.name)
    or exists (select 1 from public.content_assets c where c.path = storage.objects.name)
  )
);
drop policy if exists "ruang_kerja_storage_insert" on storage.objects;
create policy "ruang_kerja_storage_insert" on storage.objects
for insert to authenticated with check (
  bucket_id = 'ruang-kerja-files'
  and public.is_team_member()
  and (
    name like ('content/' || (select auth.uid())::text || '/%')
    or (split_part(name, '/', 2) = (select auth.uid())::text
      and exists (select 1 from public.tasks t where t.id::text = split_part(name, '/', 1)))
  )
);
drop policy if exists "ruang_kerja_storage_delete_own_uploads" on storage.objects;
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
