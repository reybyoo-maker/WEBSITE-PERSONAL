-- Google Drive provider, server-side OAuth tokens, and daily retention cleanup support.
ALTER TABLE public.task_attachments
  DROP CONSTRAINT IF EXISTS task_attachments_storage_provider_check;
ALTER TABLE public.task_attachments
  ADD CONSTRAINT task_attachments_storage_provider_check
  CHECK (storage_provider IN ('supabase','backblaze','google_drive'));

ALTER TABLE public.content_assets
  DROP CONSTRAINT IF EXISTS content_assets_storage_provider_check;
ALTER TABLE public.content_assets
  ADD CONSTRAINT content_assets_storage_provider_check
  CHECK (storage_provider IN ('supabase','backblaze','google_drive'));

CREATE TABLE IF NOT EXISTS public.google_drive_credentials (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  refresh_token text NOT NULL,
  folder_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.google_drive_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_drive_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.google_drive_credentials TO service_role;

CREATE TABLE IF NOT EXISTS public.google_drive_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS google_drive_oauth_states_expiry_idx
  ON public.google_drive_oauth_states (expires_at);
ALTER TABLE public.google_drive_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_drive_oauth_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.google_drive_oauth_states TO service_role;

COMMENT ON TABLE public.google_drive_credentials IS
  'Server-only Google Drive OAuth refresh token and private Ruang Kerja Rey folder ID. Never expose through client APIs.';
COMMENT ON TABLE public.google_drive_oauth_states IS
  'One-time expiring OAuth state values used only by the private Google Drive OAuth callback.';
