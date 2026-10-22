-- Expand Ruang Kerja: dual color-coded codes, chunked file metadata, task deletion and visit schedules.
-- Safe to reapply: new columns and table use IF NOT EXISTS; policies/constraints are recreated deliberately.

ALTER TABLE private.shared_access_codes ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT 'Kode 1';
ALTER TABLE private.shared_access_codes ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#dc2626';
UPDATE private.shared_access_codes SET label = 'Kode 1', color = '#dc2626'
WHERE code_hash = 'a81e6971ddccc89162cac77a91512c87a90fc822e45963907bab25617296ed6d';
INSERT INTO private.shared_access_codes (code_hash, enabled, label, color)
VALUES ('fe54512c43e4771bdbe70a3e8e4f8673ad6bfa40dac407da2f780bb454e34b43', true, 'Kode 2', '#ec4899')
ON CONFLICT (code_hash) DO UPDATE SET enabled = true, label = 'Kode 2', color = '#ec4899';

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS access_label text NOT NULL DEFAULT 'Kode 1';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS access_color text NOT NULL DEFAULT '#dc2626';
UPDATE public.profiles
SET display_name = 'Kode 1', access_label = 'Kode 1', access_color = '#dc2626'
WHERE access_label IS NULL OR access_label = '' OR access_color IS NULL OR access_color = '';

CREATE OR REPLACE FUNCTION public.activate_access_code(p_code text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_normalized text;
  v_hash text;
  v_label text;
  v_color text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sesi akses tidak tersedia. Coba masuk kembali.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_user_id AND COALESCE(u.is_anonymous, false)) THEN
    RAISE EXCEPTION 'Sesi bukan sesi kode akses.';
  END IF;
  v_normalized := upper(regexp_replace(coalesce(p_code, ''), '\\s+', '', 'g'));
  IF length(v_normalized) < 20 OR length(v_normalized) > 80 THEN RETURN false; END IF;
  v_hash := encode(extensions.digest(convert_to(v_normalized, 'UTF8'), 'sha256'), 'hex');
  SELECT c.label, c.color INTO v_label, v_color FROM private.shared_access_codes c
  WHERE c.code_hash = v_hash AND c.enabled = true;
  IF v_label IS NULL THEN RETURN false; END IF;
  INSERT INTO public.profiles (id, display_name, role, access_label, access_color)
  VALUES (v_user_id, v_label, 'manager', v_label, v_color)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, role = 'manager',
    access_label = EXCLUDED.access_label, access_color = EXCLUDED.access_color;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.activate_access_code(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_access_code(text) TO authenticated;
GRANT SELECT (access_label, access_color) ON public.profiles TO authenticated;

ALTER TABLE public.task_attachments ADD COLUMN IF NOT EXISTS storage_parts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.content_assets ADD COLUMN IF NOT EXISTS storage_parts jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE public.task_attachments SET storage_parts = jsonb_build_array(path) WHERE storage_parts IS NULL OR storage_parts = '[]'::jsonb;
UPDATE public.content_assets SET storage_parts = jsonb_build_array(path) WHERE storage_parts IS NULL OR storage_parts = '[]'::jsonb;
ALTER TABLE public.task_attachments DROP CONSTRAINT IF EXISTS task_attachments_size_bytes_check;
ALTER TABLE public.task_attachments DROP CONSTRAINT IF EXISTS task_attachments_logical_size_check;
ALTER TABLE public.task_attachments ADD CONSTRAINT task_attachments_logical_size_check CHECK (size_bytes > 0 AND size_bytes <= 838860800);
ALTER TABLE public.content_assets DROP CONSTRAINT IF EXISTS content_assets_size_bytes_check;
ALTER TABLE public.content_assets DROP CONSTRAINT IF EXISTS content_assets_logical_size_check;
ALTER TABLE public.content_assets ADD CONSTRAINT content_assets_logical_size_check CHECK (size_bytes > 0 AND size_bytes <= 838860800);
GRANT INSERT (id, task_id, path, file_name, content_type, size_bytes, storage_parts, uploaded_by, created_at, attachment_type) ON public.task_attachments TO authenticated;

DROP POLICY IF EXISTS team_can_add_attachments ON public.task_attachments;
CREATE POLICY team_can_add_attachments ON public.task_attachments FOR INSERT TO authenticated
WITH CHECK (public.is_team_member() AND uploaded_by = (SELECT auth.uid())
  AND size_bytes > 0 AND size_bytes <= 838860800
  AND path LIKE task_id::text || '/%'
  AND jsonb_typeof(storage_parts) = 'array' AND jsonb_array_length(storage_parts) BETWEEN 1 AND 100
  AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_attachments.task_id));

