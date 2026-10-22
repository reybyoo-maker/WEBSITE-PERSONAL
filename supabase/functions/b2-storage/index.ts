import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} from "npm:@aws-sdk/client-s3@3.821.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.821.0";

const APP_ORIGIN = "https://reybyoo-maker.github.io";
const ALLOWED_ORIGINS = new Set([
  APP_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);
const MAX_PART_BYTES = 20 * 1024 * 1024;
const MAX_DELETE_KEYS = 500;

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : APP_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}
function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}
function uuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function parsePartKey(key: unknown) {
  if (typeof key !== "string" || key.length > 1024 || key.includes("\\") || key.split("/").some((p) => !p || p === "." || p === "..")) return null;
  const segments = key.split("/");
  if (segments.length !== 4 || !/^part-\d{4}$/.test(segments[3])) return null;
  if (segments[0] === "content") {
    if (!uuidLike(segments[1]) || !uuidLike(segments[2])) return null;
    return { key, root: segments.slice(0, 3).join("/"), ownerId: segments[1], taskId: null };
  }
  if (!uuidLike(segments[0]) || !uuidLike(segments[1]) || !uuidLike(segments[2])) return null;
  return { key, root: segments.slice(0, 3).join("/"), ownerId: segments[1], taskId: segments[0] };
}
function getB2Client() {
  const endpoint = (Deno.env.get("B2_ENDPOINT") || "").replace(/\/$/, "");
  const region = Deno.env.get("B2_REGION") || "";
  const bucket = Deno.env.get("B2_BUCKET_NAME") || "";
  const accessKeyId = Deno.env.get("B2_KEY_ID") || "";
  const secretAccessKey = Deno.env.get("B2_APPLICATION_KEY") || "";
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Backblaze belum dikonfigurasi. Isi B2_ENDPOINT, B2_REGION, B2_BUCKET_NAME, B2_KEY_ID, dan B2_APPLICATION_KEY di Supabase Edge Function Secrets.");
  }
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== "https:" || !parsedEndpoint.hostname.endsWith("backblazeb2.com")) {
    throw new Error("B2_ENDPOINT harus berupa endpoint S3 HTTPS resmi Backblaze.");
  }
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucket };
}
async function authorizeTeamUser(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  const keyRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "";
  let publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!publishableKey && keyRaw) {
    try { publishableKey = JSON.parse(keyRaw).default || ""; } catch { /* invalid key configuration */ }
  }
  if (!authorization.startsWith("Bearer ") || !projectUrl || !publishableKey) {
    throw new Error("Sesi tidak valid. Silakan login ulang dengan kode akses.");
  }
  const supabase = createClient(projectUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("Sesi tidak valid. Silakan login ulang dengan kode akses.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("id").eq("id", authData.user.id).maybeSingle();
  if (profileError || !profile) throw new Error("Kode akses belum tervalidasi untuk ruang kerja ini.");
  return { supabase, user: authData.user };
}
async function isReferencedPart(supabase: ReturnType<typeof createClient>, parsed: NonNullable<ReturnType<typeof parsePartKey>>) {
  for (const table of ["task_attachments", "content_assets"]) {
    const { data, error } = await supabase
      .from(table)
      .select("storage_parts")
      .eq("storage_provider", "backblaze")
      .eq("path", parsed.root)
      .limit(1);
    if (error) throw new Error("Metadata file tidak dapat diverifikasi.");
    const parts = data?.[0]?.storage_parts;
    if (Array.isArray(parts) && parts.includes(parsed.key)) return true;
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let auth: Awaited<ReturnType<typeof authorizeTeamUser>>;
  try {
    auth = await authorizeTeamUser(req);
  } catch (error) {
    return json(req, { error: error instanceof Error ? error.message : "Unauthorized" }, 401);
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json(req, { error: "JSON tidak valid." }, 400); }
  const action = String(payload.action || "");

  try {
    const { client, bucket } = getB2Client();

    if (action === "presign-upload") {
      const parsed = parsePartKey(payload.key);
      const contentType = typeof payload.contentType === "string" && payload.contentType.length <= 200
        ? payload.contentType : "application/octet-stream";
      const size = Number(payload.size);
      if (!parsed || parsed.ownerId !== auth.user.id) return json(req, { error: "Path upload tidak valid." }, 400);
      if (!Number.isInteger(size) || size < 1 || size > MAX_PART_BYTES) {
        return json(req, { error: "Setiap bagian upload harus berukuran antara 1 byte dan 20 MiB." }, 400);
      }
      if (parsed.taskId) {
        const { data: task, error } = await auth.supabase.from("tasks").select("id").eq("id", parsed.taskId).maybeSingle();
        if (error || !task) return json(req, { error: "Tugas untuk lampiran ini tidak ditemukan atau tidak dapat diakses." }, 403);
      }
      const url = await getSignedUrl(client, new PutObjectCommand({
        Bucket: bucket, Key: parsed.key, ContentType: contentType,
      }), { expiresIn: 900 });
      return json(req, { url, expires_in: 900 });
    }

    if (action === "presign-download") {
      const parsed = parsePartKey(payload.key);
      if (!parsed || !(await isReferencedPart(auth.supabase, parsed))) {
        return json(req, { error: "File tidak tercatat atau tidak memiliki akses." }, 404);
      }
      const url = await getSignedUrl(client, new GetObjectCommand({
        Bucket: bucket, Key: parsed.key,
      }), { expiresIn: 900 });
      return json(req, { url, expires_in: 900 });
    }

    if (action === "delete-objects") {
      if (!Array.isArray(payload.keys) || payload.keys.length > MAX_DELETE_KEYS) {
        return json(req, { error: "Daftar file untuk dihapus tidak valid atau terlalu banyak." }, 400);
      }
      const parsedKeys = payload.keys.map(parsePartKey);
      if (parsedKeys.some((item) => !item)) return json(req, { error: "Ada path file yang tidak valid." }, 400);
      for (const item of parsedKeys as NonNullable<ReturnType<typeof parsePartKey>>[]) {
        if (item.ownerId !== auth.user.id && !(await isReferencedPart(auth.supabase, item))) {
          return json(req, { error: "Penghapusan ditolak untuk file yang tidak tercatat." }, 403);
        }
      }
      const requestedKeys = new Set((parsedKeys as NonNullable<ReturnType<typeof parsePartKey>>[]).map((item) => item.key));
      const roots = new Set((parsedKeys as NonNullable<ReturnType<typeof parsePartKey>>[]).map((item) => item.root));
      const versionsToDelete: { Key: string; VersionId: string }[] = [];
      for (const root of roots) {
        let keyMarker: string | undefined;
        let versionMarker: string | undefined;
        let truncated = true;
        while (truncated) {
          const page = await client.send(new ListObjectVersionsCommand({
            Bucket: bucket,
            Prefix: root + "/",
            MaxKeys: 1000,
            ...(keyMarker ? { KeyMarker: keyMarker } : {}),
            ...(versionMarker ? { VersionIdMarker: versionMarker } : {}),
          }));
          for (const version of page.Versions || []) {
            if (version.Key && version.VersionId && requestedKeys.has(version.Key)) {
              versionsToDelete.push({ Key: version.Key, VersionId: version.VersionId });
            }
          }
          for (const marker of page.DeleteMarkers || []) {
            if (marker.Key && marker.VersionId && requestedKeys.has(marker.Key)) {
              versionsToDelete.push({ Key: marker.Key, VersionId: marker.VersionId });
            }
          }
          truncated = Boolean(page.IsTruncated);
          keyMarker = page.NextKeyMarker;
          versionMarker = page.NextVersionIdMarker;
          if (truncated && !keyMarker) throw new Error("Backblaze pagination versi file tidak lengkap.");
        }
      }
      for (let start = 0; start < versionsToDelete.length; start += 1000) {
        const result = await client.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: versionsToDelete.slice(start, start + 1000), Quiet: false },
        }));
        if (result.Errors?.length) {
          console.error("Sebagian versi objek B2 gagal dihapus:", result.Errors.map((item) => ({ key: item.Key, code: item.Code })));
          return json(req, { error: "Sebagian file gagal dihapus permanen dari Backblaze. Coba lagi sebelum menghapus metadata." }, 502);
        }
      }
      return json(req, { ok: true, deleted: requestedKeys.size, versionsPermanentlyDeleted: versionsToDelete.length });
    }

    return json(req, { error: "Aksi storage tidak dikenal." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Permintaan Backblaze gagal.";
    console.error("b2-storage error:", message);
    const status = message.includes("belum dikonfigurasi") || message.includes("B2_ENDPOINT") ? 503 : 502;
    return json(req, { error: status === 503 ? message : "Backblaze menolak permintaan. Periksa endpoint, region, bucket, dan izin application key." }, status);
  }
});
