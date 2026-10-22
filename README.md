# RUANG KERJA — portal pekerjaan pribadi

Portal responsif untuk koordinasi tim: tugas dengan tanggal/jam deadline dan status Aktif/Terlambat, tombol Sudah beres, alur approval/revisi sampai Done, beberapa lampiran file pekerjaan dan file contoh opsional, panel Content dengan beberapa file dalam satu item, Copy caption, format Reels/Feed/Carousel, hapus file, riwayat aktivitas, backup terenkripsi, serta notifikasi Telegram melalui Supabase Edge Function.

## Status project

- Project Supabase `ruang-kerja-rey` sudah dibuat.
- Database, aturan akses, dan bucket privat `ruang-kerja-files` sudah diterapkan.
- `config.js` sudah diisi Project URL dan public publishable key.
- Website sudah live melalui GitHub Pages: https://reybyoo-maker.github.io/WEBSITE-PERSONAL/.

## Privasi dan keamanan

- File disimpan di **private Supabase Storage bucket**; tidak memakai layanan storage terpisah atau Worker tambahan.
- RLS membatasi upload, download, dan akses lampiran berdasarkan akun serta tugas yang terkait. Download aplikasi menggunakan signed URL berumur 60 detik.
- Jangan commit file kerja, password, kode undangan, API key rahasia, atau backup ke GitHub.
- Hosting gratis GitHub Pages di akun GitHub Free mengharuskan repository ini **Public**, sehingga source code dapat dilihat siapa saja. Jangan simpan dokumen kerja, password, kode undangan mentah, API secret, atau backup di repository. File kerja hanya boleh diakses melalui Supabase Storage privat dan kebijakan RLS.
- Jangan menyimpan dokumen rahasia negara/berklasifikasi atau dokumen yang dibatasi kebijakan instansi di layanan cloud umum tanpa persetujuan resmi. Sistem ini tidak tersertifikasi untuk penyimpanan dokumen berklasifikasi.

## Batas file paket gratis

Untuk Supabase Free, dokumentasi saat ini mencantumkan **1 GB total file storage** dan **maksimal 50 MB per file**. Batas upload global dan bucket pada project ini disetel 50 MiB. Penggunaan egress juga mempunyai kuota; periksa dashboard pemakaian supaya tidak terkena pembatasan.

Referensi resmi:
- https://supabase.com/pricing
- https://supabase.com/docs/guides/storage/uploads/file-limits
- https://supabase.com/docs/guides/storage/buckets/fundamentals

Jika butuh lampiran lebih besar dari 50 MB, kompres atau pecah dokumen jika sesuai. Jangan menaikkan limit atau mengaktifkan plan berbayar tanpa memahami biaya.

## Jalankan website

### 1. Supabase (project ini sudah dikonfigurasi)

Database dan bucket privat sudah dibuat melalui migrasi. **Jangan jalankan ulang `supabase/schema.sql` di project yang sudah aktif ini**, karena file tersebut untuk instalasi baru. Project ini menggunakan `https://edgzffkhjtzejxjbtqib.supabase.co`; jangan pernah menaruh service-role/secret key ke browser.

Pastikan Authentication → Providers → **Anonymous Sign-Ins** aktif karena portal memakai kode akses tanpa email/password. Email provider tidak diperlukan untuk login portal ini. URL website tetap dapat dimasukkan pada Authentication → URL Configuration → Site URL.

### 2. Terbitkan antarmuka gratis lewat GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` akan build website dan deploy hasil `dist/` secara otomatis.

1. Buka https://github.com/reybyoo-maker/WEBSITE-PERSONAL/settings/pages.
2. Di **Build and deployment → Source**, pilih **GitHub Actions**.
3. Tunggu workflow **Deploy Ruang Kerja to GitHub Pages** selesai sukses di tab Actions.
4. URL project yang diharapkan: `https://reybyoo-maker.github.io/WEBSITE-PERSONAL/`.
5. Di Supabase → Authentication → URL Configuration, atur **Site URL** ke URL di atas, dan tambahkan URL yang sama di **Redirect URLs**.

GitHub Pages gratis untuk repository publik dan tidak membutuhkan kartu/billing untuk hosting standar. Source code terlihat publik, jadi jangan commit file kerja atau secret. Tidak diperlukan bucket eksternal, Cloudflare Worker, atau secret upload terpisah.

### 3. Login kode permanen (tanpa email)

