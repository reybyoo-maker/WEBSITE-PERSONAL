# Instagram Engagement Report — public web lookup

The Edge Function accepts a public Instagram post URL and inspects only HTML pages that are publicly accessible without signing in:
- the normal public post webpage;
- the publicly accessible embedded post webpage.

It extracts the cover image, like/comment counts, caption, and timestamp only when those values exist in the returned public-page metadata. It does not call Instagram's internal media API or use an Instagram login/session. If public metadata omits a field, that field remains blank rather than being guessed.

## Deploy updated function

The website GitHub Pages deployment does not deploy Supabase Edge Functions. Deploy this function separately whenever its implementation changes.

1. Open the [Supabase Edge Function dashboard](https://supabase.com/dashboard/project/edgzffkhjtzejxjbtqib/functions).
2. Select `instagram-engagement-report`.
3. Open its code editor and replace the entire `index.ts` with the current [source file](https://raw.githubusercontent.com/reybyoo-maker/WEBSITE-PERSONAL/main/supabase/functions/instagram-engagement-report/index.ts).
4. Click **Deploy updates**.
5. In the website's Instagram Report panel, add or refresh a public post URL and check the row's status and note.

## Important limitations

- Public-page parsing depends on what the webpage returns at lookup time; Instagram can block anonymous page requests or omit engagement counts.
- Likes, comments, and cover images may be available if present in page metadata. Public webpages generally do not expose reliable share and repost totals, so those fields can remain blank and should not be guessed.
- For reliable, authorized Insights data, use the official Instagram Graph API for eligible professional accounts and media the connected account is permitted to access.
- The dashboard currently stores its table in that browser's local storage; rows do not synchronize across devices.
- Never put a Supabase service-role key in the browser.
