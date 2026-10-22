-- RUANG KERJA — Supabase schema
-- Run this script ONCE in Supabase SQL Editor. Do not store task files in GitHub.
-- Invite codes themselves are not stored in this repository; only their SHA-256 hashes are seeded below.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;

create table private.access_invites (
  code_hash text primary key,
  role text not null check (role in ('member', 'manager')),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table private.access_invites enable row level security;
revoke all on table private.access_invites from public, anon, authenticated;
revoke all on table private.access_invites from anon, authenticated;
-- Deprecated one-time invitation table is intentionally left empty.

create table if not exists private.shared_access_codes (
  code_hash text primary key,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table private.shared_access_codes enable row level security;
revoke all on table private.shared_access_codes from public, anon, authenticated;
insert into private.shared_access_codes (code_hash, enabled)
values ('a81e6971ddccc89162cac77a91512c87a90fc822e45963907bab25617296ed6d', true)
on conflict (code_hash) do update set enabled = true;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Anggota',
  role text not null check (role in ('member', 'manager')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- SECURITY DEFINER helpers are kept outside the exposed Data API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_team_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
  );
$$;

create or replace function private.current_user_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles
  where id = (select auth.uid())
  limit 1;
$$;

revoke all on function private.is_team_member() from public, anon;
revoke all on function private.current_user_role() from public, anon;
grant execute on function private.is_team_member() to authenticated;
grant execute on function private.current_user_role() to authenticated;

-- Public wrappers remain SECURITY INVOKER; the private helpers perform role checks.
create or replace function public.is_team_member()
returns boolean
language sql stable security invoker
set search_path = ''
as $$
  select private.is_team_member();
$$;

create or replace function public.current_user_role()
returns text
language sql stable security invoker
set search_path = ''
as $$
  select private.current_user_role();
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
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  v_code := upper(regexp_replace(coalesce(new.raw_user_meta_data ->> 'invite_code', ''), '\s+', '', 'g'));
  if length(v_code) < 20 or length(v_code) > 80 then
    raise exception 'Kode undangan tidak valid atau sudah digunakan';
  end if;
  v_hash := encode(digest(v_code, 'sha256'), 'hex');
  select role into v_role
    from private.access_invites
   where code_hash = v_hash and used_at is null
   for update;
  if v_role is null then
    raise exception 'Kode undangan tidak valid atau sudah digunakan';
  end if;
  update private.access_invites set used_at = now() where code_hash = v_hash;
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
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
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

create or replace function public.activate_access_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_normalized text;
  v_hash text;
  v_valid boolean;
begin
  if v_user_id is null then
    raise exception 'Sesi akses tidak tersedia. Coba masuk kembali.';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = v_user_id and coalesce(u.is_anonymous, false)
  ) then
    raise exception 'Sesi bukan sesi kode akses.';
  end if;

  v_normalized := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
  if length(v_normalized) < 20 or length(v_normalized) > 80 then
    return false;
  end if;
  v_hash := encode(extensions.digest(convert_to(v_normalized, 'UTF8'), 'sha256'), 'hex');
  select exists (
    select 1 from private.shared_access_codes c
    where c.code_hash = v_hash and c.enabled = true
  ) into v_valid;
  if not v_valid then
    return false;
  end if;

  insert into public.profiles (id, display_name, role)
  values (v_user_id, 'Pengguna Ruang Kerja', 'manager')
  on conflict (id) do update set role = 'manager';
  return true;
end;
$$;
revoke all on function public.activate_access_code(text) from public, anon, authenticated;
grant execute on function public.activate_access_code(text) to authenticated;

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
create index if not exists tasks_created_by_idx on public.tasks (created_by);
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
create index if not exists task_comments_user_id_idx on public.task_comments (user_id);
alter table public.task_comments enable row level security;

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (path like task_id::text || '/%')
);
create index task_attachments_task_idx on public.task_attachments (task_id, created_at);
create index if not exists task_attachments_uploaded_by_idx on public.task_attachments (uploaded_by);
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
create index if not exists activity_log_task_id_idx on public.activity_log (task_id);
create index if not exists activity_log_actor_id_idx on public.activity_log (actor_id);
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
  and size_bytes <= 52428800
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

-- Private file storage is Supabase Storage. Bucket objects are never public.
-- On the Free plan, the configured application limit is 50 MiB per file and the plan quota is 1 GiB total.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ruang-kerja-files', 'ruang-kerja-files', false, 52428800, null)
on conflict (id) do update
set public = false, file_size_limit = 52428800, allowed_mime_types = null;

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
  and public.is_team_member()
  and public.current_user_role() = 'manager'
  and exists (
    select 1 from public.tasks t where t.id::text = split_part(name, '/', 1)
  )
);
