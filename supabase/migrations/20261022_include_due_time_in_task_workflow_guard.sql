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
