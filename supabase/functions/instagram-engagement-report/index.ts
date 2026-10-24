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
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;|&#47;/g, "/")
    .replace(/\\u0026/g, "&").replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\\\n/g, " ");

  const readMeta = (html: string, key: string): string => {
    const tagPattern = new RegExp("<meta\\b(?=[^>]*(?:property|name)=[\\"']" + key + "[\\"'])[^>]*>", "i");
    const tag = html.match(tagPattern)?.[0];
    if (!tag) return "";
    const content = tag.match(/\bcontent=["']([^"']*)["']/i);
    return content ? escapeText(content[1]) : "";
  };

  const parseEmbeddedObjectAt = (source: string, searchAt: number): Record<string, unknown> | null => {
    if (searchAt < 0) return null;
    const start = source.indexOf("{", searchAt);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(source.slice(start, i + 1)) as Record<string, unknown>; }
          catch { return null; }
        }
      }
    }
    return null;
  };

  const metricFromDescription = (description: string, label: string): number | null => {
    if (!description) return null;
    const match = description.match(new RegExp("([\\d,.]+\\s*[KMB]?)\\s+" + label + "\\b", "i"));
    if (!match) return null;
    const token = match[1].replace(/[\s,]/g, "");
    const suffix = token.slice(-1).toUpperCase();
    const base = Number.parseFloat(/[KMB]$/i.test(token) ? token.slice(0, -1) : token);
    if (!Number.isFinite(base) || base < 0) return null;
    const multiplier = suffix === "K" ? 1000 : suffix === "M" ? 1000000 : suffix === "B" ? 1000000000 : 1;
    return Math.floor(base * multiplier);
  };

  let metaLikes: number | null = null;
  let metaComments: number | null = null;
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
      const queryUrl = new URL(canonicalUrl);
      queryUrl.searchParams.set("__a", "1");
      queryUrl.searchParams.set("__d", "dis");
      // Try the normal public page first, then the legacy JSON-style endpoint.
      for (const pageAddress of [canonicalUrl, queryUrl.toString()]) {
        if (item) break;
        try {
          const pageResponse = await safeFetch(pageAddress);
          if (!pageResponse.ok) {
            if ([401, 403, 429].includes(pageResponse.status)) blocked = true;
            continue;
          }
          const text = await pageResponse.text();
          coverImageUrl = readMeta(text, "og:image") || coverImageUrl;
          const description = readMeta(text, "og:description") || readMeta(text, "description");
          metaLikes = metricFromDescription(description, "likes?");
          metaComments = metricFromDescription(description, "comments?");

          // Instagram has served several embedded JSON shapes over time.
          const sharedDataAt = text.indexOf("window._sharedData");
          if (sharedDataAt >= 0) {
            const sharedRoot = parseEmbeddedObjectAt(text, sharedDataAt);
            if (sharedRoot) item = extractItem(sharedRoot);
          }
          if (!item) {
            const graphAt = text.indexOf('{"graphql"');
            if (graphAt >= 0) {
              const graphRoot = parseEmbeddedObjectAt(text, graphAt);
              if (graphRoot) item = extractItem(graphRoot);
            }
          }
          if (!item) {
            const mediaAt = text.indexOf('"shortcode_media"');
            if (mediaAt >= 0) {
              const mediaObject = parseEmbeddedObjectAt(text, mediaAt);
              if (mediaObject) item = { shortcode_media: mediaObject };
            }
          }
          if (!item) {
            const likesMatch = text.match(/"edge_media_preview_like"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
            const commentsMatch = text.match(/"edge_media_to_parent_comment"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
            const captionMatch = text.match(/"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"/);
            const regexLikes = likesMatch ? Number(likesMatch[1]) : null;
            const regexComments = commentsMatch ? Number(commentsMatch[1]) : null;
            if (regexLikes !== null || regexComments !== null || captionMatch) {
              item = {
                like_count: regexLikes,
                comment_count: regexComments,
                caption: { text: captionMatch ? escapeText(captionMatch[1]) : "" },
              };
            }
          }
        } catch (error) {
          console.warn("Instagram page parse attempt failed", {
            shortcode,
            endpoint: pageAddress === canonicalUrl ? "public_page" : "legacy_endpoint",
            message: (error as Error)?.message || "unknown",
          });
        }
      }
    }
    if (!item) {
      const note = blocked
        ? "Instagram membatasi akses publik. Cover atau sebagian angka mungkin tersedia, tetapi metrik lengkap tidak dapat dibaca."
        : (coverImageUrl || metaLikes !== null || metaComments !== null)
          ? "Data postingan hanya terbaca sebagian dari metadata publik. Share dan repost tidak tersedia dari respons ini."
          : "Instagram tidak memberikan metadata postingan yang bisa dibaca. Coba postingan publik lain; angka tetap bisa diisi manual.";
      return json({
        ok: true,
        source: "instagram_public_post",
        post: {
          id: shortcode, shortcode, url: canonicalUrl, caption: "",
          image_url: coverImageUrl,
          timestamp: null,
          likes: metaLikes, comments: metaComments, shares: null, reposts: null,
          fetched_at: new Date().toISOString(),
          note,
        },
      });
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
    const likes = count(item.like_count, item.likes, nestedCount(item, ["edge_media_preview_like", "edge_liked_by", "edge_liked_and_viewed_by"])) ?? metaLikes;
    const comments = count(item.comment_count, item.comments_count, nestedCount(item, ["edge_media_to_comment", "edge_media_to_parent_comment", "edge_media_preview_comment"])) ?? metaComments;
    const shares = count(item.share_count, item.shares_count, item.send_count);
    const reposts = count(item.repost_count, item.reposts_count, item.reshare_count);
    const unix = count(item.taken_at, item.taken_at_timestamp);
    if (likes === null && comments === null && shares === null && reposts === null) {
      return json({
        ok: true,
        source: "instagram_public_post",
        post: {
          id: String(item.pk || item.id || shortcode), shortcode, url: canonicalUrl,
          caption: captionText, image_url: coverImageUrl,
          timestamp: unix === null ? null : new Date(unix > 100000000000 ? unix : unix * 1000).toISOString(),
          likes, comments, shares, reposts,
          fetched_at: new Date().toISOString(),
          note: "Link dikenali, tetapi Instagram tidak membuka angka engagement untuk postingan ini. Cover tetap ditampilkan bila tersedia; angka bisa diisi manual.",
        },
      });
    }
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
