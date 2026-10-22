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
5. Bagikan kode undangan member dan manager secara pribadi, bukan lewat repository publik. Setelah akun pertama masing-masing berhasil dibuat, login memakai email dan password; kode undangan tidak dipakai lagi.
6. Di GitHub repository Settings → Pages, pilih Build and deployment → Source: GitHub Actions. Workflow akan deploy setelah ada push ke main.
7. Buka https://reybyoo-maker.github.io/WEBSITE-PERSONAL/ setelah workflow Pages sukses.

## Cara pakai

Buat tugas, pilih penanggung jawab dan deadline. Anggota mengubah status menjadi Sedang dikerjakan lalu Ajukan approval. Manager dapat menyetujui, meminta revisi, atau menandai selesai. Komentar, lampiran privat, dan perubahan status dicatat. File maksimal 20 MB per file; tipe file dikontrol oleh bucket. Kedua akun dalam tim dapat melihat tugas, tetapi tombol approval hanya tersedia untuk role manager dan database juga menegakkan pembatasan tersebut.

## Pemulihan dan backup

Aktifkan pengingat backup sendiri. Ekspor tabel penting secara berkala dari Supabase Dashboard/SQL, dan unduh salinan file yang diizinkan dari bucket privat ke media backup terenkripsi yang disetujui. Simpan setidaknya satu salinan terpisah dari akun cloud utama dan uji pemulihan berkala. Jangan menganggap GitHub sebagai backup untuk database atau file upload.

## Batasan

GitHub Pages hanya menyajikan antarmuka. Login, data tugas dan lampiran menggunakan Supabase, dan belum berfungsi sebelum project URL/key di config.js disetel serta schema SQL diterapkan. Ini bukan sistem yang tersertifikasi untuk menangani informasi rahasia negara. Minta persetujuan unit keamanan/IT instansi sebelum memasukkan informasi sensitif apa pun.
