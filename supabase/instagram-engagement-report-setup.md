# Instagram Engagement Report — post-link lookup

This Edge Function accepts a public Instagram post URL and tries, in order, to:
- read the media response from Instagram's public web endpoint;
- inspect the normal post page and legacy JSON-style page;
- extract the thumbnail and any like/comment counts included in public metadata;
- return a partial result with a clear note rather than failing the entire table when Instagram does not expose metrics.

## Deploy updated function

The website GitHub Pages deployment does not deploy Supabase Edge Functions. Deploy this function separately whenever this file's implementation changes.

1. Open the [Supabase Edge Function dashboard](https://supabase.com/dashboard/project/edgzffkhjtzejxjbtqib/functions).
2. Select `instagram-engagement-report`.
3. Open its code editor and replace the entire `index.ts` with the current [source file](https://raw.githubusercontent.com/reybyoo-maker/WEBSITE-PERSONAL/main/supabase/functions/instagram-engagement-report/index.ts).
4. Click **Deploy updates**.
5. In the website's Instagram Report panel, add or refresh a public post URL and check the row's status and note.

## Important limitations

- No Meta access token is needed for this public-page fallback, but it uses undocumented Instagram web endpoints and is not guaranteed to work consistently.
- Instagram may block anonymous requests or omit likes/comments; shares and reposts often are not exposed in public HTML. A cover or partial metrics may be returned without all counts.
- For reliable, authorized Insights data, use the official Instagram Graph API for eligible professional accounts and media the connected account is permitted to access.
- The dashboard currently stores its table in that browser's local storage; rows do not synchronize across devices.
- Never put a Supabase service-role key in the browser.
