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
  if v_role <> 'manager' then
    if new.created_by is distinct from old.created_by then
      raise exception 'Pembuat tugas tidak boleh diubah';
    end if;
    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.due_date is distinct from old.due_date
      or new.due_time is distinct from old.due_time
      or new.priority is distinct from old.priority
      or new.assigned_to is distinct from old.assigned_to then
      raise exception 'Detail tugas hanya dapat diubah manager';
    end if;
    if old.status in ('approved', 'done', 'archived') and new.status is distinct from old.status then
      raise exception 'Status final hanya dapat diubah manager';
    end if;
    if new.status is distinct from old.status then
      if old.status in ('todo', 'changes_requested') and new.status = 'in_progress' then
        null;
      elsif old.status = 'in_progress' and new.status = 'in_review' then
        null;
      else
        raise exception 'Perubahan status tidak mengikuti alur kerja yang diizinkan';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
