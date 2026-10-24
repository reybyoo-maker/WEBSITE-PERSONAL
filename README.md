# RUANG KERJA — portal pekerjaan pribadi

Portal responsif untuk koordinasi tim: tugas dan deadline, approval/revisi, lampiran terpisah untuk Lampiran File, Contoh, dan Hasil Sudah Dikerjakan, panel Content, schedule visit offline, backup terenkripsi, notifikasi Telegram, penyimpanan privat Supabase Storage, serta penghapusan file otomatis setelah 14 hari.

## Status project

- Project Supabase `ruang-kerja-rey` sudah dibuat.
- Database, aturan akses, dan bucket privat Supabase `ruang-kerja-files` sudah tersedia untuk file baru maupun lama.
- Upload baru memakai bucket privat Supabase Storage; Google OAuth dan Google Cloud tidak diperlukan untuk menyimpan file.
- Supabase Cron aktif harian untuk menghapus file dan metadata setelah 14 hari. Endpoint cleanup sudah diuji dan memberi respons `200 OK`.
- Website sudah live melalui GitHub Pages: https://reybyoo-maker.github.io/WEBSITE-PERSONAL/.

## Privasi dan keamanan

- File baru dan file lama disimpan di bucket privat `ruang-kerja-files` milik Supabase Storage; file tidak dibuat publik.
- Metadata dilindungi oleh aturan akses (RLS), dan kedua kode akses tetap menggunakan workspace yang sama.
- Penghapusan manual menghapus objek storage sekaligus metadata sehingga kapasitas dapat digunakan kembali. File yang sudah mencapai usia 14 hari dibersihkan oleh Supabase Cron harian.
- Jangan commit file kerja, password, kode undangan, token, atau backup ke GitHub.
- Hosting GitHub Pages memakai repository **Public**, sehingga source code dapat dilihat siapa saja. Rahasia server tetap disimpan di Supabase Vault/Edge Function Secrets.
- Jangan menyimpan dokumen rahasia/berklasifikasi atau dokumen yang dilarang kebijakan instansi di layanan cloud umum tanpa persetujuan resmi.

## Kapasitas dan retensi file

Portal memecah file menjadi potongan masing-masing **20 MiB**, sehingga batas aplikasi adalah **800 MiB per file** dan saat diunduh potongan disatukan kembali. Bucket privat pada paket gratis Supabase memiliki kuota total **1 GB** dan batas **50 MB per objek**; potongan 20 MiB berada di bawah batas objek, tetapi total file yang masih tersimpan tetap dibatasi oleh kuota project.

Supabase Cron berjalan setiap hari sekitar pukul 10.17 WIB dan menghapus file serta metadata yang usianya sudah 14 hari atau lebih. Penghapusan manual langsung membuang objek dari Storage agar ruang bisa dipakai kembali. Backup-kan file penting di tempat terpisah sebelum usia retensi habis.

