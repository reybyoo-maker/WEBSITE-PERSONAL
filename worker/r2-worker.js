const MAX_PARTS = 10000;
const PART_SIZE = 64 * 1024 * 1024;
const MAX_FILE_SIZE = MAX_PARTS * PART_SIZE;
const SAFE_NAME = (name) => String(name || "file").normalize("NFKC")
  .replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
  const originAllowed = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": originAllowed ? origin : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Task-Id, X-Object-Key, X-Upload-Id, X-Part-Number",
    "Access-Control-Expose-Headers": "ETag",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(request, env, value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors(request, env), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
function fail(request, env, message, status = 400) {
  return json(request, env, { error: message }, status);
}
function required(env, names) {
  return names.every((name) => Boolean(env[name]));
}
async function authenticated(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Login diperlukan.");
  const token = authorization.slice(7);
  if (!required(env, ["SUPABASE_URL", "SUPABASE_ANON_KEY"])) throw new Error("Konfigurasi Supabase Worker belum lengkap.");
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token }
  });
  if (!response.ok) throw new Error("Sesi login tidak valid atau sudah berakhir.");
  const user = await response.json();
  if (!user || !user.id) throw new Error("Sesi login tidak valid.");
  return { id: user.id, token, email: user.email || "" };
}
async function dbGet(env, user, table, filters) {
  const url = new URL(env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + table);
  url.searchParams.set("select", filters.select || "*");
  for (const [key, value] of Object.entries(filters)) {
    if (key !== "select") url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: "Bearer " + user.token,
      Accept: "application/json"
    }
  });
  if (!response.ok) throw new Error("Izin akses data tidak dapat diverifikasi.");
  return response.json();
}
async function authorizeTask(env, user, taskId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId || "")) {
    throw new Error("ID tugas tidak valid.");
  }
  const profiles = await dbGet(env, user, "profiles", { select: "id,role", id: "eq." + user.id, limit: "1" });
  const profile = profiles[0];
  if (!profile) throw new Error("Akun bukan anggota tim.");
  const tasks = await dbGet(env, user, "tasks", { select: "id,created_by,assigned_to", id: "eq." + taskId, limit: "1" });
  const task = tasks[0];
  if (!task) throw new Error("Tugas tidak ditemukan atau tidak dapat diakses.");
  const allowed = profile.role === "manager" || task.created_by === user.id || task.assigned_to === user.id;
  if (!allowed) throw new Error("Kamu tidak memiliki izin untuk mengakses lampiran tugas ini.");
  return { profile, task };
}
function validateObjectKey(key, taskId, userId) {
  if (typeof key !== "string" || key.length > 512 || !key.startsWith(taskId + "/")) {
    throw new Error("Lokasi file tidak valid.");
  }
  const segments = key.split("/");
  if (segments.length < 3 || segments.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Lokasi file tidak valid.");
  }
  const owner = segments[1];
  if (owner !== userId) throw new Error("Upload ini dimulai oleh akun lain.");
}
async function handleUploadInit(request, env, user) {
  const payload = await request.json();
  const taskId = String(payload.taskId || "");
  const filename = String(payload.filename || "file");
  const size = Number(payload.size);
  const type = String(payload.contentType || "application/octet-stream").slice(0, 255);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_SIZE) {
    return fail(request, env, "Ukuran maksimum per file untuk transfer ini sekitar 625 GiB. Pecah file yang lebih besar menjadi beberapa bagian/file.", 413);
  }
  if (filename.length > 255) return fail(request, env, "Nama file terlalu panjang.");
  const { task } = await authorizeTask(env, user, taskId);
  if (!env.FILES_BUCKET) throw new Error("Binding bucket R2 FILES_BUCKET belum diatur.");
  const key = task.id + "/" + user.id + "/" + crypto.randomUUID() + "-" + SAFE_NAME(filename);
  const upload = await env.FILES_BUCKET.createMultipartUpload(key, {
    httpMetadata: { contentType: type, cacheControl: "private, no-store" },
    customMetadata: { taskId, uploadedBy: user.id }
  });
  return json(request, env, { key, uploadId: upload.uploadId, partSize: PART_SIZE, maxParts: MAX_PARTS });
}
async function handleUploadPart(request, env, user) {
  const taskId = request.headers.get("X-Task-Id") || "";
  const key = request.headers.get("X-Object-Key") || "";
  const uploadId = request.headers.get("X-Upload-Id") || "";
  const partNumber = Number(request.headers.get("X-Part-Number") || 0);
  validateObjectKey(key, taskId, user.id);
  await authorizeTask(env, user, taskId);
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
    return fail(request, env, "Nomor bagian upload tidak valid.");
  }
  if (!request.body) return fail(request, env, "Data file kosong.");
  const upload = env.FILES_BUCKET.resumeMultipartUpload(key, uploadId);
  const result = await upload.uploadPart(partNumber, request.body);
  return json(request, env, { partNumber, etag: result.etag });
}
async function handleUploadComplete(request, env, user) {
  const payload = await request.json();
  const taskId = String(payload.taskId || "");
  const key = String(payload.key || "");
  const uploadId = String(payload.uploadId || "");
  const parts = payload.parts;
  validateObjectKey(key, taskId, user.id);
  await authorizeTask(env, user, taskId);
  if (!uploadId || !Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PARTS) {
    return fail(request, env, "Daftar bagian upload tidak valid.");
  }
  const validParts = parts.map((part) => ({
    partNumber: Number(part.partNumber),
    etag: String(part.etag || "")
  })).sort((a, b) => a.partNumber - b.partNumber);
  if (validParts.some((part, index) => !Number.isInteger(part.partNumber) || part.partNumber !== index + 1 || !part.etag)) {
    return fail(request, env, "Urutan bagian file belum lengkap.");
  }
  const declaredSize = Number(payload.size);
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > MAX_FILE_SIZE) {
    return fail(request, env, "Ukuran file tidak valid.", 413);
  }
  const upload = env.FILES_BUCKET.resumeMultipartUpload(key, uploadId);
  const result = await upload.complete(validParts);
  if (Number(result.size) !== declaredSize || Number(result.size) > MAX_FILE_SIZE) {
    await env.FILES_BUCKET.delete(key);
    return fail(request, env, "Ukuran file hasil upload tidak sesuai dengan ukuran yang dilaporkan.", 409);
  }
  return json(request, env, { key, etag: result.httpEtag || result.etag || "", size: Number(result.size) });
}
async function handleUploadAbort(request, env, user) {
  const payload = await request.json();
  const taskId = String(payload.taskId || "");
  const key = String(payload.key || "");
  const uploadId = String(payload.uploadId || "");
  validateObjectKey(key, taskId, user.id);
  await authorizeTask(env, user, taskId);
  if (uploadId) {
    const upload = env.FILES_BUCKET.resumeMultipartUpload(key, uploadId);
    await upload.abort();
  }
  return json(request, env, { ok: true });
}

