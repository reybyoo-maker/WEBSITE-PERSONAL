-- RUANG KERJA — Supabase schema
-- Run this script ONCE in Supabase SQL Editor. Do not store task files in GitHub.
-- Invite codes themselves are not stored in this repository; only their SHA-256 hashes are seeded below.

create extension if not exists pgcrypto with schema extensions;

create table public.access_invites (
  code_hash text primary key,
  role text not null check (role in ('member', 'manager')),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.access_invites enable row level security;
revoke all on table public.access_invites from anon, authenticated;
insert into public.access_invites (code_hash, role) values
  ('e6e69e64b4d57804c79269f789dc12d844d73a796b4528eb9ce65ecfa120fb05', 'member'),
  ('7cd1c0e7763150dc0d25bb6efbae648283f65d563d9daea2e6d1ad2e49dc3162', 'manager')
on conflict (code_hash) do nothing;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Anggota',
  role text not null check (role in ('member', 'manager')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_team_member()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()));
$$;

create or replace function public.current_user_role()
returns text
language sql stable security definer
set search_path = public, auth
as $$
  select role from public.profiles where id = (select auth.uid()) limit 1;
$$;

revoke all on function public.is_team_member() from public, anon;
revoke all on function public.current_user_role() from public, anon;
grant execute on function public.is_team_member() to authenticated;
grant execute on function public.current_user_role() to authenticated;

-- An invite is consumed server-side during sign-up. The raw code is removed from user metadata.
create or replace function public.consume_access_invite()
returns trigger
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_code text;
  v_hash text;
  v_role text;
begin
  v_code := upper(regexp_replace(coalesce(new.raw_user_meta_data ->> 'invite_code', ''), '\s+', '', 'g'));
  if length(v_code) < 20 or length(v_code) > 80 then
    raise exception 'Kode undangan tidak valid atau sudah digunakan';
  end if;
  v_hash := encode(digest(v_code, 'sha256'), 'hex');
  select role into v_role
    from public.access_invites
   where code_hash = v_hash and used_at is null
   for update;
  if v_role is null then
    raise exception 'Kode undangan tidak valid atau sudah digunakan';
  end if;
  update public.access_invites set used_at = now() where code_hash = v_hash;
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'invite_code';
  new.raw_app_meta_data := jsonb_set(coalesce(new.raw_app_meta_data, '{}'::jsonb), '{team_role}', to_jsonb(v_role), true);
  return new;
end;
$$;
revoke all on function public.consume_access_invite() from public, anon, authenticated;
drop trigger if exists consume_team_invite_before_signup on auth.users;
create trigger consume_team_invite_before_signup
before insert on auth.users
for each row execute function public.consume_access_invite();

create or replace function public.create_profile_for_invited_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Anggota'),
    case when new.raw_app_meta_data ->> 'team_role' = 'manager' then 'manager' else 'member' end
  );
  return new;
end;
$$;
revoke all on function public.create_profile_for_invited_user() from public, anon, authenticated;
drop trigger if exists create_profile_after_invited_signup on auth.users;
create trigger create_profile_after_invited_signup
after insert on auth.users
for each row execute function public.create_profile_for_invited_user();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 2 and 140),
  description text not null default '' check (char_length(description) <= 8000),
  due_date date,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'in_review', 'changes_requested', 'approved', 'done', 'archived')),
  created_by uuid not null references public.profiles(id),
  assigned_to uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_due_date_idx on public.tasks (due_date);
create index tasks_status_idx on public.tasks (status);
create index tasks_assigned_to_idx on public.tasks (assigned_to);
alter table public.tasks enable row level security;

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
revoke all on function public.enforce_task_workflow() from public, anon, authenticated;
drop trigger if exists enforce_task_workflow_before_update on public.tasks;
create trigger enforce_task_workflow_before_update
before update on public.tasks
for each row execute function public.enforce_task_workflow();

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  comment text not null check (char_length(trim(comment)) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);
alter table public.task_comments enable row level security;

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (path like task_id::text || '/%')
);
create index task_attachments_task_idx on public.task_attachments (task_id, created_at);
alter table public.task_attachments enable row level security;

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('task_created', 'status_changed', 'task_updated', 'comment_added', 'file_uploaded')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_created_idx on public.activity_log (created_at desc);
alter table public.activity_log enable row level security;

