-- RUANG KERJA — Supabase schema
-- Run this script ONCE in Supabase SQL Editor for a fresh project only. Do not store task files in GitHub.
-- The permanent access code is never stored in GitHub; only its SHA-256 hash is seeded below.

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
  label text not null default 'Kode 1',
  color text not null default '#dc2626',
  created_at timestamptz not null default now()
);
alter table private.shared_access_codes add column if not exists label text not null default 'Kode 1';
alter table private.shared_access_codes add column if not exists color text not null default '#dc2626';
alter table private.shared_access_codes enable row level security;
revoke all on table private.shared_access_codes from public, anon, authenticated;
insert into private.shared_access_codes (code_hash, enabled, label, color)
values
  ('a81e6971ddccc89162cac77a91512c87a90fc822e45963907bab25617296ed6d', true, 'Kode 1', '#dc2626'),
  ('fe54512c43e4771bdbe70a3e8e4f8673ad6bfa40dac407da2f780bb454e34b43', true, 'Kode 2', '#ec4899')
on conflict (code_hash) do update set enabled = true;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Anggota',
  role text not null check (role in ('member', 'manager')),
  access_label text not null default 'Kode 1',
  access_color text not null default '#dc2626',
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
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_normalized text;
  v_hash text;
  v_label text;
  v_color text;
begin
  if v_user_id is null then raise exception 'Sesi akses tidak tersedia. Coba masuk kembali.'; end if;
  if not exists (select 1 from auth.users u where u.id = v_user_id and coalesce(u.is_anonymous, false)) then
    raise exception 'Sesi bukan sesi kode akses.';
  end if;
  v_normalized := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
  if length(v_normalized) < 20 or length(v_normalized) > 80 then return false; end if;
  v_hash := encode(extensions.digest(convert_to(v_normalized, 'UTF8'), 'sha256'), 'hex');
  select c.label, c.color into v_label, v_color from private.shared_access_codes c where c.code_hash = v_hash and c.enabled = true;
  if v_label is null then return false; end if;
  insert into public.profiles (id, display_name, role, access_label, access_color)
  values (v_user_id, v_label, 'manager', v_label, v_color)
  on conflict (id) do update set display_name = excluded.display_name, role = 'manager',
    access_label = excluded.access_label, access_color = excluded.access_color;
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
  due_time time without time zone,
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
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 838860800),
  uploaded_by uuid not null references public.profiles(id),
  storage_parts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  attachment_type text not null default 'work' check (attachment_type in ('work','example')),
  check (path like task_id::text || '/%')
);
create index task_attachments_task_idx on public.task_attachments (task_id, created_at);
create index if not exists task_attachments_uploaded_by_idx on public.task_attachments (uploaded_by);
alter table public.task_attachments enable row level security;


create table public.content_assets (
  id uuid primary key default gen_random_uuid(),
  content_group_id uuid not null default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 160),
  caption text not null default '' check (char_length(caption) <= 5000),
  scheduled_date date,
  scheduled_time time without time zone,
  content_format text not null default 'feed' check (content_format in ('reels','feed','carousel')),
  status text not null default 'todo' check (status in ('todo','in_review','changes_requested','done')),
  revision_note text not null default '' check (char_length(revision_note) <= 3000),
  path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 838860800),
  uploaded_by uuid not null references public.profiles(id),
  storage_parts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint content_assets_owner_path_check check (path like ('content/' || uploaded_by::text || '/%'))
);
create index content_assets_scheduled_idx on public.content_assets (scheduled_date, scheduled_time);
create index content_assets_created_idx on public.content_assets (created_at desc);
create index if not exists content_assets_uploaded_by_idx on public.content_assets (uploaded_by);
create index if not exists content_assets_group_idx on public.content_assets (content_group_id);
create index if not exists content_assets_status_idx on public.content_assets (status);
alter table public.content_assets enable row level security;