Dokumentasi: [Batas file Supabase Storage](https://supabase.com/docs/guides/storage/uploads/file-limits) · [Menghapus objek](https://supabase.com/docs/guides/storage/management/delete-objects) · [Supabase Cron](https://supabase.com/docs/guides/cron)

## Perubahan skema lampiran hasil

Untuk database yang sudah aktif, jalankan `supabase/migrations/20261024_add_result_attachment_type.sql` satu kali melalui Supabase SQL Editor sebelum mengunggah file kategori **Hasil Sudah Dikerjakan**. Migration ini hanya memperluas tipe lampiran yang diizinkan; lampiran lama tetap dipertahankan.

## Jalankan website

### 1. Supabase (project ini sudah dikonfigurasi)

Database, aturan akses, dan bucket privat `ruang-kerja-files` sudah dikonfigurasi. **Jangan jalankan ulang `supabase/schema.sql` di project yang sudah aktif ini**, karena file tersebut untuk instalasi baru. Project ini menggunakan `https://edgzffkhjtzejxjbtqib.supabase.co`; jangan pernah menaruh service-role/secret key atau token backend ke browser.

Pastikan Authentication → Providers → **Anonymous Sign-Ins** aktif karena portal memakai kode akses tanpa email/password. Email provider tidak diperlukan untuk login portal ini. URL website tetap dapat dimasukkan pada Authentication → URL Configuration → Site URL.

### 2. Terbitkan antarmuka gratis lewat GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` akan build website dan deploy hasil `dist/` secara otomatis.

1. Buka https://github.com/reybyoo-maker/WEBSITE-PERSONAL/settings/pages.
2. Di **Build and deployment → Source**, pilih **GitHub Actions**.
3. Tunggu workflow **Deploy Ruang Kerja to GitHub Pages** selesai sukses di tab Actions.
4. URL project yang diharapkan: `https://reybyoo-maker.github.io/WEBSITE-PERSONAL/`.
5. Di Supabase → Authentication → URL Configuration, atur **Site URL** ke URL di atas, dan tambahkan URL yang sama di **Redirect URLs**.

GitHub Pages gratis untuk repository publik dan tidak membutuhkan kartu/billing untuk hosting standar. Source code terlihat publik, jadi jangan commit file kerja atau secret. Penyimpanan file ditangani oleh bucket privat Supabase Storage.

### 3. Login kode permanen (tanpa email)

Halaman login menerima salah satu dari dua kode akses permanen yang terdaftar di database privat. Keduanya membuka workspace yang sama dengan hak akses sama: **Kode 1 berwarna merah** dan **Kode 2 berwarna pink**. Sidebar dan daftar PIC menggunakan label kode, tanpa meminta atau menampilkan nama pribadi. Kode mentah tidak disimpan pada repository atau browser bundle; database hanya menyimpan hash. Jangan commit atau bagikan kode akses melalui kanal publik. Jika kode bocor, siapa pun yang memilikinya dapat masuk dengan hak akses penuh.

Untuk mengaktifkan login tanpa email, buka Supabase → Authentication → Providers (atau Sign In / Providers) → aktifkan **Anonymous Sign-Ins**. Login anonim hanya membuat sesi sementara; pengguna tetap tidak memiliki akses data sampai kode permanen diverifikasi oleh fungsi database.

### 4. Uji sebelum dipakai

Gunakan akun dummy dan file non-rahasia. Pastikan:
- login memakai kode permanen berhasil berulang kali;
- pengguna yang memakai kode memiliki hak yang sama untuk tugas dan approval;
- tugas sebelum deadline menampilkan status Aktif, dan tugas yang lewat deadline ditandai Terlambat;
- klik Sudah beres pada tugas atau content membuatnya muncul di panel Approval & revisi;
- keputusan Approval mengubah status item menjadi Done, sedangkan Revisi menyimpan deskripsi perubahan;
- tugas menerima file terpisah untuk Lampiran File, Contoh, dan Hasil Sudah Dikerjakan; pilih file satu per satu pada tiap kategori, lalu kolom berikutnya muncul otomatis;
- lampiran dipecah menjadi bagian privat 20 MiB, bisa diunduh kembali, dan metadata file baru menunjukkan `storage_provider = supabase`;
- tombol Hapus menghapus objek dari Supabase Storage serta metadata terkait;
- panel Content mendukung beberapa lampiran, Copy caption, pilihan Reels/Feed/Carousel, tanggal/jam, dan approval;
- Kode 1 tampil merah dan Kode 2 tampil pink; keduanya bisa melihat, mengedit, menghapus tugas dan schedule yang sama;
- panel Visit offline bisa membuat, mengedit, menghapus, dan mengganti status Fix / Masih rencana / Batal;
- semua pemegang kode bisa mengunduh content dan lampiran tim;
- notifikasi Telegram masuk saat tugas/content baru dibuat atau status berubah setelah rahasia Telegram disetel;
- orang tanpa sesi yang sah tidak dapat membaca atau mengunduh file;
- backup terenkripsi dapat dibuat dan dipulihkan.

## Penyimpanan dan retensi otomatis

Penyimpanan file sudah diarahkan ke bucket privat Supabase Storage yang tersedia pada project. **Tidak perlu membuat project Google Cloud, Client ID, OAuth consent screen, atau menyambungkan Google Drive.**

Supabase Cron sudah dikonfigurasi langsung di database dan diuji. Pembersihan berjalan setiap hari sekitar pukul 10.17 WIB; file yang sudah berusia 14 hari atau lebih beserta metadata-nya dihapus otomatis. Jika file dihapus manual dari portal, objek Storage-nya juga dihapus sehingga ruang dapat dipakai kembali.

Pada paket gratis, kuota storage total adalah 1 GB dan batas setiap objek adalah 50 MB. Aplikasi memecah berkas menjadi bagian 20 MiB untuk mendukung berkas besar, tetapi seluruh bagian tetap menggunakan kuota 1 GB project. Penghapusan otomatis berjalan setelah 14 hari; tidak ada penyimpanan tanpa batas.

Dokumentasi: [Supabase Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits) · [Delete Storage objects](https://supabase.com/docs/guides/storage/management/delete-objects) · [Supabase Cron](https://supabase.com/docs/guides/cron)

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

Notifikasi dipicu oleh pembuatan tugas/content, perubahan status, upload lampiran tugas, pengiriman revisi/approval, serta pembuatan, pengubahan, pembatalan, atau penghapusan schedule visit offline. Jika secret belum ada atau salah, aplikasi tetap menyimpan data; notifikasi tidak terkirim sampai rahasia diperbaiki. Dokumentasi resmi: [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets).

## Backup

Menu Arsip & File menyediakan backup terenkripsi browser `.rkbak`. Saat ini backup dibatasi supaya tidak menggunakan memori browser berlebihan. Simpan salinan backup dengan password yang kuat di lokasi privat terpisah, dan uji pemulihan berkala. Cloud storage bukan satu-satunya backup.

## Struktur

- `index.html`, `styles.css`, `app.js`: antarmuka dan logika frontend.
- `config.js`: Supabase URL dan public publishable key.
- `supabase/schema.sql`: schema untuk instalasi baru, tabel, RLS, bucket privat legacy.
- `supabase/migrations/`: migrasi perubahan database, termasuk akses dua kode, retensi 14 hari, storage provider, schedule visit offline, dan kategori lampiran hasil.
- `supabase/functions/google-drive-storage/index.ts`: endpoint privat untuk pembersihan file dan metadata setelah 14 hari.
- `supabase/functions/notify-telegram/index.ts`: notifikasi Telegram.
- Supabase Cron: job `ruang-kerja-rey-storage-retention` untuk menjalankan pembersihan otomatis harian.
- `scripts/build.mjs`: hanya menyalin aset website ke `dist/`.
- `.github/workflows/check.yml`: tes syntax/build dan memastikan SQL backend tidak masuk output publik.
