-- Add a dedicated attachment type for completed work results.
-- Existing task attachment metadata and stored files remain unchanged.
begin;

alter table public.task_attachments
  drop constraint if exists task_attachments_attachment_type_check;

alter table public.task_attachments
  add constraint task_attachments_attachment_type_check
  check (attachment_type in ('work', 'example', 'result'));

commit;