async function handleObjectDelete(request, env, user) {
  const payload = await request.json();
  const taskId = String(payload.taskId || "");
  const key = String(payload.key || "");
  validateObjectKey(key, taskId, user.id);
  await authorizeTask(env, user, taskId);
  const rows = await dbGet(env, user, "task_attachments", { select: "id", path: "eq." + key, limit: "1" });
  if (rows.length) return fail(request, env, "File sudah terdaftar; penghapusan melalui endpoint ini ditolak.", 409);
  await env.FILES_BUCKET.delete(key);
  return json(request, env, { ok: true });
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function signTicket(payload, secret) {
  const payloadPart = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart)));
  return payloadPart + "." + toBase64Url(signature);
}
async function verifyTicket(ticket, secret) {
  if (!ticket || ticket.length > 4096 || !ticket.includes(".")) throw new Error("Tautan unduhan tidak valid.");
  const [payloadPart, signaturePart] = ticket.split(".");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(signaturePart), new TextEncoder().encode(payloadPart));
  if (!valid) throw new Error("Tautan unduhan tidak valid.");
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadPart)));
  if (!payload.key || !payload.expiresAt || Date.now() > payload.expiresAt) throw new Error("Tautan unduhan sudah kedaluwarsa. Minta tautan baru.");
  return payload;
}
async function handleDownloadTicket(request, env, user) {
  if (!env.DOWNLOAD_SIGNING_SECRET || env.DOWNLOAD_SIGNING_SECRET.length < 32) {
    throw new Error("Secret tiket unduhan Worker belum diatur.");
  }
  const payload = await request.json();
  const key = String(payload.key || "");
  const taskId = key.split("/")[0] || "";
  await authorizeTask(env, user, taskId);
  const rows = await dbGet(env, user, "task_attachments", {
    select: "id,task_id,path,file_name,content_type,size_bytes",
    path: "eq." + key,
    limit: "1"
  });
  const row = rows[0];
  if (!row || row.task_id !== taskId) throw new Error("Lampiran tidak terdaftar atau tidak dapat diakses.");
  const object = await env.FILES_BUCKET.head(key);
  if (!object) return fail(request, env, "File tidak ditemukan di penyimpanan.", 404);
  const ticket = await signTicket({ key, filename: row.file_name, expiresAt: Date.now() + 60 * 1000 }, env.DOWNLOAD_SIGNING_SECRET);
  return json(request, env, { url: new URL("/download?ticket=" + encodeURIComponent(ticket), new URL(request.url).origin).toString(), expiresInSeconds: 60 });
}
async function handleTicketDownload(request, env) {
  if (!env.DOWNLOAD_SIGNING_SECRET || env.DOWNLOAD_SIGNING_SECRET.length < 32) {
    return new Response("Konfigurasi ticket download belum lengkap.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const ticket = new URL(request.url).searchParams.get("ticket") || "";
  let payload;
  try {
    payload = await verifyTicket(ticket, env.DOWNLOAD_SIGNING_SECRET);
  } catch (error) {
    return new Response(String(error.message || "Tautan unduhan tidak valid."), { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const object = await env.FILES_BUCKET.get(payload.key);
  if (!object) return new Response("File tidak ditemukan.", { status: 404, headers: { "Cache-Control": "no-store" } });
  const filename = String(payload.filename || "download").replace(/[\r\n"]/g, "_");
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": "attachment; filename=\"" + filename + "\"; filename*=UTF-8''" + encodeURIComponent(filename),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
    const url = new URL(request.url);
    const ticketDownload = request.method === "GET" && url.pathname === "/download" && url.searchParams.has("ticket");
    if (request.method === "OPTIONS") {
      if (!allowed.includes(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(request, env) });
    }
    if (ticketDownload) {
      if (origin && !allowed.includes(origin)) return new Response("Origin tidak diizinkan.", { status: 403 });
      return handleTicketDownload(request, env);
    }
    if (!allowed.includes(origin)) return new Response("Origin tidak diizinkan.", { status: 403 });
    if (request.method === "GET" && url.pathname === "/health") {
      return json(request, env, { ok: true, service: "ruang-kerja-file-api", maxParts: MAX_PARTS, partSize: PART_SIZE });
    }
    try {
      const user = await authenticated(request, env);
      if (request.method === "POST" && url.pathname === "/upload/init") return await handleUploadInit(request, env, user);
      if (request.method === "POST" && url.pathname === "/upload/part") return await handleUploadPart(request, env, user);
      if (request.method === "POST" && url.pathname === "/upload/complete") return await handleUploadComplete(request, env, user);
      if (request.method === "POST" && url.pathname === "/upload/abort") return await handleUploadAbort(request, env, user);
      if (request.method === "POST" && url.pathname === "/object/delete") return await handleObjectDelete(request, env, user);
      if (request.method === "POST" && url.pathname === "/download-ticket") return await handleDownloadTicket(request, env, user);
      return fail(request, env, "Endpoint tidak ditemukan.", 404);
    } catch (error) {
      const message = String(error && error.message || "Permintaan gagal.");
      const status = /login|sesi|izin|anggota tim|akses|diizinkan|akun lain/i.test(message) ? 403 : 400;
      return fail(request, env, message, status);
    }
  }
};
