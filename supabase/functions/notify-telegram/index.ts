import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  const projectUrl = Deno.env.get("SUPABASE_URL") || "";
  const keyMapRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "";
  let publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!publishableKey && keyMapRaw) {
    try { publishableKey = JSON.parse(keyMapRaw).default || ""; } catch { /* invalid environment config */ }
  }
  if (!authorization || !projectUrl || !publishableKey) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(projectUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

  // A valid anonymous session is not enough: the permanent access code must have created a team profile.
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("id").eq("id", authData.user.id).maybeSingle();
  if (profileError || !profile) return json({ error: "Forbidden" }, 403);

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID") || "";
  if (!botToken || !chatId) {
    return json({ error: "Telegram belum dikonfigurasi. Tambahkan TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID di Supabase Edge Function Secrets." }, 503);
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const allowedEvents = new Set([
    "task_created", "task_status", "task_revision", "task_files_uploaded",
    "content_created", "content_status",
  ]);
  const eventType = String(payload.event_type || "");
  if (!allowedEvents.has(eventType)) return json({ error: "Unsupported event" }, 400);

  const eventLabels: Record<string, string> = {
    task_created: "TUGAS BARU",
    task_status: "STATUS TUGAS BERUBAH",
    task_revision: "TUGAS PERLU REVISI",
    task_files_uploaded: "LAMPIRAN TUGAS DIUNGGAH",
    content_created: "CONTENT BARU DIUNGGAH",
    content_status: "STATUS CONTENT BERUBAH",
  };
  const clean = (value: unknown, max: number) =>
    String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
  const title = clean(payload.title, 180) || "(tanpa judul)";
  const status = clean(payload.status, 80) || "Tidak diketahui";
  const details = clean(payload.details, 1200);
  const localTime = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short",
  }).format(new Date());
  const message = [
    "🔔 RUANG KERJA",
    eventLabels[eventType],
    "Judul: " + title,
    "Status: " + status,
    details ? "Info: " + details : "",
    "Waktu: " + localTime + " WIB",
  ].filter(Boolean).join("\n");

  const telegramResponse = await fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
  });
  if (!telegramResponse.ok) {
    let reason = "Telegram menolak pesan.";
    try {
      const telegramResult = await telegramResponse.json();
      reason = clean(telegramResult.description || reason, 200);
    } catch { /* use generic error */ }
    return json({ error: reason }, 502);
  }
  return json({ ok: true });
});
