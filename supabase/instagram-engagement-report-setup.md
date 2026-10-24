# Instagram Engagement Report — backend setup

Panel Ruang Kerja memanggil Supabase Edge Function `instagram-engagement-report` ketika menu Instagram dibuka. Token Meta tidak ditaruh di `app.js` atau `config.js`.

## 1. Siapkan akses Meta
- Gunakan Instagram Professional Account (Business/Creator), idealnya terhubung ke Facebook Page.
- Konfigurasikan aplikasi di Meta for Developers dan beri izin yang dibutuhkan untuk membaca media dan insights.
- Untuk metrik share/repost pada endpoint media, gunakan jalur API/izin yang mendukung field tersebut. Ketersediaan metrik dapat berbeda menurut jenis konten, login flow, dan izin app.

## 2. Tambahkan Supabase Edge Function Secrets
Di Supabase Dashboard project Ruang Kerja → Edge Functions → Secrets:
- `INSTAGRAM_ACCESS_TOKEN`: access token Meta dengan izin baca akun dan insights.
- `INSTAGRAM_ACCOUNT_ID`: ID akun Instagram Professional.
- `META_GRAPH_API_VERSION`: opsional; default `v26.0`.

Jangan simpan token di GitHub atau browser.

## 3. Deploy fungsi
Dari folder proyek yang memiliki Supabase CLI:
```bash
supabase functions deploy instagram-engagement-report --project-ref edgzffkhjtzejxjbtqib
```

Setelah fungsi ter-deploy dan secret tersedia, panel menarik 50 post terbaru saat dibuka dan saat tombol Sinkronkan sekarang ditekan. Nilai dibaca langsung dari Meta API, bukan input manual. Kode ini belum menyimpan snapshot historis harian.
