drop policy if exists content_assets_update_team on public.content_assets;
create policy content_assets_update_team
on public.content_assets for update to authenticated
using (public.is_team_member())
with check (public.is_team_member());

create index if not exists content_assets_uploaded_by_idx
on public.content_assets (uploaded_by);
