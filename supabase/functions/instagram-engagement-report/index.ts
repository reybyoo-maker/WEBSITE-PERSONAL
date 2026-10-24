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
    try { publishableKey = JSON.parse(keyMapRaw).default || ""; } catch { /* invalid configuration */ }
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
  const rawUrl = String(payload.post_url || payload.url || "").trim();
  let submittedUrl: URL;
  try { submittedUrl = new URL(rawUrl); }
  catch { return json({ error: "Masukkan link postingan Instagram yang valid." }, 400); }
  const host = submittedUrl.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (host !== "instagram.com") return json({ error: "Link harus berasal dari instagram.com." }, 400);
  const matched = submittedUrl.pathname.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?/i);
  if (!matched) return json({ error: "Link harus menuju postingan, Reel, atau IGTV." }, 400);
  const shortcode = matched[2];
  const mediaType = matched[1].toLowerCase() === "reels" ? "reel" : matched[1].toLowerCase();
  const canonicalUrl = "https://www.instagram.com/" + mediaType + "/" + encodeURIComponent(shortcode) + "/";

  const headers = {
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "X-IG-App-ID": "936619743392459",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": canonicalUrl,
  };
  const safeFetch = async (url: string) => await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  const extractItem = (root: Record<string, unknown>): Record<string, unknown> | null => {
    const objects: unknown[] = [
      root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>).items : null,
      root.items,
      root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>).shortcode_media : null,
      root.graphql && typeof root.graphql === "object" ? (root.graphql as Record<string, unknown>).shortcode_media : null,
      root.shortcode_media,
      root.media,
      root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>).media : null,
    ];
    for (const candidate of objects) {
      if (Array.isArray(candidate) && candidate[0] && typeof candidate[0] === "object") return candidate[0] as Record<string, unknown>;
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate as Record<string, unknown>;
    }
    return null;
  };
  const imageUrlFromItem = (item: Record<string, unknown>): string | null => {
    const directKeys = ["display_url", "thumbnail_src", "display_uri", "image_url", "thumbnail_url", "preview_url"];
    for (const key of directKeys) {
      const value = item[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }
    const imageVersions = item.image_versions2 && typeof item.image_versions2 === "object"
      ? item.image_versions2 as Record<string, unknown> : {};
    const candidates = Array.isArray(imageVersions.candidates) ? imageVersions.candidates
      .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === "object" && typeof candidate.url === "string"))
      .sort((a, b) => Number(b.width || 0) * Number(b.height || 0) - Number(a.width || 0) * Number(a.height || 0)) : [];
    if (candidates.length) return String(candidates[0].url);
    for (const key of ["display_resources", "thumbnail_resources"]) {
      const resources = item[key];
      if (Array.isArray(resources)) {
        const valid = resources.filter((resource): resource is Record<string, unknown> =>
          Boolean(resource && typeof resource === "object" && typeof (resource.src || resource.url) === "string"));
        if (valid.length) return String((valid[valid.length - 1].src || valid[valid.length - 1].url));
      }
    }
    const carousel = item.carousel_media;
    if (Array.isArray(carousel)) {
      const first = carousel.find((child) => child && typeof child === "object") as Record<string, unknown> | undefined;
      if (first) return imageUrlFromItem(first);
    }
    return null;
  };
  const count = (...values: unknown[]): number | null => {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  };
  const nestedCount = (item: Record<string, unknown>, keys: string[]): number | null => {
    for (const key of keys) {
      const value = item[key];
      if (value && typeof value === "object" && "count" in (value as Record<string, unknown>)) {
        const n = count((value as Record<string, unknown>).count);
        if (n !== null) return n;
      }
    }
    return null;
  };
  const escapeText = (value: string) => value
    .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\\u0026/g, "&")
    .replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\\\n/g, " ");

  try {
    let item: Record<string, unknown> | null = null;
    let coverImageUrl: string | null = null;
    let blocked = false;
    const detailUrl = new URL("https://www.instagram.com/api/v1/media/shortcode/");
    detailUrl.searchParams.set("shortcode", shortcode);
    try {
      const detailResponse = await safeFetch(detailUrl.toString());
      if (detailResponse.ok) {
        item = extractItem(await detailResponse.json() as Record<string, unknown>);
        if (item) coverImageUrl = imageUrlFromItem(item);
      }
      else if ([401, 403, 429].includes(detailResponse.status)) blocked = true;
    } catch { /* fallback to post page */ }

    if (!item) {
      const pageUrl = new URL(canonicalUrl);
      pageUrl.searchParams.set("__a", "1");
      pageUrl.searchParams.set("__d", "dis");
      try {
        const pageResponse = await safeFetch(pageUrl.toString());
        if (pageResponse.ok) {
          const text = await pageResponse.text();
          const ogMeta = text.match(/<meta\b[^>]*(?:property|name)=["']og:image["'][^>]*>/i);
          const ogContent = ogMeta ? ogMeta[0].match(/\bcontent=["']([^"']+)["']/i) : null;
          if (ogContent && ogContent[1]) {
            coverImageUrl = ogContent[1].replace(/&amp;/g, "&").replace(/&#x2F;/g, "/");
          }
          const jsonStart = text.indexOf('{"graphql"');
          if (jsonStart >= 0) {
            const jsonEnd = text.indexOf("</script>", jsonStart);
            const candidate = text.slice(jsonStart, jsonEnd > jsonStart ? jsonEnd : undefined);
            try { item = extractItem(JSON.parse(candidate) as Record<string, unknown>); } catch { /* try count extraction */ }
          }
          if (!item) {
            const likesMatch = text.match(/"edge_media_preview_like"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
            const commentsMatch = text.match(/"edge_media_to_parent_comment"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
            const captionMatch = text.match(/"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"/);
            if (likesMatch || commentsMatch || captionMatch) {
              item = {
                like_count: likesMatch ? Number(likesMatch[1]) : null,
                comment_count: commentsMatch ? Number(commentsMatch[1]) : null,
                caption: { text: captionMatch ? escapeText(captionMatch[1]) : "" },
              };
            }
          }
        } else if ([401, 403, 429].includes(pageResponse.status)) blocked = true;
      } catch { /* return a useful error below */ }
    }
    if (!item) {
      return json({
        code: blocked ? "instagram_public_access_limited" : "instagram_post_not_readable",
        error: blocked
          ? "Instagram membatasi pembacaan otomatis untuk saat ini. Kolom tabel tetap bisa diisi manual dan total engagement tetap dihitung."
          : "Metrik publik postingan tidak bisa dibaca saat ini. Cek link atau coba lagi; kolom tabel tetap bisa diisi manual.",
      }, blocked ? 429 : 502);
    }

    coverImageUrl = imageUrlFromItem(item) || coverImageUrl;
    const captionField = item.caption && typeof item.caption === "object" ? item.caption as Record<string, unknown> : {};
    const captionEdges = item.edge_media_to_caption && typeof item.edge_media_to_caption === "object"
      ? (item.edge_media_to_caption as Record<string, unknown>).edges : null;
    const firstCaptionNode = Array.isArray(captionEdges) && captionEdges[0] && typeof captionEdges[0] === "object"
      ? (captionEdges[0] as Record<string, unknown>).node : null;
    const captionText = typeof item.caption === "string" ? item.caption
      : String(captionField.text || (firstCaptionNode && typeof firstCaptionNode === "object"
        ? (firstCaptionNode as Record<string, unknown>).text || "" : ""));
    const likes = count(item.like_count, item.likes, nestedCount(item, ["edge_media_preview_like", "edge_liked_by", "edge_liked_and_viewed_by"]));
    const comments = count(item.comment_count, item.comments_count, nestedCount(item, ["edge_media_to_comment", "edge_media_to_parent_comment", "edge_media_preview_comment"]));
    const shares = count(item.share_count, item.shares_count, item.send_count);
    const reposts = count(item.repost_count, item.reposts_count, item.reshare_count);
    if (likes === null && comments === null && shares === null && reposts === null) {
      return json({
        code: "instagram_public_metrics_hidden",
        error: "Link berhasil dibaca tetapi Instagram tidak membuka angka engagement untuk postingan ini. Kamu bisa isi angka pada tabel secara manual.",
      }, 200);
    }
    const unix = count(item.taken_at, item.taken_at_timestamp);
    return json({
      ok: true,
      source: "instagram_public_post",
      post: {
        id: String(item.pk || item.id || shortcode),
        shortcode,
        url: canonicalUrl,
        caption: captionText,
        image_url: coverImageUrl,
        timestamp: unix === null ? null : new Date(unix > 100000000000 ? unix : unix * 1000).toISOString(),
        likes, comments, shares, reposts,
        fetched_at: new Date().toISOString(),
        note: "",
      },
    });
  } catch (error) {
    return json({ error: ((error as Error).message || "Gagal membaca postingan Instagram.").slice(0, 400) }, 502);
  }
});