DROP POLICY IF EXISTS content_assets_insert_team ON public.content_assets;
CREATE POLICY content_assets_insert_team ON public.content_assets FOR INSERT TO authenticated
WITH CHECK (public.is_team_member() AND uploaded_by = (SELECT auth.uid())
  AND size_bytes > 0 AND size_bytes <= 838860800
  AND path LIKE ('content/' || (SELECT auth.uid())::text || '/%')
  AND jsonb_typeof(storage_parts) = 'array' AND jsonb_array_length(storage_parts) BETWEEN 1 AND 100);

DROP POLICY IF EXISTS "ruang_kerja_storage_select" ON storage.objects;
CREATE POLICY "ruang_kerja_storage_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'ruang-kerja-files' AND public.is_team_member() AND (
  EXISTS (SELECT 1 FROM public.task_attachments a WHERE a.path = storage.objects.name OR storage.objects.name LIKE (a.path || '/%'))
  OR EXISTS (SELECT 1 FROM public.content_assets c WHERE c.path = storage.objects.name OR storage.objects.name LIKE (c.path || '/%'))
));

DROP POLICY IF EXISTS ruang_kerja_content_storage_select ON storage.objects;
CREATE POLICY ruang_kerja_content_storage_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'ruang-kerja-files' AND name LIKE 'content/%' AND public.is_team_member()
  AND EXISTS (SELECT 1 FROM public.content_assets c WHERE c.path = storage.objects.name OR storage.objects.name LIKE (c.path || '/%')));

DROP POLICY IF EXISTS "ruang_kerja_storage_delete_team" ON storage.objects;
CREATE POLICY "ruang_kerja_storage_delete_team" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'ruang-kerja-files' AND public.is_team_member() AND (
  EXISTS (SELECT 1 FROM public.task_attachments a WHERE a.path = storage.objects.name OR storage.objects.name LIKE (a.path || '/%'))
  OR EXISTS (SELECT 1 FROM public.content_assets c WHERE c.path = storage.objects.name OR storage.objects.name LIKE (c.path || '/%'))
  OR (split_part(name, '/', 2) = (SELECT auth.uid())::text AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id::text = split_part(name, '/', 1)))
  OR name LIKE ('content/' || (SELECT auth.uid())::text || '/%')
));

DROP POLICY IF EXISTS ruang_kerja_content_storage_delete ON storage.objects;
CREATE POLICY ruang_kerja_content_storage_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'ruang-kerja-files' AND name LIKE 'content/%' AND public.is_team_member()
  AND EXISTS (SELECT 1 FROM public.content_assets c WHERE c.path = storage.objects.name OR storage.objects.name LIKE (c.path || '/%')));

GRANT DELETE ON public.tasks TO authenticated;
DROP POLICY IF EXISTS team_can_delete_tasks ON public.tasks;
CREATE POLICY team_can_delete_tasks ON public.tasks FOR DELETE TO authenticated USING (public.is_team_member());

CREATE TABLE IF NOT EXISTS public.visit_schedules (
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
CREATE INDEX IF NOT EXISTS visit_schedules_date_idx ON public.visit_schedules (visit_date, start_time);
ALTER TABLE public.visit_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.visit_schedules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_schedules TO authenticated;
DROP POLICY IF EXISTS visit_schedules_read_team ON public.visit_schedules;
CREATE POLICY visit_schedules_read_team ON public.visit_schedules FOR SELECT TO authenticated USING (public.is_team_member());
DROP POLICY IF EXISTS visit_schedules_insert_team ON public.visit_schedules;
CREATE POLICY visit_schedules_insert_team ON public.visit_schedules FOR INSERT TO authenticated WITH CHECK (public.is_team_member() AND created_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS visit_schedules_update_team ON public.visit_schedules;
CREATE POLICY visit_schedules_update_team ON public.visit_schedules FOR UPDATE TO authenticated USING (public.is_team_member()) WITH CHECK (public.is_team_member());
DROP POLICY IF EXISTS visit_schedules_delete_team ON public.visit_schedules;
CREATE POLICY visit_schedules_delete_team ON public.visit_schedules FOR DELETE TO authenticated USING (public.is_team_member());