create or replace function public.log_task_activity()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (task_id, actor_id, action, details)
    values (new.id, auth.uid(), 'task_created', jsonb_build_object('status', new.status));
    return new;
  end if;
  if old.status is distinct from new.status then
    insert into public.activity_log (task_id, actor_id, action, details)
    values (new.id, auth.uid(), 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
  else
    insert into public.activity_log (task_id, actor_id, action, details)
    values (new.id, auth.uid(), 'task_updated', '{}'::jsonb);
  end if;
  return new;
end;
$$;
revoke all on function public.log_task_activity() from public, anon, authenticated;
drop trigger if exists log_task_activity_after_change on public.tasks;
create trigger log_task_activity_after_change
after insert or update on public.tasks
for each row execute function public.log_task_activity();

create or replace function public.log_related_activity()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_task_id uuid;
  v_action text;
begin
  if tg_table_name = 'task_comments' then
    v_task_id := new.task_id;
    v_action := 'comment_added';
  else
    v_task_id := new.task_id;
    v_action := 'file_uploaded';
  end if;
  insert into public.activity_log (task_id, actor_id, action, details)
  values (v_task_id, auth.uid(), v_action, '{}'::jsonb);
  return new;
end;
$$;
revoke all on function public.log_related_activity() from public, anon, authenticated;
drop trigger if exists log_task_comment_activity on public.task_comments;
create trigger log_task_comment_activity after insert on public.task_comments
for each row execute function public.log_related_activity();
drop trigger if exists log_task_file_activity on public.task_attachments;
create trigger log_task_file_activity after insert on public.task_attachments
for each row execute function public.log_related_activity();

-- Least-privilege Data API grants. There is intentionally no client-side delete access to tasks or comments.
grant usage on schema public to authenticated;
revoke all on public.profiles, public.tasks, public.task_comments, public.task_attachments, public.activity_log from anon, authenticated;
grant select (id, display_name, role, created_at) on public.profiles to authenticated;
grant select on public.tasks to authenticated;
grant insert (id, title, description, due_date, priority, status, created_by, assigned_to, created_at) on public.tasks to authenticated;
grant update (title, description, due_date, priority, status, assigned_to) on public.tasks to authenticated;
grant select on public.task_comments to authenticated;
grant insert (id, task_id, user_id, comment, created_at) on public.task_comments to authenticated;
grant select on public.task_attachments to authenticated;
grant insert (id, task_id, path, file_name, content_type, size_bytes, uploaded_by, created_at) on public.task_attachments to authenticated;
grant select on public.activity_log to authenticated;
grant insert (id, task_id, actor_id, action, details, created_at) on public.activity_log to authenticated;

drop policy if exists team_can_read_profiles on public.profiles;
create policy team_can_read_profiles on public.profiles
for select to authenticated using (public.is_team_member());

drop policy if exists team_can_read_tasks on public.tasks;
create policy team_can_read_tasks on public.tasks
for select to authenticated using (public.is_team_member());

drop policy if exists team_can_create_tasks on public.tasks;
create policy team_can_create_tasks on public.tasks
for insert to authenticated
with check (
  public.is_team_member()
  and (created_by = (select auth.uid()) or public.current_user_role() = 'manager')
  and status = 'todo'
);

drop policy if exists permitted_team_updates_tasks on public.tasks;
create policy permitted_team_updates_tasks on public.tasks
for update to authenticated
using (
  public.is_team_member()
  and (public.current_user_role() = 'manager' or created_by = (select auth.uid()) or assigned_to = (select auth.uid()))
)
with check (
  public.is_team_member()
  and (public.current_user_role() = 'manager' or created_by = (select auth.uid()) or assigned_to = (select auth.uid()))
);

drop policy if exists team_can_read_comments on public.task_comments;
create policy team_can_read_comments on public.task_comments
for select to authenticated
using (
  public.is_team_member()
  and exists (select 1 from public.tasks t where t.id = task_comments.task_id)
);

drop policy if exists team_can_add_comments on public.task_comments;
create policy team_can_add_comments on public.task_comments
for insert to authenticated
with check (
  public.is_team_member()
  and (user_id = (select auth.uid()) or public.current_user_role() = 'manager')
  and char_length(trim(comment)) between 1 and 3000
  and exists (
    select 1 from public.tasks t
    where t.id = task_comments.task_id
      and (public.current_user_role() = 'manager' or t.created_by = (select auth.uid()) or t.assigned_to = (select auth.uid()))
  )
);

drop policy if exists team_can_read_attachments on public.task_attachments;
create policy team_can_read_attachments on public.task_attachments
for select to authenticated
using (
  public.is_team_member()
  and exists (
    select 1 from public.tasks t
    where t.id = task_attachments.task_id
      and (public.current_user_role() = 'manager' or t.created_by = (select auth.uid()) or t.assigned_to = (select auth.uid()))
  )
);

drop policy if exists team_can_add_attachments on public.task_attachments;
create policy team_can_add_attachments on public.task_attachments
for insert to authenticated
with check (
  public.is_team_member()
  and (uploaded_by = (select auth.uid()) or public.current_user_role() = 'manager')
  and size_bytes <= 20971520
  and path like task_id::text || '/%'
  and exists (
    select 1 from public.tasks t
    where t.id = task_attachments.task_id
      and (public.current_user_role() = 'manager' or t.created_by = (select auth.uid()) or t.assigned_to = (select auth.uid()))
  )
);

drop policy if exists team_can_read_activity on public.activity_log;
create policy team_can_read_activity on public.activity_log
for select to authenticated using (public.is_team_member());

drop policy if exists manager_can_restore_activity on public.activity_log;
create policy manager_can_restore_activity on public.activity_log
for insert to authenticated
with check (public.current_user_role() = 'manager' and public.is_team_member());

-- Private Storage bucket: never use public URLs. Max size 20 MB, allow only common work-file types.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-files', 'task-files', false, 20971520,
  array[
    'application/pdf','image/png','image/jpeg','image/webp','text/plain','text/csv',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'video/mp4','application/zip','application/x-zip-compressed'
  ]::text[]
)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists team_can_download_private_task_files on storage.objects;
create policy team_can_download_private_task_files on storage.objects
for select to authenticated
using (
  bucket_id = 'task-files'
  and public.is_team_member()
  and exists (
    select 1 from public.tasks t
    where t.id::text = split_part(storage.objects.name, '/', 1)
      and (public.current_user_role() = 'manager' or t.created_by = (select auth.uid()) or t.assigned_to = (select auth.uid()))
  )
);

drop policy if exists team_can_upload_private_task_files on storage.objects;
create policy team_can_upload_private_task_files on storage.objects
for insert to authenticated
with check (
  bucket_id = 'task-files'
  and public.is_team_member()
  and exists (
    select 1 from public.tasks t
    where t.id::text = split_part(storage.objects.name, '/', 1)
      and (public.current_user_role() = 'manager' or t.created_by = (select auth.uid()) or t.assigned_to = (select auth.uid()))
  )
);

-- Delete is available only to manager or the creator/assignee for their task, primarily for failed-upload cleanup.
drop policy if exists permitted_delete_private_task_files on storage.objects;
create policy permitted_delete_private_task_files on storage.objects
for delete to authenticated
using (
  bucket_id = 'task-files'
  and public.is_team_member()
  and exists (
    select 1 from public.tasks t
    where t.id::text = split_part(storage.objects.name, '/', 1)
      and (public.current_user_role() = 'manager' or t.created_by = (select auth.uid()) or t.assigned_to = (select auth.uid()))
  )
);

