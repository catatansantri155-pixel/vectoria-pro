# Vectoria Pro · Vektora Studio

Konverter JPG, PNG, WebP, BMP, GIF, dan AVIF dengan pemrosesan lokal. GIF diproses sebagai satu gambar. Format yang dapat dibuka mengikuti decoder browser. Batas masukan 20 MB per file dan 60 MP. Maksimal 30 gambar diproses berurutan dalam satu sesi.

## Studio

- **Vektor** menangkap kontur sebagai path. Pilih mode warna atau monokrom, atur detail, warna, ambang, pembersihan bintik dan latar putih, lalu bandingkan hasil. Zoom berpusat pada pratinjau. Hasil dapat diekspor sebagai SVG, EPS, PDF, PNG, atau JPG.
- **Lembar ikon** membagi gambar menjadi kisi hingga 8 × 8 dengan sel sama besar. Hasil batch dan potongan diunduh sebagai ZIP berisi SVG individual. Unggah file SVG atau EPS satu per satu ke Adobe Stock.
- **Perbesar** memakai interpolasi browser dan penajaman tepi opsional. Resolusi keluaran dibatasi 16 MP untuk mengendalikan memori.
- **Pola** membantu membuat ubin dengan pengulangan biasa atau cermin empat arah.
- **Gradien** membuat gradien bertekstur opsional dengan empat palet, rasio, dan arah yang dapat diedit. Ekspor loop empat detik tersedia jika browser mendukung MediaRecorder dan Canvas CaptureStream.
- **Editor gambar** di `editor.html` tetap menggunakan penyimpanan proyek browser dari versi sebelumnya.

## Hasil HD

**Kurva halus** memasang kurva Bézier pada batas yang dipakai bersama oleh dua warna, dengan mempertahankan sudut penting. Matikan jika gambar memang membutuhkan tepi piksel. **Trace HD** menambah kerapatan sampel sebelum pelacakan. SVG, EPS, dan PDF menyimpan bentuk vektor. Untuk PNG/JPG, pilih **Full HD, QHD, atau 4K** di pengaturan ekspor. Nilai tersebut berlaku pada sisi terpanjang dan gambar tetap proporsional. PNG/JPG dirender langsung dari hasil vektor. Resolusi yang lebih besar membantu menghaluskan bentuk yang dikenali, sementara detail yang sudah hilang pada sumber tidak bisa dipulihkan.

## Cara kerja

1. `converter.mjs` mendekode gambar, mengambil piksel dan mengatur antrean serta perbandingan.
2. `trace-worker.mjs` menjalankan kuantisasi warna, pembersihan bintik, pelacakan kontur dan simplifikasi titik melalui `trace.mjs`. Trace HD menggunakan sampel hingga 2× lebih rapat sebelum tracing, dengan batas sisi terpanjang 2.400 px dan luas 4,5 MP. Foto, gradien halus, dan tekstur berubah menjadi bidang warna. Transparansi diproses sebagai masker biner. Fokus hasil adalah ikon, logo, dan ilustrasi.
3. `formats.mjs` menulis path SVG, PostScript EPS, PDF dan ZIP lokal. Preset Adobe Stock menyesuaikan ukuran artboard sekitar 16 MP dengan mempertahankan proporsi. Ukuran artboard berbeda dari resolusi yang digunakan untuk tracing.
4. `utilities.mjs` berisi pengolahan raster dan perekaman gradien. `sw.js` menyimpan aset aplikasi untuk akses offline setelah pemasangan berhasil di browser. Gambar sumber, antrean, dan hasil konversi tetap dalam memori selama halaman aktif.

## Deploy ke Cloudflare Pages

1. Di dashboard Cloudflare, buka **Workers & Pages → Create application → Pages → Import an existing Git repository**.
2. Hubungkan GitHub, pilih `catatansantri155-pixel/vectoria-pro`, lalu pilih **Begin setup**.
3. Isi pengaturan build berikut, lalu pilih **Save and Deploy**.

| Pengaturan | Nilai |
|---|---|
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `exit 0` |
| Build output directory | `dist` |
| Root directory | Kosongkan agar memakai root repo |
| Environment variables | Kosongkan |

Aplikasi statis ini berjalan tanpa npm install, database, atau kunci API. Cloudflare memberikan alamat `pages.dev` setelah deployment berhasil. Pembaruan ke `main` akan memicu deployment produksi saat integrasi Git aktif.

Cloudflare melayani editor di `/editor` setelah mengalihkan dari `/editor.html`. Service worker mengenali kedua alamat agar editor tetap bisa dibuka saat offline setelah cache berhasil dipasang. File `dist/_headers` mengatur pemeriksaan ulang service worker saat ada versi baru.

Deployment Pages standar melayani aplikasi secara publik. Publikasikan fitur ini di domain dengan akses terbatas jika studio perlu tetap privat. Gambar yang dipilih tetap diproses di browser pengguna.

[Rujukan Cloudflare Pages untuk situs statis](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)

## Jalankan secara lokal

Dari root repo, jalankan:

```sh
python -m http.server 8000 --directory dist
```

Buka [localhost:8000](http://localhost:8000/). Untuk uji cepat, klik **Coba contoh**, periksa pratinjau, unduh SVG, dan buka **Editor gambar**. Adobe menilai aset secara independen dari preset ukuran aplikasi.


### Ilustrasi 3D dan file gambar
- Gaya pelacakan Otomatis mendeteksi gambar dengan banyak tingkatan warna. Mode Ilustrasi 3D memasang palet yang lebih rapat dan gradien vektor lokal. Pilih SVG untuk menyimpan gradien yang bisa diedit atau PNG/JPG untuk tampilan raster. EPS/PDF masih menggunakan warna datar.
- Vektora membaca tanda format di dalam file dan mencoba jalur pemuatan biasa jika dekode langsung gagal. Format yang tidak didukung tetap bergantung pada dekoder browser. Ekspor ulang file yang gagal sebagai PNG atau JPG.
- Studio Perbesar memiliki ekspor 4K dan interpolasi Lanczos atau Mitchell–Netravali untuk gambar yang sesuai batas memori. Perbesaran tidak merekonstruksi detail yang hilang.
