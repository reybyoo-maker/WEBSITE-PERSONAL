# RUANG KERJA — portal pekerjaan pribadi

Portal responsif sederhana untuk dua orang: dashboard, tugas, deadline, prioritas, komentar, approval/revisi, lampiran non-rahasia, riwayat aktivitas, dan backup terenkripsi.

## Keamanan dulu

Repository saat ini bersifat **PUBLIC**. Isinya hanya source code dan schema, bukan data tugas, file user, password, Supabase secret key, atau kode undangan dalam bentuk mentah. Kamu bisa mengubahnya menjadi Private melalui Settings → General → Danger Zone. Jangan commit dokumen kerja atau file rahasia ke repo.

**Jangan gunakan portal ini untuk menyimpan dokumen rahasia negara/berklasifikasi.** Situs ini memakai layanan cloud umum dan belum disertifikasi atau diotorisasi oleh instansi. Gunakan hanya untuk data kerja yang diizinkan; dokumen berklasifikasi tetap di sistem resmi instansi. Tidak ada aplikasi yang dapat menjamin risiko kebocoran atau kehilangan data menjadi nol.

Supabase anon/publishable key memang berada di frontend; keamanannya bergantung pada Row Level Security. Jangan pernah memasukkan service_role atau secret key ke config.js.

## Fitur

- Panel sesuai peran: Anggota dan Manager.
- Buat tugas, deadline, PIC, prioritas, dan deskripsi.
- Alur status: Belum dimulai → Sedang dikerjakan → Menunggu approval → Disetujui / Perlu revisi → Selesai.
- Catatan revisi, komentar per tugas, riwayat aktivitas.
- Bucket lampiran privat, unduh melalui autentikasi, maksimal 20 MB per file.
- Manager bisa membuat backup arsip .rkbak terenkripsi AES-GCM di browser dan memulihkan data yang belum ada. Password backup minimal 16 karakter dan tidak dikirim ke database.
- Antarmuka responsif untuk HP, tablet, laptop, dan desktop.

## Deploy gratis: Cloudflare Pages + Supabase

GitHub Pages tidak digunakan untuk deploy portal login ini. Cloudflare Pages akan menerbitkan hanya file antarmuka di folder dist/; file schema dan README tidak ikut dipublikasikan oleh build.

### A. Supabase — database, akun, dan file privat

1. Buat project di https://supabase.com/ dan simpan informasi login project dengan aman.
2. Di Supabase → SQL Editor, jalankan seluruh isi supabase/schema.sql satu kali.
3. Di Project Settings → API, salin Project URL dan public anon/publishable key ke config.js. Jangan gunakan service role/secret key.
4. Pastikan metode Auth Email/Password aktif.
5. Setelah situs Cloudflare terbit, buka Authentication → URL Configuration. Atur Site URL ke URL Cloudflare Pages yang sebenarnya (contoh format https://nama-proyek.pages.dev) dan tambahkan URL yang sama ke Redirect URLs.
6. Schema menanam dua undangan satu kali pakai dalam bentuk hash. Undangan mentah tidak disimpan di repository. Berikan kode Anggota dan Manager secara pribadi dari percakapan ini, jangan taruh dalam README/issues/commit.
7. Saat daftar, pastikan alamat email benar. Undangan dipakai ketika pendaftaran dikirim dan tidak bisa dipakai kembali. Jika konfirmasi email aktif, konfirmasi inbox dulu sebelum login.

### B. Cloudflare Pages — hosting antarmuka

1. Buka https://dash.cloudflare.com/ dan masuk/buat akun.
2. Masuk Workers & Pages → Create → Pages → Connect to Git.
3. Pilih repository reybyoo-maker/WEBSITE-PERSONAL dan branch main.
4. Build command: npm run build
5. Build output directory: dist
6. Deploy. Buka URL *.pages.dev hasil deployment.

Build workflow di GitHub Actions hanya mengecek syntax JavaScript; deploy situs dilakukan dari dashboard Cloudflare Pages. Bila mengubah config.js, push ke main akan menjalankan build Pages bila Git integration aktif.

## Backup dan pemulihan

Di menu Arsip & File, manager dapat memilih Backup terenkripsi untuk mengunduh data tugas, komentar, riwayat, metadata dan isi lampiran sebagai berkas .rkbak. Data dienkripsi di browser memakai AES-GCM dengan kunci turunan PBKDF2. Password backup tidak bisa dipulihkan oleh aplikasi jika hilang.

Pilih password unik minimal 16 karakter; simpan terpisah dari salinan backup. Buat backup berkala, simpan setidaknya dua salinan terenkripsi di lokasi berbeda yang diizinkan, dan uji pemulihan dengan data dummy. Fitur pemulihan dirancang untuk menambahkan data yang belum ada dan tidak menimpa data saat ini, tetapi belum diuji pada project Supabase milikmu — uji dulu sebelum mengandalkannya.

Supabase Free tidak menyediakan backup database otomatis dan project dapat dijeda setelah tujuh hari tidak aktif. Karena itu, backup .rkbak berkala itu penting. Rujukan resmi: https://supabase.com/docs/guides/platform/free-project-pausing dan https://supabase.com/docs/guides/platform/backups.

## Struktur penting

- index.html, styles.css, app.js: UI dan logic frontend.
- config.js: Supabase URL dan public key placeholder.
- supabase/schema.sql: tabel, invitation flow, RLS, private storage policies.
- scripts/build.mjs: salin hanya asset UI ke dist/.
- .github/workflows/check.yml: pemeriksaan syntax, bukan deploy.

## Status

Source code telah dimasukkan ke repository, dan syntax JavaScript lolos pemeriksaan. Portal **belum live dan belum terkoneksi database** sampai project Supabase dibuat/dihubungkan, schema dijalankan, config.js diisi dengan Project URL/public key milikmu, dan project Cloudflare Pages dibuat. Ini bukan sistem yang tersertifikasi untuk menangani rahasia negara.