CREATE TABLE public.visit_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 160),
  city text NOT NULL CHECK (char_length(trim(city)) BETWEEN 2 AND 120),
  visit_date date NOT NULL,
  start_time time without time zone NOT NULL,
  end_date date NOT NULL,
  end_time time without time zone NOT NULL,
  job_description text NOT NULL DEFAULT '' CHECK (char_length(job_description) <= 8000),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('fixed','planned','cancelled')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_schedules_range_check CHECK (end_date > visit_date OR (end_date = visit_date AND end_time >= start_time))
);
CREATE INDEX visit_schedules_date_idx ON public.visit_schedules (visit_date, start_time);
ALTER TABLE public.visit_schedules ENABLE ROW LEVEL SECURITY;

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
revoke all on public.profiles, public.tasks, public.task_comments, public.task_attachments, public.content_assets, public.activity_log from anon, authenticated;
grant select (id, display_name, role, access_label, access_color, created_at) on public.profiles to authenticated;
grant select on public.tasks to authenticated;
grant insert (id, title, description, due_date, due_time, priority, status, created_by, assigned_to, created_at) on public.tasks to authenticated;
grant update (title, description, due_date, due_time, priority, status, assigned_to) on public.tasks to authenticated;
grant select on public.task_comments to authenticated;
grant insert (id, task_id, user_id, comment, created_at) on public.task_comments to authenticated;
grant select on public.task_attachments to authenticated;
grant insert (id, task_id, path, file_name, content_type, size_bytes, storage_parts, uploaded_by, created_at, attachment_type) on public.task_attachments to authenticated;
grant delete on public.task_attachments to authenticated;
grant select, insert, update, delete on public.content_assets to authenticated;
grant select on public.activity_log to authenticated;
grant delete on public.tasks to authenticated;
grant insert (id, task_id, actor_id, action, details, created_at) on public.activity_log to authenticated;
grant select, insert, update, delete on public.visit_schedules to authenticated;

drop policy if exists team_can_read_profiles on public.profiles;
create policy team_can_read_profiles on public.profiles
for select to authenticated using (public.is_team_member());

drop policy if exists team_can_read_tasks on public.tasks;
create policy team_can_read_tasks on public.tasks
for select to authenticated using (public.is_team_member());

drop policy if exists team_can_create_tasks on public.tasks;
create policy team_can_create_tasks on public.tasks
for insert to authenticated
with check (public.is_team_member() and created_by = (select auth.uid()) and status = 'todo');

drop policy if exists permitted_team_updates_tasks on public.tasks;
create policy permitted_team_updates_tasks on public.tasks
for update to authenticated
using (public.is_team_member())
with check (public.is_team_member());


drop policy if exists team_can_delete_tasks on public.tasks;
create policy team_can_delete_tasks on public.tasks for delete to authenticated using (public.is_team_member());

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
  and user_id = (select auth.uid())
  and char_length(trim(comment)) between 1 and 3000
  and exists (select 1 from public.tasks t where t.id = task_comments.task_id)
);


drop policy if exists team_can_read_attachments on public.task_attachments;
create policy team_can_read_attachments on public.task_attachments
for select to authenticated using (
  public.is_team_member()
  and exists (select 1 from public.tasks t where t.id = task_attachments.task_id)
);

drop policy if exists team_can_add_attachments on public.task_attachments;
create policy team_can_add_attachments on public.task_attachments
for insert to authenticated
with check (
  public.is_team_member()
  and uploaded_by = (select auth.uid())
  and size_bytes > 0 and size_bytes <= 838860800
  and path like task_id::text || '/%'
  and jsonb_typeof(storage_parts) = 'array'
  and jsonb_array_length(storage_parts) between 1 and 100
  and exists (select 1 from public.tasks t where t.id = task_attachments.task_id)
);

drop policy if exists team_can_delete_attachments on public.task_attachments;
create policy team_can_delete_attachments on public.task_attachments
for delete to authenticated
using (
  public.is_team_member()
  and exists (select 1 from public.tasks t where t.id = task_attachments.task_id)
);


drop policy if exists content_assets_read_team on public.content_assets;
create policy content_assets_read_team
on public.content_assets for select to authenticated
using (public.is_team_member());

