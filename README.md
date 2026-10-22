# RUANG KERJA — portal pekerjaan pribadi

Portal responsif untuk koordinasi tim: tugas dan deadline, approval/revisi, lampiran pekerjaan, panel Content, schedule visit offline, backup terenkripsi, notifikasi Telegram, penyimpanan file privat Backblaze B2 untuk upload baru, serta retensi file 14 hari.

## Status project

- Project Supabase `ruang-kerja-rey` sudah dibuat.
- Database, aturan akses, dan bucket privat Supabase `ruang-kerja-files` untuk file lama tetap tersedia.
- Edge Function `b2-storage` sudah di-deploy. Upload baru memakai Backblaze B2 setelah bucket dan lima secret B2 dikonfigurasi; sebelum itu portal sementara memakai Supabase agar upload tidak langsung rusak.
- `config.js` sudah diisi Project URL dan public publishable key.
- Website sudah live melalui GitHub Pages: https://reybyoo-maker.github.io/WEBSITE-PERSONAL/.

## Privasi dan keamanan

- File baru disimpan di **private Backblaze B2 bucket** dan transfer memakai URL bertanda tangan yang berumur 15 menit. Kunci B2 berada di Supabase Edge Function Secrets, tidak dikirim ke browser.
- Metadata tetap berada di Supabase dan dilindungi oleh RLS. File lama tetap menggunakan private Supabase Storage sampai retensinya lewat.
- Saat file/folder (tugas atau grup Content) dihapus manual, backend menghapus seluruh versi objek B2 supaya kapasitasnya benar-benar dapat dipakai kembali.
- Jangan commit file kerja, password, kode undangan, API key rahasia, atau backup ke GitHub.
- Hosting gratis GitHub Pages di akun GitHub Free mengharuskan repository ini **Public**, sehingga source code dapat dilihat siapa saja. Jangan simpan dokumen kerja, password, kode undangan mentah, API secret, atau backup di repository. Konten file hanya dapat diakses melalui storage privat dan URL bertanda tangan setelah otorisasi sesi.
- Jangan menyimpan dokumen rahasia negara/berklasifikasi atau dokumen yang dibatasi kebijakan instansi di layanan cloud umum tanpa persetujuan resmi. Sistem ini tidak tersertifikasi untuk penyimpanan dokumen berklasifikasi.

## Batas file paket gratis

Portal memecah file menjadi potongan masing-masing 20 MiB sehingga batas aplikasi adalah **800 MiB per file**. Potongan disatukan kembali ketika diunduh. Backblaze B2 menyediakan jatah gratis terbatas; kuota, biaya penyimpanan, dan transfer terbaru mengikuti akun serta halaman harga provider. **Tidak ada storage gratis tanpa batas.** File yang sudah dihapus permanen membebaskan kapasitas, tetapi objek yang sudah kedaluwarsa otomatis dapat memerlukan 1–2 hari tambahan untuk dihapus permanen oleh proses lifecycle B2. Pastikan lifecycle, kapasitas, dan biaya diperiksa berkala.

Jika secret B2 belum disetel, portal memakai Supabase Storage sementara. File transisi itu tidak memakai kuota B2, dan akan dihapus oleh cleanup portal setelah 14 hari sejak kolom retensi diaktifkan. Jangan mengunggah dokumen rahasia/berklasifikasi atau file yang tidak diizinkan oleh kebijakan instansi.

