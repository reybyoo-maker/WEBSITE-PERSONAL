import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const APP_URL = "https://reybyoo-maker.github.io/WEBSITE-PERSONAL/";
const FUNCTION_URL = "https://edgzffkhjtzejxjbtqib.supabase.co/functions/v1/google-drive-storage";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const MAX_PART_BYTES = 20 * 1024 * 1024;
const BUCKET = "ruang-kerja-files";

function headers(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = new Set([
    "https://reybyoo-maker.github.io",
    "http://localhost:5173",
    "http://127.0.0.1:5500",
  ]);
  return {
    "Access-Control-Allow-Origin": allowed.has(origin) ? origin : "https://reybyoo-maker.github.io",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-retention-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}
function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}
function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function env(name: string) { return Deno.env.get(name)?.trim() || ""; }
function driveOAuthConfig() {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  const redirectUri = env("GOOGLE_REDIRECT_URI") || FUNCTION_URL;
  if (!clientId || !clientSecret) {
    throw new Error("Google Drive belum disiapkan. Tambahkan GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET di Supabase Edge Function Secrets.");
  }
  if (redirectUri !== FUNCTION_URL) {
    throw new Error("GOOGLE_REDIRECT_URI harus sama persis dengan callback Google Drive: " + FUNCTION_URL);
  }
  return { clientId, clientSecret, redirectUri };
}
function serviceClient() {
  const url = env("SUPABASE_URL");
  const keyMap = env("SUPABASE_SECRET_KEYS");
  let key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!key && keyMap) {
    try { key = JSON.parse(keyMap).default || ""; } catch { /* invalid secret key map */ }
  }
  if (!url || !key) throw new Error("Kredensial backend Supabase belum tersedia.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function authenticate(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const projectUrl = env("SUPABASE_URL");
  const keyMapRaw = env("SUPABASE_PUBLISHABLE_KEYS");
  let publishableKey = env("SUPABASE_ANON_KEY");
  if (!publishableKey && keyMapRaw) {
    try { publishableKey = JSON.parse(keyMapRaw).default || ""; } catch { /* invalid public key map */ }
  }
  if (!authorization.startsWith("Bearer ") || !projectUrl || !publishableKey) {
    throw new Error("Sesi tidak valid. Silakan login ulang dengan kode akses.");
  }
  const supabase = createClient(projectUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sesi tidak valid. Silakan login ulang dengan kode akses.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("id").eq("id", data.user.id).maybeSingle();
  if (profileError || !profile) throw new Error("Kode akses belum tervalidasi untuk ruang kerja ini.");
  return { user: data.user, supabase, admin: serviceClient() };
}
function parsePartKey(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 1024 || raw.includes("\\") ||
      raw.split("/").some((p) => !p || p === "." || p === "..")) return null;
  const parts = raw.split("/");
  if (parts.length !== 4 || !/^part-\d{4}$/.test(parts[3])) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (parts[0] === "content") {
    if (!uuid.test(parts[1]) || !uuid.test(parts[2])) return null;
    return { key: raw, root: parts.slice(0, 3).join("/"), ownerId: parts[1], taskId: null };
  }
  if (!uuid.test(parts[0]) || !uuid.test(parts[1]) || !uuid.test(parts[2])) return null;
  return { key: raw, root: parts.slice(0, 3).join("/"), ownerId: parts[1], taskId: parts[0] };
}
async function loadCredentials(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin.from("google_drive_credentials").select("id,refresh_token,folder_id,updated_at").eq("id", 1).maybeSingle();
  if (error) throw new Error("Pengaturan Google Drive tidak dapat dibaca.");
  if (!data) throw new Error("Google Drive belum terhubung. Buka Arsip & file lalu klik Hubungkan Google Drive.");
  return data;
}
async function refreshAccessToken(admin: ReturnType<typeof createClient>) {
  const credential = await loadCredentials(admin);
  const { clientId, clientSecret } = driveOAuthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credential.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || typeof token.access_token !== "string") {
    console.error("Google OAuth refresh failed:", token.error || response.status);
    throw new Error("Google Drive tidak dapat memperbarui akses. Hubungkan ulang Google Drive dari menu Arsip & file.");
  }
  return { accessToken: token.access_token as string, folderId: credential.folder_id as string };
}
async function createDriveFolder(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Ruang Kerja Rey",
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.id !== "string") {
    console.error("Google Drive folder create failed:", body.error?.status || response.status);
    throw new Error("Folder Ruang Kerja Rey tidak dapat dibuat di Google Drive.");
  }
  return body.id as string;
}
async function tokenFromAuthorizationCode(code: string) {
  const { clientId, clientSecret, redirectUri } = driveOAuthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== "string") {
    console.error("Google OAuth exchange failed:", body.error || response.status);
    throw new Error("Google menolak koneksi OAuth. Periksa Client ID, Client Secret, callback URI, dan status consent screen.");
  }
  return body as { access_token: string; refresh_token?: string; expires_in?: number };
}
function callbackPage(ok: boolean, message: string) {
  const safeMessage = escapeHtml(message);
  return html(`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Drive · Ruang Kerja Rey</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:620px;margin:12vh auto;padding:24px;color:#1f2937"><h1>${ok ? "Google Drive berhasil terhubung" : "Google Drive belum terhubung"}</h1><p>${safeMessage}</p><p><a href="${APP_URL}">Kembali ke Ruang Kerja Rey</a></p>${ok ? '<script>setTimeout(()=>location.replace("'+APP_URL+'"),1800)</script>' : ""}</body></html>`, ok ? 200 : 400);
}
async function handleOAuthCallback(url: URL) {
  if (url.searchParams.get("error")) {
    return callbackPage(false, "Izin Google Drive tidak diberikan. Silakan kembali ke portal dan coba lagi.");
  }
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || !state || state.length > 200) return callbackPage(false, "Parameter OAuth tidak lengkap.");
  try {
    const admin = serviceClient();
    const { data: savedState, error } = await admin
      .from("google_drive_oauth_states").select("state,user_id,expires_at")
      .eq("state", state).gt("expires_at", new Date().toISOString()).maybeSingle();
    await admin.from("google_drive_oauth_states").delete().eq("state", state);
    if (error || !savedState) return callbackPage(false, "Permintaan koneksi sudah kedaluwarsa atau tidak valid. Mulai ulang dari portal.");
    const token = await tokenFromAuthorizationCode(code);
    const { data: existing, error: existingError } = await admin
      .from("google_drive_credentials").select("refresh_token,folder_id").eq("id", 1).maybeSingle();
    if (existingError) throw new Error("Kredensial Google Drive yang lama tidak dapat dibaca.");
    let refreshToken = token.refresh_token || existing?.refresh_token || "";
    if (!refreshToken) throw new Error("Google tidak mengirim refresh token. Hapus izin aplikasi dari Akun Google, lalu hubungkan ulang dengan prompt consent.");
    let folderId = existing?.folder_id || "";
    if (!folderId) folderId = await createDriveFolder(token.access_token);
    const { error: saveError } = await admin.from("google_drive_credentials").upsert({
      id: 1, refresh_token: refreshToken, folder_id: folderId, updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (saveError) throw new Error("Token Google berhasil didapat, tetapi penyimpanan kredensial tidak berhasil.");
    return callbackPage(true, "Akun Google sudah tersambung dengan folder privat untuk file Ruang Kerja Rey.");
  } catch (error) {
    return callbackPage(false, error instanceof Error ? error.message : "Koneksi Google Drive gagal.");
  }
}
async function listDriveReferences(admin: ReturnType<typeof createClient>) {
  const ids = new Set<string>();
  for (const table of ["task_attachments", "content_assets"]) {
    let start = 0;
    while (true) {
      const { data, error } = await admin.from(table).select("storage_parts")
        .eq("storage_provider", "google_drive").range(start, start + 499);
      if (error) throw new Error("Metadata file tidak dapat diverifikasi.");
      for (const row of data || []) {
        if (Array.isArray(row.storage_parts)) {
          for (const id of row.storage_parts) if (typeof id === "string") ids.add(id);
        }
      }
      if (!data || data.length < 500) break;
      start += 500;
    }
  }
  return ids;
}
async function isDriveIdReferenced(admin: ReturnType<typeof createClient>, id: string) {
  if (!id || id.length > 300 || /[^\w-]/.test(id)) return false;
  const ids = await listDriveReferences(admin);
  return ids.has(id);
}
async function deleteDriveFile(accessToken: string, fileId: string) {
  const response = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId), {
    method: "DELETE",
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => ({}));
    console.error("Google Drive delete failed:", body.error?.status || response.status);
    throw new Error("File gagal dihapus permanen dari Google Drive.");
  }
}
async function deleteDriveFiles(accessToken: string, ids: string[]) {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && /^[\w-]{5,300}$/.test(id)))];
  for (let i = 0; i < unique.length; i += 5) {
    await Promise.all(unique.slice(i, i + 5).map((id) => deleteDriveFile(accessToken, id)));
  }
  return unique.length;
}
async function createResumableUpload(
  accessToken: string, folderId: string, key: string, mimeType: string, size: number, ownerId: string,
) {
  const safeName = "RK-" + key.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 170);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({
      name: safeName,
      mimeType,
      parents: [folderId],
      appProperties: {
        rk_owner: ownerId,
        rk_storage_key: key,
        rk_app: "ruang-kerja-rey",
      },
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    console.error("Google Drive upload session failed:", body.error?.status || response.status);
    throw new Error("Sesi upload Google Drive gagal dibuat. Periksa Drive API, OAuth, dan kuota.");
  }
  const uploadUrl = response.headers.get("Location");
  if (!uploadUrl || !uploadUrl.startsWith("https://")) throw new Error("Google tidak mengirim URL sesi upload yang valid.");
  return uploadUrl;
}
async function removeSupabaseObjects(admin: ReturnType<typeof createClient>, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw new Error("File lama di Supabase Storage tidak dapat dihapus.");
  }
}
async function fetchExpiredRows(admin: ReturnType<typeof createClient>, table: "task_attachments" | "content_assets", cutoff: string) {
  const output: Record<string, unknown>[] = [];
  let start = 0;
  while (true) {
    const { data, error } = await admin.from(table).select("id,path,storage_parts,storage_provider,storage_uploaded_at,created_at,file_name")
      .lte("storage_uploaded_at", cutoff).range(start, start + 499);
    if (error) throw new Error("Daftar file kedaluwarsa tidak dapat dibaca.");
    output.push(...(data || []));
    if (!data || data.length < 500) break;
    start += 500;
  }
  return output;
}
async function scheduledCleanup(req: Request) {
  const expected = env("GDRIVE_CLEANUP_TOKEN");
  const supplied = req.headers.get("x-retention-token") || "";
  if (!expected || !supplied || supplied.length !== expected.length) return json(req, { error: "Unauthorized cleanup caller." }, 401);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  if (diff !== 0) return json(req, { error: "Unauthorized cleanup caller." }, 401);

  const admin = serviceClient();
  const cutoffDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const cutoff = cutoffDate.toISOString();
  const [attachments, content] = await Promise.all([
    fetchExpiredRows(admin, "task_attachments", cutoff),
    fetchExpiredRows(admin, "content_assets", cutoff),
  ]);
  const expired = [
    ...attachments.map((row) => ({ ...row, _table: "task_attachments" as const })),
    ...content.map((row) => ({ ...row, _table: "content_assets" as const })),
  ];
  let driveAuth: { accessToken: string; folderId: string } | null = null;
  if (expired.some((row) => row.storage_provider === "google_drive")) {
    driveAuth = await refreshAccessToken(admin);
  }

  const failures: string[] = [];
  let deletedRows = 0;
  let deletedDriveParts = 0;
  let deletedSupabaseParts = 0;
  for (const row of expired) {
    const paths = Array.isArray(row.storage_parts) && row.storage_parts.length
      ? row.storage_parts.filter((id) => typeof id === "string" && id)
      : (typeof row.path === "string" && row.path ? [row.path] : []);
    try {
      if (row.storage_provider === "google_drive") {
        if (!driveAuth) driveAuth = await refreshAccessToken(admin);
        deletedDriveParts += await deleteDriveFiles(driveAuth.accessToken, paths);
      } else if (row.storage_provider === "supabase") {
        await removeSupabaseObjects(admin, paths);
        deletedSupabaseParts += paths.length;
      } else if (row.storage_provider === "backblaze") {
        throw new Error("File lama dari Backblaze perlu dibersihkan sebelum provider dihapus.");
      }
      const { error } = await admin.from(row._table).delete().eq("id", row.id);
      if (error) throw new Error("File sudah dihapus dari storage tetapi metadata belum terhapus.");
      deletedRows++;
    } catch (error) {
      console.error("Scheduled cleanup failed:", row.file_name, error);
      failures.push(String(row.file_name || row.id));
    }
  }

  // Sweep old, unreferenced Drive objects in the private app folder (for failed uploads whose metadata never saved).
  if (driveAuth) {
    try {
      const referenced = await listDriveReferences(admin);
      let pageToken = "";
      const orphanIds: string[] = [];
      while (true) {
        const params = new URLSearchParams({
          q: "'" + driveAuth.folderId.replace(/'/g, "\\'") + "' in parents and trashed = false and createdTime < '" + cutoff + "'",
          fields: "nextPageToken,files(id,createdTime)",
          pageSize: "1000",
          orderBy: "createdTime",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const response = await fetch("https://www.googleapis.com/drive/v3/files?" + params.toString(), {
          headers: { Authorization: "Bearer " + driveAuth.accessToken },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("Tidak dapat mencari file yatim di Google Drive.");
        for (const file of (body.files || []) as { id?: string }[]) {
          if (file.id && !referenced.has(file.id)) orphanIds.push(file.id);
        }
        pageToken = body.nextPageToken || "";
        if (!pageToken) break;
      }
      deletedDriveParts += await deleteDriveFiles(driveAuth.accessToken, orphanIds);
    } catch (error) {
      console.error("Orphan sweep failed:", error);
      failures.push("drive-orphans");
    }
  }

  return json(req, {
    ok: failures.length === 0,
    retention_days: 14,
    cutoff,
    deleted_metadata_rows: deletedRows,
    deleted_google_drive_files: deletedDriveParts,
    deleted_legacy_supabase_objects: deletedSupabaseParts,
    failed_items: failures,
  }, failures.length ? 207 : 200);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  const url = new URL(req.url);

  if (req.method === "GET" && (url.searchParams.has("code") || url.searchParams.has("error"))) {
    return await handleOAuthCallback(url);
  }
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json(req, { error: "Invalid JSON." }, 400); }
  const action = String(payload.action || "");
  if (action === "scheduled-cleanup") {
    try { return await scheduledCleanup(req); }
    catch (error) {
      console.error("Scheduled cleanup failed:", error);
      return json(req, { error: error instanceof Error ? error.message : "Scheduled cleanup gagal." }, 500);
    }
  }

  let auth: Awaited<ReturnType<typeof authenticate>>;
  try { auth = await authenticate(req); }
  catch (error) { return json(req, { error: error instanceof Error ? error.message : "Unauthorized." }, 401); }

  try {
    if (action === "status") {
      const { data, error } = await auth.admin.from("google_drive_credentials").select("id").eq("id", 1).maybeSingle();
      if (error) throw new Error("Status Google Drive tidak dapat dibaca.");
      return json(req, { connected: Boolean(data) });
    }

    if (action === "start-oauth") {
      const { clientId, redirectUri } = driveOAuthConfig();
      const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { error } = await auth.admin.from("google_drive_oauth_states").insert({
        state, user_id: auth.user.id, expires_at: expiresAt,
      });
      if (error) throw new Error("Tidak dapat membuat sesi koneksi Google Drive.");
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: DRIVE_SCOPE,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
      });
      return json(req, { url: "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString() });
    }

    if (action === "start-upload") {
      const parsed = parsePartKey(payload.key);
      const size = Number(payload.size);
      const mimeType = typeof payload.mimeType === "string" && payload.mimeType.length <= 200
        ? payload.mimeType : "application/octet-stream";
      if (!parsed || parsed.ownerId !== auth.user.id) return json(req, { error: "Path upload tidak valid." }, 400);
      if (!Number.isInteger(size) || size < 1 || size > MAX_PART_BYTES) return json(req, { error: "Setiap potongan harus berukuran 1 byte hingga 20 MiB." }, 400);
      if (parsed.taskId) {
        const { data: task, error } = await auth.supabase.from("tasks").select("id").eq("id", parsed.taskId).maybeSingle();
        if (error || !task) return json(req, { error: "Tugas untuk file ini tidak ditemukan atau tidak dapat diakses." }, 403);
      }
      const { accessToken, folderId } = await refreshAccessToken(auth.admin);
      const uploadUrl = await createResumableUpload(accessToken, folderId, parsed.key, mimeType, size, auth.user.id);
      return json(req, { uploadUrl, expires_in: 3600 });
    }

    if (action === "download-token") {
      const fileId = String(payload.fileId || "");
      if (!/^[\w-]{5,300}$/.test(fileId) || !(await isDriveIdReferenced(auth.admin, fileId))) {
        return json(req, { error: "File Google Drive tidak tercatat atau akses ditolak." }, 404);
      }
      const { accessToken } = await refreshAccessToken(auth.admin);
      return json(req, {
        accessToken,
        url: "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media",
        expires_in: 3600,
      });
    }

    if (action === "delete-objects") {
      if (!Array.isArray(payload.ids) || payload.ids.length > 500) return json(req, { error: "Daftar file untuk dihapus tidak valid." }, 400);
      const ids = [...new Set(payload.ids.map((value) => String(value || "")))];
      for (const id of ids) {
        if (!/^[\w-]{5,300}$/.test(id) || !(await isDriveIdReferenced(auth.admin, id))) {
          return json(req, { error: "Penghapusan ditolak untuk file yang tidak tercatat." }, 403);
        }
      }
      const { accessToken } = await refreshAccessToken(auth.admin);
      const deleted = await deleteDriveFiles(accessToken, ids);
      return json(req, { ok: true, deleted });
    }

    return json(req, { error: "Aksi Google Drive tidak dikenal." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Permintaan Google Drive gagal.";
    console.error("google-drive-storage error:", message);
    const missingConfig = /belum disiapkan|GOOGLE_REDIRECT_URI|Kredensial backend/i.test(message);
    return json(req, { error: message }, missingConfig ? 503 : 502);
  }
});
