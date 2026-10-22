# RUANG KERJA — panduan setup

Portal kerja sederhana untuk dua orang: dashboard, tugas, deadline, lampiran privat untuk file kerja yang diizinkan, komentar, approval, revisi, dan riwayat aktivitas.

## PENTING UNTUK DOKUMEN RAHASIA

Repository ini saat dibuat masih PUBLIC. Source code boleh berada di sini, tetapi JANGAN commit dokumen, password, access token, service-role key, atau data pekerjaan. Ubah repository menjadi Private melalui Settings → General → Danger Zone bila source code juga ingin dibatasi. Website statis yang dipublikasikan ke GitHub Pages tetap dapat dilihat siapa saja; data tidak boleh ditanam di source code.

Jangan unggah dokumen rahasia negara/berklasifikasi ke portal ini, GitHub, atau layanan cloud umum kecuali penggunaan layanan dan penyimpanannya telah disetujui oleh instansi yang berwenang. Upload portal ini ditujukan hanya untuk file kerja non-rahasia yang memang boleh disimpan di layanan tersebut. Tidak ada layanan yang dapat menjamin risiko kebocoran atau kehilangan data menjadi nol.

## Isi

- index.html + styles.css + app.js — antarmuka responsif.
- config.js — URL Supabase dan public anon/publishable key; bukan service-role key.
- supabase/schema.sql — tabel, alur undangan sekali pakai, Row Level Security, audit, serta private storage bucket.
- .github/workflows/deploy.yml — deploy GitHub Pages.

## Setup sekali saja

1. Buat project baru di https://supabase.com/.
2. Buka SQL Editor di project tersebut, lalu jalankan seluruh isi supabase/schema.sql satu kali.
3. Dari Supabase Project Settings → API, salin Project URL dan public anon/publishable key. Masukkan keduanya ke config.js. Jangan pernah memakai service_role/secret key di browser.
4. Di Supabase Authentication, pastikan pendaftaran email/password aktif. Trigger database menolak pendaftaran tanpa undangan yang valid, dan setiap kode hanya bisa dipakai sekali. Jika konfirmasi email aktif, pengguna harus mengonfirmasi email sebelum login.
5. Setelah Pages aktif, buka Authentication → URL Configuration di Supabase. Set Site URL ke https://reybyoo-maker.github.io/WEBSITE-PERSONAL/ dan masukkan URL yang sama pada daftar Redirect URLs agar tautan konfirmasi kembali ke website.
6. Bagikan kode undangan member dan manager secara pribadi, bukan lewat repository publik. Pastikan email yang dimasukkan benar saat aktivasi: undangan dikonsumsi pada saat formulir pendaftaran diterima. Setelah akun berhasil dibuat, login memakai email dan password; kode undangan tidak dipakai lagi.
7. Di GitHub repository Settings → Pages, pilih Build and deployment → Source: GitHub Actions. Ini perlu dilakukan manual karena GitHub tidak mengizinkan workflow biasa mengaktifkan Pages sendiri.
8. Buka https://reybyoo-maker.github.io/WEBSITE-PERSONAL/ setelah setting Pages diaktifkan dan workflow deploy sukses. Jika run sebelumnya sudah gagal, buka Actions, pilih run terbaru, lalu klik Re-run all jobs.

## Cara pakai

Buat tugas, pilih penanggung jawab dan deadline. Anggota mengubah status menjadi Sedang dikerjakan lalu Ajukan approval. Manager dapat menyetujui, meminta revisi, atau menandai selesai. Komentar, lampiran privat, dan perubahan status dicatat. File maksimal 20 MB per file; tipe file dikontrol oleh bucket. Kedua akun dalam tim dapat melihat tugas, tetapi tombol approval hanya tersedia untuk role manager dan database juga menegakkan pembatasan tersebut.

## Pemulihan dan backup

Di menu Arsip & File, akun manager bisa memilih **Backup terenkripsi**. Sistem mengunduh tugas, komentar, riwayat, metadata lampiran, dan konten file ke satu arsip .rkbak yang dienkripsi di browser memakai AES-GCM dengan kunci turunan PBKDF2. Password backup tidak dikirim ke database. Pilih password unik minimal 16 karakter dan simpan terpisah; jika password hilang, file backup tidak bisa dibuka.

Gunakan **Pulihkan backup** untuk menggabungkan data yang hilang dari backup. Data yang sudah ada tidak ditimpa. Proses pemulihan belum menggantikan backup rutin dan harus diuji dengan data dummy sebelum dipakai untuk pemulihan sungguhan. Buat backup berkala, simpan minimal dua salinan di lokasi terpisah dan terenkripsi, lalu lakukan uji pemulihan. Jangan menganggap GitHub sebagai backup untuk database atau file upload.

Perhatian: Supabase Free tidak menyediakan automatic database backups dan dapat menjeda project setelah 7 hari aktivitas yang rendah. Itu berarti backup .rkbak manual tetap penting dan website/database mungkin perlu dibangunkan kembali dari dashboard bila project dijeda. Lihat dokumentasi terbaru: https://supabase.com/docs/guides/platform/free-project-pausing dan https://supabase.com/docs/guides/platform/backups.

## Batasan

GitHub Pages hanya menyajikan antarmuka. Login, data tugas dan lampiran menggunakan Supabase, dan belum berfungsi sebelum project URL/key di config.js disetel serta schema SQL diterapkan. Ini bukan sistem yang tersertifikasi untuk menangani informasi rahasia negara. Minta persetujuan unit keamanan/IT instansi sebelum memasukkan informasi sensitif apa pun.
