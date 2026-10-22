# RUANG KERJA — portal pekerjaan pribadi

Portal responsif untuk koordinasi kamu dan manager: dashboard, tugas, deadline, prioritas, komentar, approval/revisi, lampiran privat, riwayat aktivitas, dan backup terenkripsi.

## Status project

- Project Supabase `ruang-kerja-rey` sudah dibuat.
- Database, aturan akses, dan bucket privat `ruang-kerja-files` sudah diterapkan.
- `config.js` sudah diisi Project URL dan public publishable key.
- Source code tetap di GitHub. Website belum live sampai hosting frontend diterbitkan.

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

Pastikan Authentication → Providers → Email aktif. Setelah hosting aktif, tambahkan URL website ke Authentication → URL Configuration → Site URL dan Redirect URLs.

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
- login/logout bekerja;
- manager dapat membuat tugas dan melakukan approval;
- anggota hanya dapat mengubah status dalam alur yang diperbolehkan;
- file yang diunggah terlihat hanya untuk pengguna yang berhak pada tugas itu;
- akun tanpa akses gagal membaca atau mengunduh lampiran;
- backup terenkripsi dapat dibuat dan dipulihkan.

## Backup

Menu Arsip & File menyediakan backup terenkripsi browser `.rkbak`. Saat ini backup dibatasi supaya tidak menggunakan memori browser berlebihan. Simpan salinan backup dengan password yang kuat di lokasi privat terpisah, dan uji pemulihan berkala. Cloud storage bukan satu-satunya backup.

## Struktur

- `index.html`, `styles.css`, `app.js`: antarmuka dan logika frontend.
- `config.js`: Supabase URL dan public publishable key.
- `supabase/schema.sql`: schema untuk instalasi baru, tabel, RLS, bucket privat.
- `supabase/migrations/`: migrasi perubahan database.
- `scripts/build.mjs`: hanya menyalin aset website ke `dist/`.
- `.github/workflows/check.yml`: tes syntax/build dan memastikan SQL backend tidak masuk output publik.
