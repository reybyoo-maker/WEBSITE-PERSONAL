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

type MetaError = Error & { metaCode?: number };
type MediaRow = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  timestamp?: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
  shares_count?: number;
  reposts_count?: number;
};

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
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("id").eq("id", authData.user.id).maybeSingle();
  if (profileError || !profile) return json({ error: "Forbidden" }, 403);

  const accessToken = Deno.env.get("INSTAGRAM_ACCESS_TOKEN") || "";
  const instagramAccountId = Deno.env.get("INSTAGRAM_ACCOUNT_ID") || "";
  const apiVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v26.0";
  if (!/^v\d+\.\d+$/.test(apiVersion)) return json({ error: "META_GRAPH_API_VERSION harus berupa versi seperti v26.0." }, 500);
  if (!accessToken || !instagramAccountId) {
    return json({
      code: "instagram_not_configured",
      error: "Instagram belum dikonfigurasi. Tambahkan INSTAGRAM_ACCESS_TOKEN dan INSTAGRAM_ACCOUNT_ID pada Supabase Edge Function Secrets, lalu deploy ulang fungsi ini.",
    }, 503);
  }

  const graph = async (path: string, params: Record<string, string> = {}) => {
    const url = new URL("https://graph.facebook.com/" + apiVersion + "/" + path.replace(/^\/+/, ""));
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
    let payload: Record<string, unknown>;
    try { payload = await response.json(); }
    catch { throw new Error("Meta Graph API mengembalikan respons yang tidak bisa dibaca."); }
    const apiError = payload.error as Record<string, unknown> | undefined;
    if (!response.ok || apiError) {
      const err = new Error(String(apiError?.message || "Meta Graph API gagal (HTTP " + response.status + ").")) as MetaError;
      err.metaCode = Number(apiError?.code || 0);
      throw err;
    }
    return payload;
  };
  const count = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const insightValues = (payload: Record<string, unknown>) => {
    const data = Array.isArray(payload.data) ? payload.data as Record<string, unknown>[] : [];
    const out: Record<string, number | null> = {};
    for (const item of data) {
      const name = String(item.name || "");
      let value: unknown = item.total_value && typeof item.total_value === "object"
        ? (item.total_value as Record<string, unknown>).value
        : undefined;
      if (value === undefined && Array.isArray(item.values)) {
        const first = (item.values as Record<string, unknown>[])[0];
        value = first?.value;
      }
      if (name) out[name] = count(value);
    }
    return out;
  };
  const fallbackInsights = async (mediaId: string) => {
    try {
      return insightValues(await graph(mediaId + "/insights", { metric: "shares,reposts" }));
    } catch {
      const separate: Record<string, number | null> = {};
      for (const metric of ["shares", "reposts"]) {
        try {
          const one = insightValues(await graph(mediaId + "/insights", { metric }));
          if (metric in one) separate[metric] = one[metric];
        } catch { separate[metric] = null; }
      }
      return separate;
    }
  };

  try {
    let account: Record<string, unknown> = { id: instagramAccountId };
    try {
      account = await graph(encodeURIComponent(instagramAccountId), {
        fields: "id,username,media_count,followers_count",
      }) as Record<string, unknown>;
    } catch { /* Media metrics can still be returned if profile fields are unavailable. */ }

    const metricsFields = "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,shares_count,reposts_count";
    const basicFields = "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count";
    let mediaPayload: Record<string, unknown>;
    let mediaFieldsSupported = true;
    try {
      mediaPayload = await graph(encodeURIComponent(instagramAccountId) + "/media", { fields: metricsFields, limit: "50" });
    } catch (error) {
      const msg = String((error as Error).message || "");
      const code = Number((error as MetaError).metaCode || 0);
      if (code !== 100 && !/shares_count|reposts_count|field|nonexisting/i.test(msg)) throw error;
      mediaFieldsSupported = false;
      mediaPayload = await graph(encodeURIComponent(instagramAccountId) + "/media", { fields: basicFields, limit: "50" });
    }
    const media = Array.isArray(mediaPayload.data) ? mediaPayload.data as MediaRow[] : [];
    const posts = media.map((item) => ({
      id: String(item.id),
      caption: String(item.caption || ""),
      media_type: String(item.media_type || ""),
      media_product_type: String(item.media_product_type || ""),
      timestamp: item.timestamp || null,
      permalink: String(item.permalink || ""),
      likes: count(item.like_count),
      comments: count(item.comments_count),
      shares: mediaFieldsSupported ? count(item.shares_count) : null,
      reposts: mediaFieldsSupported ? count(item.reposts_count) : null,
    }));
    if (!mediaFieldsSupported) {
      for (let index = 0; index < posts.length; index += 4) {
        const batch = posts.slice(index, index + 4);
        const insights = await Promise.all(batch.map((post) => fallbackInsights(post.id)));
        for (let j = 0; j < batch.length; j++) {
          const postIndex = index + j;
          posts[postIndex].shares = insights[j].shares ?? posts[postIndex].shares;
          posts[postIndex].reposts = insights[j].reposts ?? posts[postIndex].reposts;
        }
      }
    }
    const total = (key: "likes" | "comments" | "shares" | "reposts") => ({
      value: posts.reduce((sum, item) => sum + (item[key] === null ? 0 : Number(item[key])), 0),
      available: posts.filter((item) => item[key] !== null).length,
    });
    const likes = total("likes"), comments = total("comments"), shares = total("shares"), reposts = total("reposts");
    return json({
      ok: true,
      account: {
        id: String(account.id || instagramAccountId),
        username: String(account.username || ""),
        followers_count: count(account.followers_count),
        media_count: count(account.media_count),
      },
      posts,
      summary: {
        likes: likes.value, likes_available: likes.available,
        comments: comments.value, comments_available: comments.available,
        shares: shares.value, shares_available: shares.available,
        reposts: reposts.value, reposts_available: reposts.available,
        total_available_posts: count(account.media_count),
      },
      fetched_at: new Date().toISOString(),
      metric_note: "Metrik yang tidak tersedia ditampilkan sebagai — pada level post.",
    });
  } catch (error) {
    const message = (error as Error).message || "Gagal mengambil data Instagram.";
    return json({ code: "instagram_graph_error", error: message.slice(0, 500) }, 502);
  }
});