Dokumentasi: [Backblaze S3-Compatible API](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api) · [Lifecycle Rules](https://www.backblaze.com/docs/en/cloud-storage-lifecycle-rules) · [CORS Rules](https://www.backblaze.com/docs/cloud-storage-cross-origin-resource-sharing-rules)

## Jalankan website

### 1. Supabase (project ini sudah dikonfigurasi)

Database dan aturan akses sudah dibuat melalui migrasi. Bucket privat `ruang-kerja-files` digunakan untuk file lama. **Jangan jalankan ulang `supabase/schema.sql` di project yang sudah aktif ini**, karena file tersebut untuk instalasi baru. Project ini menggunakan `https://edgzffkhjtzejxjbtqib.supabase.co`; jangan pernah menaruh service-role/secret key atau kredensial Backblaze ke browser.

Pastikan Authentication → Providers → **Anonymous Sign-Ins** aktif karena portal memakai kode akses tanpa email/password. Email provider tidak diperlukan untuk login portal ini. URL website tetap dapat dimasukkan pada Authentication → URL Configuration → Site URL.

### 2. Terbitkan antarmuka gratis lewat GitHub Pages

Workflow `.github/workflows/deploy-pages.yml` akan build website dan deploy hasil `dist/` secara otomatis.

1. Buka https://github.com/reybyoo-maker/WEBSITE-PERSONAL/settings/pages.
2. Di **Build and deployment → Source**, pilih **GitHub Actions**.
3. Tunggu workflow **Deploy Ruang Kerja to GitHub Pages** selesai sukses di tab Actions.
4. URL project yang diharapkan: `https://reybyoo-maker.github.io/WEBSITE-PERSONAL/`.
5. Di Supabase → Authentication → URL Configuration, atur **Site URL** ke URL di atas, dan tambahkan URL yang sama di **Redirect URLs**.

GitHub Pages gratis untuk repository publik dan tidak membutuhkan kartu/billing untuk hosting standar. Source code terlihat publik, jadi jangan commit file kerja atau secret. Backblaze B2 adalah storage terpisah; kredensialnya harus disimpan sebagai Supabase Edge Function Secrets.

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
- lampiran besar dipecah menjadi bagian privat 20 MiB dan dapat diunduh kembali; setelah secret B2 disetel, metadata file baru harus menunjukkan `storage_provider = backblaze`;
- tombol Hapus membebaskan kapasitas B2 dengan menghapus semua versi objek, bukan hanya delete marker;
- panel Content mendukung beberapa lampiran, Copy caption, pilihan Reels/Feed/Carousel, tanggal/jam, dan approval;
- Kode 1 tampil merah dan Kode 2 tampil pink; keduanya bisa melihat, mengedit, menghapus tugas dan schedule yang sama;
- panel Visit offline bisa membuat, mengedit, menghapus, dan mengganti status Fix / Masih rencana / Batal;
- semua pemegang kode bisa mengunduh content dan lampiran tim;
- notifikasi Telegram masuk saat tugas/content baru dibuat atau status berubah setelah rahasia Telegram disetel;
- orang tanpa sesi yang sah tidak dapat membaca atau mengunduh file;
- backup terenkripsi dapat dibuat dan dipulihkan.

## Aktifkan Backblaze B2 (wajib untuk storage baru)

Edge Function `b2-storage` sudah aktif di project Supabase, tetapi **upload baru belum memakai B2 sampai kamu membuat bucket dan mengisi secrets berikut**. Sementara konfigurasi belum lengkap, portal akan menaruh upload baru di Supabase Storage dan menampilkan peringatan.

1. Buka [Backblaze B2 Cloud Storage](https://www.backblaze.com/cloud-storage), aktifkan B2, lalu buat satu bucket dengan akses **Private**. Nama bucket harus unik, misalnya `ruang-kerja-rey-<angka-acak>`. Catat bucket name, region, dan endpoint S3 yang biasanya berbentuk `https://s3.<region>.backblazeb2.com`.
2. Di **Application Keys**, buat key baru yang dibatasi ke bucket tersebut. Aktifkan kemampuan **listFiles, readFiles, writeFiles, dan deleteFiles**. Jangan gunakan master application key. Salin Key ID dan Application Key saat dibuat; rahasianya biasanya hanya ditampilkan saat pembuatan.
3. Di Supabase Dashboard project `ruang-kerja-rey`, buka **Edge Functions → Secrets** dan tambahkan:
   - `B2_ENDPOINT` — contoh format: `https://s3.us-west-004.backblazeb2.com` (gunakan region milik bucketmu).
   - `B2_REGION` — hanya nama region, misalnya `us-west-004`.
   - `B2_BUCKET_NAME` — nama bucket yang kamu buat.
   - `B2_KEY_ID` — Key ID dari Application Key.
   - `B2_APPLICATION_KEY` — Application Key rahasia.
4. Di bucket Backblaze, tambahkan aturan **CORS untuk S3-compatible API**. Izinkan origin tepat `https://reybyoo-maker.github.io`, metode `GET`, `PUT`, dan `HEAD`, header `*`, dan expose header `ETag`. CORS diperlukan karena browser upload/download langsung ke URL bertanda tangan. Lihat [panduan resmi CORS S3](https://www.backblaze.com/docs/cloud-storage-enable-cors-with-the-s3-compatible-api). Jika console akunmu tidak menyediakan pengaturan CORS, gunakan S3 API `PutBucketCors` dari tool/CLI tepercaya; untuk menulis CORS diperlukan izin konfigurasi bucket yang lebih luas, jadi jangan simpan key konfigurasi itu di website.
5. Di **Buckets → bucket kamu → Lifecycle Settings**, pilih **Use custom lifecycle rules**, biarkan File Path kosong agar berlaku untuk seluruh object, atur `daysFromUploadingToHiding = 14` dan `daysFromHidingToDeleting = 1`, lalu simpan. Ini membuat objek disembunyikan setelah 14 hari dan versi fisiknya dihapus setelah aturan lifecycle berjalan. Karena lifecycle diproses berkala, penghapusan permanen aktual dapat terjadi sekitar hari ke-15 hingga ke-17. Dokumentasi: [Lifecycle Rules Backblaze](https://www.backblaze.com/docs/en/cloud-storage-lifecycle-rules).
6. Buka portal, login, upload satu file uji yang tidak penting, download, lalu hapus. Jika masih muncul peringatan bahwa B2 belum dikonfigurasi, periksa nama secret dan endpoint/region. Jangan kirimkan nilai secret ke chat atau commit ke GitHub.

**Penghapusan manual:** fungsi menghapus semua versi objek B2 yang diketahui untuk file yang dihapus. **Retensi otomatis:** aturan lifecycle bucket mengurus file yang mencapai umur 14 hari walaupun portal tidak sedang dibuka. Metadata lama dibersihkan oleh portal saat dibuka setelah melewati retensi.

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
- `supabase/functions/b2-storage/index.ts`: backend privat untuk URL upload/download sementara dan penghapusan permanen versi objek B2.
- `supabase/functions/notify-telegram/index.ts`: notifikasi Telegram.
- `scripts/build.mjs`: hanya menyalin aset website ke `dist/`.
- `.github/workflows/check.yml`: tes syntax/build dan memastikan SQL backend tidak masuk output publik.
