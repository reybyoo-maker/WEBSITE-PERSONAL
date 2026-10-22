-- Move invite hashes out of the exposed public API schema.
-- This table is only accessed by the SECURITY DEFINER signup trigger.
create schema if not exists private;
revoke all on schema private from public, anon;

alter table public.access_invites set schema private;
revoke all on table private.access_invites from public, anon, authenticated;
alter table private.access_invites enable row level security;

create or replace function public.consume_access_invite()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
  v_hash text;
  v_role text;
begin
  v_code := upper(regexp_replace(coalesce(new.raw_user_meta_data ->> 'invite_code', ''), '\\s+', '', 'g'));
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
