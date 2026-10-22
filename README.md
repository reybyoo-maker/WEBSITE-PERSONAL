# RUANG KERJA — portal pekerjaan pribadi

Portal responsif untuk dua orang: dashboard, tugas, deadline, prioritas, komentar, approval/revisi, lampiran privat, riwayat aktivitas, serta backup terenkripsi.

## Penting untuk kerahasiaan

Repository saat ini bersifat **PUBLIC**. Source code boleh berada di sini, tetapi jangan commit dokumen, password, kode undangan mentah, access token, atau Supabase secret key. Disarankan ubah repository menjadi Private di Settings → General → Danger Zone. Jangan commit file pekerjaan atau hasil upload ke Git.

**Jangan gunakan portal ini untuk menyimpan dokumen rahasia negara/berklasifikasi.** Ini aplikasi custom menggunakan layanan cloud umum dan tidak tersertifikasi/diotorisasi untuk dokumen tersebut. Gunakan hanya untuk data yang instansi izinkan. File berklasifikasi harus tetap di sistem resmi yang disetujui instansi.

## Upload file besar

Pembatasan 20 MB di aplikasi sudah dihapus. Form menerima berbagai tipe file, lalu mengunggahnya ke Cloudflare R2 menggunakan multipart upload bertahap, jadi unggahan dapat menangani file sangat besar dan tidak perlu mengirim seluruh file sebagai satu request. Unduhan mengalir langsung dari Worker agar file besar tidak ditampung seluruhnya di memori browser.

Batas teknis implementasi sekarang sekitar **879 GiB per file** (10.000 bagian × 64 MiB per bagian). Ini bukan ukuran penyimpanan total tanpa batas: paket gratis R2 mencakup **10 GB-month storage**, 1 juta operasi Class A dan 10 juta Class B per bulan; penggunaan di atas kuota gratis dapat dikenakan biaya. Egress R2 tidak dikenakan biaya. Referensi: https://developers.cloudflare.com/r2/pricing/ dan https://developers.cloudflare.com/r2/objects/upload-objects/.

Jika total file tim melebihi 10 GB dan harus selalu gratis, tidak ada layanan cloud publik yang dapat menjamin storage tanpa batas. Jangan aktifkan billing/overage kalau tidak ingin ada biaya. Pilih penyimpanan server/perangkat milik instansi dengan kapasitas yang memang tersedia dan persetujuan administrator IT.

## Fitur

- Dashboard pribadi dan panel berdasarkan role Anggota/Manager.
- Tugas, PIC, deadline, prioritas, deskripsi, komentar, dan pencarian.
- Alur status serta approval/revisi manager yang diperiksa di database.
- File disimpan di bucket R2 privat; Worker memverifikasi sesi Supabase, role, akses tugas, dan metadata sebelum mengizinkan upload/download.
- File dapat berupa berbagai tipe, dengan batas implementasi saat ini sekitar 879 GiB untuk satu file.
- Backup terenkripsi `.rkbak` untuk data dan lampiran berukuran total maksimal 300 MB per arsip melalui browser. Untuk koleksi file yang lebih besar, simpan salinan file terpisah ke media backup terenkripsi yang disetujui. Jangan menganggap backup arsip browser cocok untuk file multi-gigabyte.

## Setup gratis

### 1. Buat project Supabase

1. Buka https://supabase.com/ dan buat project.
2. Di Supabase → SQL Editor, jalankan seluruh isi `supabase/schema.sql` untuk instalasi baru. Jika kamu sudah memakai schema versi lama sebelumnya, jalankan `supabase/migrations/20261022_r2_large_files.sql` agar batas metadata berubah tanpa menghapus catatan tugas yang sudah ada.
3. Di Project Settings → API, salin Project URL dan public anon/publishable key ke `config.js`. Jangan pernah menggunakan service_role/secret key di browser.
4. Pastikan Auth Email/Password aktif.

### 2. Buat private bucket Cloudflare R2

1. Buka https://dash.cloudflare.com/ → R2 Object Storage.
2. Buat bucket dengan nama tepat `ruang-kerja-files`.
3. Jangan aktifkan R2.dev public URL atau domain publik untuk bucket itu. Akses file harus melalui Worker.
4. Free tier saat ini mencakup 10 GB-month storage; kuota ini berlaku untuk total file tersimpan, bukan per file. Saat total file tumbuh melampaui kuota, hentikan upload atau cek biaya sebelum lanjut.

