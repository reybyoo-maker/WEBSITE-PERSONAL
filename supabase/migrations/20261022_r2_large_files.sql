-- Run this ONLY if you already applied an older version of schema.sql.
-- This changes metadata limits; it does not delete any records or files.
begin;

alter table public.task_attachments
  drop constraint if exists task_attachments_size_bytes_check;

alter table public.task_attachments
  add constraint task_attachments_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 943718400000);

drop policy if exists team_can_add_attachments on public.task_attachments;
create policy team_can_add_attachments on public.task_attachments
for insert to authenticated
with check (
  public.is_team_member()
  and (uploaded_by = (select auth.uid()) or public.current_user_role() = 'manager')
  and size_bytes > 0
  and size_bytes <= 943718400000
  and path like task_id::text || '/%'
  and exists (
    select 1 from public.tasks t
    where t.id = task_attachments.task_id
      and (public.current_user_role() = 'manager' or t.created_by = (select auth.uid()) or t.assigned_to = (select auth.uid()))
  )
);

commit;
