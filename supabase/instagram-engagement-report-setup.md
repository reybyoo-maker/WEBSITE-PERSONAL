# Instagram Engagement Report — username-only public lookup

Panel Ruang Kerja meminta username publik Instagram, lalu mencoba membaca data yang terlihat pada profil publik. Pengguna tidak perlu memasukkan password Instagram, kode OTP, Meta access token, atau ID akun Meta.

## Deploy backend satu kali
Backend ini memakai Supabase Edge Function untuk menghindari masalah CORS browser. Dari direktori repository yang sudah terhubung ke Supabase CLI, jalankan:
\`\`\`bash
supabase functions deploy instagram-engagement-report --project-ref edgzffkhjtzejxjbtqib
\`\`\`
Tidak dibutuhkan secret Meta untuk versi username-only.

## Batasan
- Hanya akun publik yang bisa dibaca.
- Likes dan comments dipaparkan jika endpoint publik Instagram menyediakannya.
- Share dan repost tidak tersedia secara andal dari username publik; ditandai — di panel.
- Instagram dapat membatasi atau mengubah endpoint publik kapan saja; ketika dibatasi, panel akan menampilkan pesan dan bukan angka palsu.
