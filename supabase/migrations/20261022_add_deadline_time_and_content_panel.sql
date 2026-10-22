alter table public.tasks
  add column if not exists due_time time without time zone;

-- The original schema uses column-level grants, so grant access to the new deadline time column too.
grant insert (due_time) on public.tasks to authenticated;
grant update (due_time) on public.tasks to authenticated;

create table if not exists public.content_assets (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 160),
  caption text not null default '' check (char_length(caption) <= 5000),
  scheduled_date date,
  scheduled_time time without time zone,
  path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint content_assets_owner_path_check
    check (path like ('content/' || uploaded_by::text || '/%'))
);

alter table public.content_assets enable row level security;
grant select, insert, update, delete on public.content_assets to authenticated;

create index if not exists content_assets_scheduled_idx
  on public.content_assets (scheduled_date, scheduled_time);
create index if not exists content_assets_created_idx
  on public.content_assets (created_at desc);
create index if not exists content_assets_uploaded_by_idx
  on public.content_assets (uploaded_by);

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
  and size_bytes > 0 and size_bytes <= 52428800
  and path like ('content/' || (select auth.uid())::text || '/%')
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

drop policy if exists ruang_kerja_content_storage_select on storage.objects;
create policy ruang_kerja_content_storage_select
on storage.objects for select to authenticated
using (
  bucket_id = 'ruang-kerja-files'
  and name like 'content/%'
  and public.is_team_member()
  and exists (
    select 1 from public.content_assets c
    where c.path = storage.objects.name
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
