-- Permanent shared code access for Ruang Kerja.
-- Only the SHA-256 digest is saved here; never commit the raw access code.
create schema if not exists private;
revoke all on schema private from public, anon;

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

create or replace function public.consume_access_invite()
returns trigger
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_code text; v_hash text; v_role text;
begin
  if coalesce(new.is_anonymous, false) then return new; end if;
  v_code := upper(regexp_replace(coalesce(new.raw_user_meta_data ->> 'invite_code', ''), '\s+', '', 'g'));
  if length(v_code) < 20 or length(v_code) > 80 then raise exception 'Kode undangan tidak valid atau sudah digunakan'; end if;
  v_hash := encode(digest(v_code, 'sha256'), 'hex');
  select role into v_role from private.access_invites where code_hash = v_hash and used_at is null for update;
  if v_role is null then raise exception 'Kode undangan tidak valid atau sudah digunakan'; end if;
  update private.access_invites set used_at = now() where code_hash = v_hash;
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'invite_code';
  new.raw_app_meta_data := jsonb_set(coalesce(new.raw_app_meta_data, '{}'::jsonb), '{team_role}', to_jsonb(v_role), true);
  return new;
end;
$$;
revoke all on function public.consume_access_invite() from public, anon, authenticated;

create or replace function public.create_profile_for_invited_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if coalesce(new.is_anonymous, false) then return new; end if;
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Anggota'),
    case when new.raw_app_meta_data ->> 'team_role' = 'manager' then 'manager' else 'member' end);
  return new;
end;
$$;
revoke all on function public.create_profile_for_invited_user() from public, anon, authenticated;

create or replace function public.activate_access_code(p_code text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_normalized text;
  v_hash text;
  v_valid boolean;
begin
  if v_user_id is null then raise exception 'Sesi akses tidak tersedia. Coba masuk kembali.'; end if;
  if not exists (select 1 from auth.users u where u.id = v_user_id and coalesce(u.is_anonymous, false)) then
    raise exception 'Sesi bukan sesi kode akses.';
  end if;
  v_normalized := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
  if length(v_normalized) < 20 or length(v_normalized) > 80 then return false; end if;
  v_hash := encode(extensions.digest(convert_to(v_normalized, 'UTF8'), 'sha256'), 'hex');
  select exists (select 1 from private.shared_access_codes c where c.code_hash = v_hash and c.enabled) into v_valid;
  if not v_valid then return false; end if;
  insert into public.profiles (id, display_name, role)
    values (v_user_id, 'Pengguna Ruang Kerja', 'manager')
    on conflict (id) do update set role = 'manager';
  return true;
end;
$$;
revoke all on function public.activate_access_code(text) from public, anon, authenticated;
grant execute on function public.activate_access_code(text) to authenticated;