Halaman login hanya meminta satu kode akses yang dapat digunakan berulang kali. Kode mentah tidak disimpan pada repository atau browser bundle; database menyimpan hash-nya di skema privat. Semua pengguna dengan kode valid mendapat role dan hak akses yang sama, termasuk tugas, approval, riwayat aktivitas, dan lampiran.

Untuk mengaktifkan login tanpa email, buka Supabase → Authentication → Providers (atau Sign In / Providers) → aktifkan **Anonymous Sign-Ins**. Login anonim hanya membuat sesi sementara; pengguna tetap tidak memiliki akses data sampai kode permanen diverifikasi oleh fungsi database. Jangan bagikan kode lewat kanal publik. Jika kode bocor, siapa pun yang memilikinya dapat masuk dengan hak akses penuh.

### 4. Uji sebelum dipakai

Gunakan akun dummy dan file non-rahasia. Pastikan:
- login memakai kode permanen berhasil berulang kali;
- pengguna yang memakai kode memiliki hak yang sama untuk tugas dan approval;
- tugas sebelum deadline menampilkan status Aktif, dan tugas yang lewat deadline ditandai Terlambat;
- klik Sudah beres pada tugas atau content membuatnya muncul di panel Approval & revisi;
- keputusan Approval mengubah status item menjadi Done, sedangkan Revisi menyimpan deskripsi perubahan;
- tugas menerima beberapa file pekerjaan dan file contoh opsional; file/content dapat dihapus;
- panel Content mendukung beberapa lampiran, Copy caption, pilihan Reels/Feed/Carousel, tanggal/jam, dan approval;
- semua pemegang kode bisa mengunduh content dan lampiran tim;
- notifikasi Telegram masuk saat tugas/content baru dibuat atau status berubah setelah rahasia Telegram disetel;
- orang tanpa sesi yang sah tidak dapat membaca atau mengunduh file;
- backup terenkripsi dapat dibuat dan dipulihkan.

## Notifikasi Telegram

Edge Function `notify-telegram` sudah dibuat di Supabase. Agar notifikasi aktif, set dua rahasia ini pada project Supabase **Settings / Edge Functions → Secrets** (label halaman bisa berubah):

- `TELEGRAM_BOT_TOKEN` — token bot yang dibuat melalui Telegram `@BotFather`.
- `TELEGRAM_CHAT_ID` — ID chat pribadi atau grup tujuan notifikasi.

Langkah singkat:
1. Di Telegram, chat `@BotFather`, gunakan `/newbot`, lalu simpan token yang diberikannya secara privat.
2. Buka chat dengan bot baru itu dan kirim `/start`. Untuk notifikasi grup, tambahkan bot ke grup lalu kirim pesan di grup.
3. Ambil `chat.id` dengan membuka `https://api.telegram.org/bot<TOKEN_ANDA>/getUpdates` di browser privat. Jangan membagikan URL itu karena berisi token. Untuk grup, ID biasanya negatif.
4. Di Supabase Dashboard project `ruang-kerja-rey`, buka halaman Edge Function Secrets dan tambahkan kedua nama secret beserta nilainya. Jangan masukkan token ke `app.js`, `config.js`, atau repository GitHub.
5. Sesudah tersimpan, buat sebuah tugas uji atau upload content uji. Notifikasi berisi nama item, status, detail, dan waktu WIB.

Notifikasi dipicu oleh pembuatan tugas/content, perubahan status, upload lampiran tugas, serta pengiriman revisi/approval. Jika secret belum ada atau salah, aplikasi tetap menyimpan data; notifikasi tidak terkirim sampai rahasia diperbaiki. Dokumentasi resmi: [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets).

## Backup

Menu Arsip & File menyediakan backup terenkripsi browser `.rkbak`. Saat ini backup dibatasi supaya tidak menggunakan memori browser berlebihan. Simpan salinan backup dengan password yang kuat di lokasi privat terpisah, dan uji pemulihan berkala. Cloud storage bukan satu-satunya backup.

## Struktur

- `index.html`, `styles.css`, `app.js`: antarmuka dan logika frontend.
- `config.js`: Supabase URL dan public publishable key.
- `supabase/schema.sql`: schema untuk instalasi baru, tabel, RLS, bucket privat.
- `supabase/migrations/`: migrasi perubahan database, termasuk `20261022_add_deadline_time_and_content_panel.sql`.
- `scripts/build.mjs`: hanya menyalin aset website ke `dist/`.
- `.github/workflows/check.yml`: tes syntax/build dan memastikan SQL backend tidak masuk output publik.