### 3. Deploy Worker penyimpanan

1. Di Cloudflare Dashboard buka Workers & Pages → Create application → GitHub, lalu pilih repository `reybyoo-maker/WEBSITE-PERSONAL`.
2. Atur Root directory ke `worker` dan branch ke `main`. File `worker/wrangler.toml` sudah menentukan nama Worker `ruang-kerja-file-api`, binding R2 `FILES_BUCKET`, serta bucket `ruang-kerja-files`. Buat bucket dengan nama itu terlebih dahulu.
3. Deploy Worker. Di Worker Settings → Variables and Secrets, isi variable `SUPABASE_URL` dengan Project URL dan `SUPABASE_ANON_KEY` dengan public anon/publishable key.
4. Isi `ALLOWED_ORIGINS` dengan domain Pages yang akan dipakai, misalnya `https://nama-proyek.pages.dev` (tanpa garis miring di akhir). Kamu dapat memperbaruinya setelah Pages terbit. Jika memakai custom domain, masukkan kedua origin dipisahkan koma.
5. Tambahkan `DOWNLOAD_SIGNING_SECRET` sebagai Secret, bukan plaintext dalam repo. Buat nilai acak panjang minimal 32 karakter. Jangan kirim secret ini ke orang lain.
6. Pastikan Worker sudah aktif di URL seperti `https://ruang-kerja-file-api.<subdomain>.workers.dev`.

### 4. Deploy antarmuka

1. Di Cloudflare Pages buat project Git-connected dari repository `reybyoo-maker/WEBSITE-PERSONAL` dengan branch `main`.
2. Build command: `npm run build`. Output directory: `dist`.
3. Setelah URL Pages tersedia, masukkan URL Supabase, public key, dan URL Worker ke `config.js`, lalu commit. Jangan memasukkan secret Worker ke file ini.
4. Tambahkan URL Pages ke Supabase Authentication → URL Configuration → Site URL dan Redirect URLs.
5. Perbarui `ALLOWED_ORIGINS` pada Worker dengan URL Pages yang tepat. Uji upload, unduh, role member/manager, dan akses dari akun yang tidak punya izin menggunakan file dummy saja.

### 5. Undangan satu kali pakai

Schema menanam hash kode undangan member dan manager; kode mentah tidak disimpan di repository. Kode hanya untuk dua akun tersebut, dibagikan secara privat, dan sekali pakai. Pastikan email benar saat aktivasi karena kode dikonsumsi ketika form pendaftaran dikirim.

## Backup

Menu Arsip & File menyediakan backup `.rkbak` terenkripsi di browser memakai AES-GCM. Untuk mencegah tab kehabisan memori, total lampiran dalam satu arsip dibatasi 300 MB. File yang sangat besar harus dicadangkan terpisah ke media terenkripsi yang disetujui, dan pemulihan harus diuji dengan data dummy. Buat dua salinan di lokasi terpisah dan uji pemulihan berkala. Penyimpanan R2 bukan backup independen dan tidak menjamin file terhapus dapat dipulihkan.

## Struktur

- `index.html`, `styles.css`, `app.js`: antarmuka dan logika frontend.
- `config.js`: Supabase URL, public key, dan URL Worker.
- `supabase/schema.sql`: database, aturan role/RLS, metadata file.
- `supabase/migrations/20261022_r2_large_files.sql`: perubahan limit metadata untuk instalasi lama.
- `worker/r2-worker.js`: upload multipart, validasi akses, download bertiket singkat.
- `worker/wrangler.toml`: konfigurasi Worker dan binding bucket.
- `scripts/build.mjs`: hanya menyalin aset website ke `dist/`.
- `.github/workflows/check.yml`: tes syntax/build dan verifikasi bahwa SQL backend tidak masuk output publik.

## Status

Source code tersedia di GitHub dan CI memvalidasi syntax serta build. Upload file besar baru berfungsi setelah project Supabase dan bucket/Worker R2 dibuat, variabel Worker disetel, `config.js` diisi, dan Pages dipublikasikan. Fitur belum live hanya dari commit repository ini.
