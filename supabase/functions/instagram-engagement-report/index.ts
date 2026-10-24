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

  // Only authenticated Ruang Kerja members can use the lookup endpoint.
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
  const { data: profile, error: profileError } = await supabase.from("profiles").select("id").eq("id", authData.user.id).maybeSingle();
  if (profileError || !profile) return json({ error: "Forbidden" }, 403);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: "Request body tidak valid." }, 400); }
  const username = String(payload.username || "").trim().replace(/^@+/, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) {
    return json({ error: "Username tidak valid. Masukkan username Instagram saja, tanpa URL atau spasi." }, 400);
  }

  // Public profile endpoint only. No Instagram password, cookie, OTP, or Meta token is requested or stored.
  const profileUrl = new URL("https://www.instagram.com/api/v1/users/web_profile_info/");
  profileUrl.searchParams.set("username", username);
  let response: Response;
  try {
    response = await fetch(profileUrl, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.instagram.com/",
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return json({ code: "instagram_public_fetch_failed", error: "Instagram tidak merespons permintaan data publik. Coba lagi nanti; tidak ada login atau token yang digunakan." }, 502);
  }
  if (response.status === 404) return json({ error: "Username tidak ditemukan atau profil tidak tersedia." }, 404);
  if (response.status === 429 || response.status === 403) {
    return json({ code: "instagram_rate_limited", error: "Instagram membatasi akses otomatis saat ini. Tunggu sebentar lalu coba lagi. Endpoint publik ini tidak selalu tersedia." }, 429);
  }
  if (!response.ok) {
    return json({ error: "Instagram belum memberikan data publik (HTTP " + response.status + "). Coba lagi nanti atau pastikan profilnya publik." }, 502);
  }
  let root: Record<string, unknown>;
  try { root = await response.json(); }
  catch { return json({ error: "Instagram tidak mengembalikan data profil publik yang bisa dibaca." }, 502); }
  const data = (root.data && typeof root.data === "object") ? root.data as Record<string, unknown> : root;
  const user = (data.user && typeof data.user === "object") ? data.user as Record<string, unknown> : null;
  if (!user) return json({ error: "Profil tidak bisa dibaca. Bisa jadi private, username salah, atau Instagram meminta login." }, 404);
  if (user.is_private === true) return json({ error: "Akun ini private. Panel hanya membaca data profil publik." }, 403);

  const timeline = (user.edge_owner_to_timeline_media && typeof user.edge_owner_to_timeline_media === "object")
    ? user.edge_owner_to_timeline_media as Record<string, unknown> : {};
  const edges = Array.isArray(timeline.edges) ? timeline.edges as Record<string, unknown>[] : [];
  const count = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const posts = edges.map((edge) => {
    const node = (edge.node && typeof edge.node === "object") ? edge.node as Record<string, unknown> : {};
    const captionEdge = (node.edge_media_to_caption && typeof node.edge_media_to_caption === "object")
      ? node.edge_media_to_caption as Record<string, unknown> : {};
    const captionEdges = Array.isArray(captionEdge.edges) ? captionEdge.edges as Record<string, unknown>[] : [];
    const captionNode = captionEdges[0] && typeof captionEdges[0].node === "object"
      ? captionEdges[0].node as Record<string, unknown> : {};
    const shortcode = String(node.shortcode || "");
    const likesObject = (node.edge_liked_by && typeof node.edge_liked_by === "object")
      ? node.edge_liked_by as Record<string, unknown>
      : (node.edge_liked_and_viewed_by && typeof node.edge_liked_and_viewed_by === "object")
        ? node.edge_liked_and_viewed_by as Record<string, unknown> : {};
    const commentsObject = (node.edge_media_to_comment && typeof node.edge_media_to_comment === "object")
      ? node.edge_media_to_comment as Record<string, unknown>
      : (node.edge_media_to_parent_comment && typeof node.edge_media_to_parent_comment === "object")
        ? node.edge_media_to_parent_comment as Record<string, unknown> : {};
    const typeName = String(node.__typename || "");
    return {
      id: String(node.id || shortcode),
      caption: String(captionNode.text || node.accessibility_caption || ""),
      media_type: typeName === "GraphVideo" ? "VIDEO" : typeName === "GraphSidecar" ? "CAROUSEL_ALBUM" : "IMAGE",
      media_product_type: node.is_video ? "REEL/VIDEO" : "POST",
      timestamp: node.taken_at_timestamp ? new Date(Number(node.taken_at_timestamp) * 1000).toISOString() : null,
      permalink: shortcode ? "https://www.instagram.com/p/" + encodeURIComponent(shortcode) + "/" : "",
      likes: count(likesObject.count),
      comments: count(commentsObject.count),
      shares: null,
      reposts: null,
    };
  });
  const totals = (key: "likes" | "comments") => ({
    total: posts.reduce((sum, post) => sum + (post[key] === null ? 0 : Number(post[key])), 0),
    available: posts.filter((post) => post[key] !== null).length,
  });
  const likes = totals("likes");
  const comments = totals("comments");
  return json({
    ok: true,
    source: "instagram_public_profile",
    account: {
      id: String(user.id || ""),
      username: String(user.username || username),
      followers_count: count((user.edge_followed_by as Record<string, unknown> | undefined)?.count),
      media_count: count(timeline.count),
    },
    posts,
    summary: {
      likes: likes.total, likes_available: likes.available,
      comments: comments.total, comments_available: comments.available,
      shares: 0, shares_available: 0,
      reposts: 0, reposts_available: 0,
      total_available_posts: count(timeline.count),
    },
    fetched_at: new Date().toISOString(),
    metric_note: "Like dan komentar dari data profil publik jika tersedia. Share/repost tidak ditampilkan karena bukan metrik publik yang bisa dibaca dari username saja.",
  });
});
