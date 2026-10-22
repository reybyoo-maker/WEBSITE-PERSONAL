# RUANG KERJA — portal pekerjaan pribadi

Portal responsif untuk koordinasi tim: tugas dan deadline, approval/revisi, lampiran pekerjaan, panel Content, schedule visit offline, backup terenkripsi, notifikasi Telegram, integrasi Google Drive privat, serta penghapusan file otomatis setelah 14 hari.

## Status project

- Project Supabase `ruang-kerja-rey` sudah dibuat.
- Database, aturan akses, dan bucket privat Supabase `ruang-kerja-files` untuk file lama tetap tersedia.
- Edge Function `google-drive-storage` sudah aktif; koneksi Google OAuth perlu disiapkan sebelum upload baru berfungsi.
- Workflow GitHub Actions `Google Drive 14-day retention` sudah dibuat untuk menjalankan pembersihan setiap hari setelah token penjadwal dikonfigurasi.
- Website sudah live melalui GitHub Pages: https://reybyoo-maker.github.io/WEBSITE-PERSONAL/.

## Privasi dan keamanan

- File baru disimpan di folder **Ruang Kerja Rey** di Google Drive yang terhubung melalui OAuth. Refresh token disimpan di backend Supabase, bukan di browser atau GitHub.
- Metadata file tersimpan di Supabase dan dilindungi oleh RLS. File lama yang sebelumnya ada di Supabase Storage tetap dapat dibaca hingga retensi habis.
- Ketika file atau grup Content dihapus manual, backend menghapus file Google Drive secara permanen, bukan memindahkannya ke Sampah, sehingga kapasitas dapat digunakan kembali.
- Jangan commit file kerja, password, kode undangan, OAuth Client Secret, token cleanup, atau backup ke GitHub.
- Hosting gratis GitHub Pages mengharuskan repository ini **Public**, sehingga source code dapat dilihat siapa saja. Rahasia hanya boleh disimpan dalam Supabase Edge Function Secrets atau GitHub Actions Secrets.
- Jangan menyimpan dokumen rahasia/berklasifikasi atau dokumen yang dilarang kebijakan instansi di layanan cloud umum tanpa persetujuan resmi.

## Kapasitas dan retensi file

Portal memecah file menjadi potongan masing-masing 20 MiB sehingga batas aplikasi adalah **800 MiB per file**. Saat diunduh, potongan disatukan kembali. Penyimpanan Google Drive gratis **15 GB per akun**, dibagi bersama Gmail dan Google Photos; kuota akun dan batas Google Drive API tetap berlaku. Tidak ada storage gratis tanpa batas.

File yang mencapai usia 14 hari dihapus oleh job harian, sehingga waktunya dapat sedikit lewat dari tepat hari ke-14. Penghapusan manual memakai Drive API agar file tidak sekadar masuk Sampah. Pastikan file yang masih diperlukan sudah diunduh atau dibuat backup terpisah sebelum retensi habis.

