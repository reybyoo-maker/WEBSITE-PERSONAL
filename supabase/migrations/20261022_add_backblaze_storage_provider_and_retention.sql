-- Backblaze B2 provider metadata and 14-day retention tracking.
-- Existing Supabase Storage objects remain tagged as "supabase" and receive a 14-day grace period
-- starting when this migration runs, instead of being deleted immediately based on their old created_at.

ALTER TABLE public.task_attachments
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'supabase'
    CHECK (storage_provider IN ('supabase','backblaze')),
  ADD COLUMN IF NOT EXISTS storage_uploaded_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.content_assets
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'supabase'
    CHECK (storage_provider IN ('supabase','backblaze')),
  ADD COLUMN IF NOT EXISTS storage_uploaded_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS task_attachments_storage_age_idx
  ON public.task_attachments (storage_uploaded_at);
CREATE INDEX IF NOT EXISTS content_assets_storage_age_idx
  ON public.content_assets (storage_uploaded_at);

REVOKE INSERT ON public.task_attachments FROM authenticated;
GRANT INSERT (
  id, task_id, path, file_name, content_type, size_bytes, storage_parts,
  uploaded_by, created_at, attachment_type, storage_provider
) ON public.task_attachments TO authenticated;

COMMENT ON COLUMN public.task_attachments.storage_provider IS
  'Storage backend for this attachment: supabase for legacy files or backblaze for B2 objects.';
COMMENT ON COLUMN public.task_attachments.storage_uploaded_at IS
  'Timestamp used for the 14-day file retention policy. Existing files start their grace period at migration time.';
COMMENT ON COLUMN public.content_assets.storage_provider IS
  'Storage backend for this content file: supabase for legacy files or backblaze for B2 objects.';
COMMENT ON COLUMN public.content_assets.storage_uploaded_at IS
  'Timestamp used for the 14-day file retention policy. Existing files start their grace period at migration time.';
