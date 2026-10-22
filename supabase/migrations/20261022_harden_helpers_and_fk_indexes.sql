-- Put SECURITY DEFINER implementations outside the exposed Data API schema.
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

-- Public wrappers are invoker functions for RLS policy compatibility.
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

create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists task_comments_user_id_idx on public.task_comments (user_id);
create index if not exists task_attachments_uploaded_by_idx on public.task_attachments (uploaded_by);
create index if not exists activity_log_task_id_idx on public.activity_log (task_id);
create index if not exists activity_log_actor_id_idx on public.activity_log (actor_id);