Dokumentasi: [Google Drive resumable upload](https://developers.google.com/workspace/drive/api/guides/manage-uploads) · [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) · [Permanent delete](https://developers.google.com/workspace/drive/api/guides/delete)

## Jalankan website

### 1. Supabase (project ini sudah dikonfigurasi)

Database dan aturan akses sudah dibuat melalui migrasi. Bucket privat `ruang-kerja-files` digunakan untuk file lama. **Jangan jalankan ulang `supabase/schema.sql` di project yang sudah aktif ini**, karena file tersebut untuk instalasi baru. Project ini menggunakan `https://edgzffkhjtzejxjbtqib.supabase.co`; jangan pernah menaruh service-role/secret key atau kredensial Google Drive ke browser.

Pastikan Authentication → Providers → **Anonymous Sign-Ins** aktif karena portal memakai kode akses tanpa email/password. Email provider tidak diperlukan untuk login portal ini. URL website tetap dapat dimasukkan pada Authentication → URL Configuration → Site URL.

### 2. Terbitkan antarmuka gratis lewat GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` akan build website dan deploy hasil `dist/` secara otomatis.

1. Buka https://github.com/reybyoo-maker/WEBSITE-PERSONAL/settings/pages.
2. Di **Build and deployment → Source**, pilih **GitHub Actions**.
3. Tunggu workflow **Deploy Ruang Kerja to GitHub Pages** selesai sukses di tab Actions.
4. URL project yang diharapkan: `https://reybyoo-maker.github.io/WEBSITE-PERSONAL/`.
5. Di Supabase → Authentication → URL Configuration, atur **Site URL** ke URL di atas, dan tambahkan URL yang sama di **Redirect URLs**.

GitHub Pages gratis untuk repository publik dan tidak membutuhkan kartu/billing untuk hosting standar. Source code terlihat publik, jadi jangan commit file kerja atau secret. Google Drive adalah storage terpisah; kredensialnya harus disimpan sebagai Supabase Edge Function Secrets.

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
- tugas menerima beberapa file pekerjaan dan file contoh opsional; pilih file satu per satu, lalu kolom berikutnya muncul otomatis;
- lampiran besar dipecah menjadi bagian privat 20 MiB dan dapat diunduh kembali; setelah secret Google Drive disetel, metadata file baru harus menunjukkan `storage_provider = google_drive`;
- tombol Hapus menghapus file Google Drive secara permanen melalui Drive API;
- panel Content mendukung beberapa lampiran, Copy caption, pilihan Reels/Feed/Carousel, tanggal/jam, dan approval;
- Kode 1 tampil merah dan Kode 2 tampil pink; keduanya bisa melihat, mengedit, menghapus tugas dan schedule yang sama;
- panel Visit offline bisa membuat, mengedit, menghapus, dan mengganti status Fix / Masih rencana / Batal;
- semua pemegang kode bisa mengunduh content dan lampiran tim;
- notifikasi Telegram masuk saat tugas/content baru dibuat atau status berubah setelah rahasia Telegram disetel;
- orang tanpa sesi yang sah tidak dapat membaca atau mengunduh file;
- backup terenkripsi dapat dibuat dan dipulihkan.

## Aktifkan Google Drive (wajib untuk upload baru)

Edge Function `google-drive-storage` sudah dipasang di Supabase. Google Drive perlu diotorisasi satu kali dan OAuth secrets perlu disimpan sebelum upload baru berfungsi.

Sebelum mencoba menghubungkan Google, publikasikan UI terbaru sekali: buka [workflow Deploy Ruang Kerja to GitHub Pages](https://github.com/reybyoo-maker/WEBSITE-PERSONAL/actions/workflows/deploy-pages.yml), pilih **Run workflow** dengan branch `main`, lalu tunggu sampai sukses. Ini memastikan tombol **Hubungkan Google Drive** sudah tampil di website.

### A. Siapkan Google Cloud dan OAuth

1. Buka [Google Cloud Console](https://console.cloud.google.com/) dan buat atau pilih project. Pastikan project yang sama tetap dipilih di bagian atas konsol.
2. Buka **APIs & Services → Library**, cari **Google Drive API**, buka halaman API tersebut, lalu tekan **Enable**.
3. Buka **Google Auth Platform → Branding**. Jika muncul **Get started**, klik. Isi **App name** dengan `Ruang Kerja Rey`, pilih email kamu pada **User support email**, isi **Developer contact information** dengan email yang bisa kamu akses, lalu **Save**.
4. Buka **Google Auth Platform → Audience**. Untuk akun Gmail pribadi, pilih **External**. Di bagian **Test users**, klik **Add users**, masukkan alamat Gmail yang akan menyimpan file, lalu **Save**.
5. Buka **Google Auth Platform → Data Access**. Klik **Add or remove scopes**. Cari atau tambahkan scope ini saja, lalu simpan:
   `https://www.googleapis.com/auth/drive.file`
   Scope di konsol harus cocok dengan scope yang diminta aplikasi. Jangan menambahkan `drive` yang memberi akses lebih luas ke seluruh Drive. Referensi resmi: [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
6. Buka **Google Auth Platform → Clients**, pilih **Create client**, pilih **Application type: Web application**, lalu beri nama `Ruang Kerja Rey Web OAuth`.
7. Pada **Authorized redirect URIs**, klik **Add URI** dan tempel alamat ini persis (tanpa spasi dan tanpa slash tambahan di ujung):
   `https://edgzffkhjtzejxjbtqib.supabase.co/functions/v1/google-drive-storage`
   **Authorized JavaScript origins** boleh dibiarkan kosong karena callback OAuth ditangani oleh backend Supabase.
8. Klik **Create**. Pada kotak yang muncul, salin **Client ID** dan **Client Secret**. Simpan sementara secara pribadi; jangan ditempel di website atau GitHub.

Scope `https://www.googleapis.com/auth/drive.file` membatasi izin pada file yang dibuat/digunakan oleh aplikasi. Google menjelaskan bahwa untuk External app berstatus **Testing**, persetujuan pengguna akan kedaluwarsa setelah 7 hari. Artinya, untuk jadwal hapus otomatis 14 hari, **Testing hanya cocok untuk uji coba**. Setelah uji awal, buka **Google Auth Platform → Audience → Publishing status → Publish app / In production**, dan ikuti langkah verifikasi yang diminta konsol Google. Google tetap dapat menampilkan peringatan aplikasi belum diverifikasi sampai proses yang berlaku selesai. Referensi: [OAuth refresh-token expiry](https://developers.google.com/identity/protocols/oauth2/) dan [Audience/publishing status](https://support.google.com/cloud/answer/15549945).

### B. Simpan tiga secrets di Supabase

Buka [Supabase Edge Function Secrets](https://supabase.com/dashboard/project/edgzffkhjtzejxjbtqib/functions/secrets), lalu tambahkan:

- `GOOGLE_CLIENT_ID` — Client ID dari Google Cloud.
- `GOOGLE_CLIENT_SECRET` — Client Secret (rahasia).
- `GOOGLE_REDIRECT_URI` — nilai persis `https://edgzffkhjtzejxjbtqib.supabase.co/functions/v1/google-drive-storage`.

Jangan memasukkan Client Secret ke `app.js`, `config.js`, atau repository GitHub.

### C. Hubungkan akun Google

1. Buka [Ruang Kerja Rey](https://reybyoo-maker.github.io/WEBSITE-PERSONAL/) dan login dengan kode akses.
2. Buka menu **Arsip & file**, lalu tekan **Hubungkan Google Drive**.
3. Pilih akun Google yang akan menjadi pemilik file, lalu izinkan akses.
4. Setelah kembali ke portal, refresh halaman dan pastikan status **Google Drive terhubung**.
5. Tes dengan file non-penting: upload, download, lalu hapus. File baru akan ada di folder **Ruang Kerja Rey** pada Google Drive.

### D. Aktifkan penghapusan otomatis 14 hari

Workflow `.github/workflows/google-drive-retention.yml` menjalankan pembersihan harian. Job menghapus permanen file yang sudah berusia minimal 14 hari dan membersihkan metadata Supabase.

1. Buat token acak panjang untuk melindungi endpoint cleanup.
2. Simpan nilai token yang sama sebagai secret bernama `GDRIVE_CLEANUP_TOKEN` pada **Supabase Edge Function Secrets** dan **GitHub repository → Settings → Secrets and variables → Actions → New repository secret**.
3. Buka tab **Actions** pada GitHub, jalankan workflow **Google Drive 14-day retention** melalui **Run workflow**, dan pastikan job selesai sukses dengan `"ok": true`. Setelah itu job akan berjalan harian.

Jangan kirim token cleanup di chat atau taruh di file source. Kalau token tidak ada atau berbeda antara GitHub dan Supabase, job tidak dapat membersihkan file otomatis.

### Jika OAuth gagal

- **`Error 400: redirect_uri_mismatch`** — buka Client ID Web kamu, periksa daftar **Authorized redirect URIs**, dan pastikan alamat persis sama dengan URI di bagian A. Jangan pakai alamat GitHub Pages sebagai callback OAuth.
- **`Access blocked` atau akun tidak diizinkan** — buka **Google Auth Platform → Audience → Test users**, tambahkan Gmail yang dipakai untuk Google Drive, lalu coba lagi. Jika aplikasi masih Testing, gunakan akun yang tercantum di sana.
- **`invalid_client` atau `unauthorized_client`** — pastikan Client ID dan Client Secret berasal dari project Google Cloud yang sama dengan Google Drive API. Periksa tidak ada spasi saat menyalin secret.
- **Tombol tidak ada di website** — jalankan ulang workflow **Deploy Ruang Kerja to GitHub Pages** pada branch `main`, tunggu sukses, lalu muat ulang halaman dengan hard refresh.
- **`Google Drive belum disiapkan`** — periksa tiga secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, dan `GOOGLE_REDIRECT_URI` di Supabase. Pastikan nilai callback tidak ada slash tambahan.
- **Token tidak bertahan sampai 14 hari** — OAuth External app dengan Publishing status **Testing** memberi grant yang kedaluwarsa setelah 7 hari. Untuk otomatisasi retensi yang terus berjalan, ikuti langkah **In production** di bagian A.
- **OAuth berhasil tetapi refresh token tidak diperoleh** — buka [izin aplikasi di Akun Google](https://myaccount.google.com/permissions), cabut akses `Ruang Kerja Rey` jika sudah tercatat, kemudian mulai koneksi ulang dari portal. Simpan Client Secret dan refresh token hanya di backend.

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
- `supabase/migrations/`: migrasi perubahan database, termasuk akses dua kode, retensi 14 hari, storage provider, dan schedule visit offline.
- `supabase/functions/google-drive-storage/index.ts`: backend privat untuk OAuth, upload/download, penghapusan permanen, dan retensi Google Drive.
- `supabase/functions/notify-telegram/index.ts`: notifikasi Telegram.
- `.github/workflows/google-drive-retention.yml`: pembersihan file harian setelah 14 hari.
- `scripts/build.mjs`: hanya menyalin aset website ke `dist/`.
- `.github/workflows/check.yml`: tes syntax/build dan memastikan SQL backend tidak masuk output publik.