drop policy if exists content_assets_insert_team on public.content_assets;
create policy content_assets_insert_team
on public.content_assets for insert to authenticated
with check (
  public.is_team_member()
  and uploaded_by = (select auth.uid())
  and size_bytes > 0 and size_bytes <= 838860800
  and path like ('content/' || (select auth.uid())::text || '/%')
  and jsonb_typeof(storage_parts) = 'array'
  and jsonb_array_length(storage_parts) between 1 and 100
);

drop policy if exists content_assets_update_team on public.content_assets;
create policy content_assets_update_team
on public.content_assets for update to authenticated
using (public.is_team_member())
with check (public.is_team_member());

drop policy if exists content_assets_delete_team on public.content_assets;
create policy content_assets_delete_team
on public.content_assets for delete to authenticated
using (public.is_team_member());

drop policy if exists visit_schedules_read_team on public.visit_schedules;
create policy visit_schedules_read_team on public.visit_schedules for select to authenticated using (public.is_team_member());
drop policy if exists visit_schedules_insert_team on public.visit_schedules;
create policy visit_schedules_insert_team on public.visit_schedules for insert to authenticated with check (public.is_team_member() and created_by = (select auth.uid()));
drop policy if exists visit_schedules_update_team on public.visit_schedules;
create policy visit_schedules_update_team on public.visit_schedules for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
drop policy if exists visit_schedules_delete_team on public.visit_schedules;
create policy visit_schedules_delete_team on public.visit_schedules for delete to authenticated using (public.is_team_member());

drop policy if exists team_can_read_activity on public.activity_log;
create policy team_can_read_activity on public.activity_log
for select to authenticated using (public.is_team_member());

drop policy if exists manager_can_restore_activity on public.activity_log;
create policy manager_can_restore_activity on public.activity_log
for insert to authenticated
with check (public.current_user_role() = 'manager' and public.is_team_member());

-- Private file storage is Supabase Storage. Each physical chunk is below 50 MiB.
-- Application-level files can be up to 800 MiB, subject to the finite storage quota of the selected plan.
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
  and (
    exists (select 1 from public.task_attachments a where a.path = storage.objects.name or storage.objects.name like (a.path || '/%'))
    or exists (select 1 from public.content_assets c where c.path = storage.objects.name or storage.objects.name like (c.path || '/%'))
  )
);

drop policy if exists "ruang_kerja_storage_insert" on storage.objects;
create policy "ruang_kerja_storage_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'ruang-kerja-files'
  and public.is_team_member()
  and (
    name like ('content/' || (select auth.uid())::text || '/%')
    or (
      split_part(name, '/', 2) = (select auth.uid())::text
      and exists (select 1 from public.tasks t where t.id::text = split_part(name, '/', 1))
    )
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
    exists (select 1 from public.task_attachments a where a.path = storage.objects.name or storage.objects.name like (a.path || '/%'))
    or exists (select 1 from public.content_assets c where c.path = storage.objects.name or storage.objects.name like (c.path || '/%'))
    or (
      split_part(name, '/', 2) = (select auth.uid())::text
      and exists (select 1 from public.tasks t where t.id::text = split_part(name, '/', 1))
    )
    or name like ('content/' || (select auth.uid())::text || '/%')
  )
);


drop policy if exists ruang_kerja_content_storage_select on storage.objects;
create policy ruang_kerja_content_storage_select
on storage.objects for select to authenticated
using (
  bucket_id = 'ruang-kerja-files'
  and name like 'content/%'
  and public.is_team_member()
  and exists (
    select 1 from public.content_assets c
    where c.path = storage.objects.name or storage.objects.name like (c.path || '/%')
  )
);

drop policy if exists ruang_kerja_content_storage_insert on storage.objects;
create policy ruang_kerja_content_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ruang-kerja-files'
  and name like ('content/' || (select auth.uid())::text || '/%')
  and public.is_team_member()
);

drop policy if exists ruang_kerja_content_storage_delete on storage.objects;
create policy ruang_kerja_content_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'ruang-kerja-files'
  and name like 'content/%'
  and public.is_team_member()
);
