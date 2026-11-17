# Design System — Jasvero Virtual Office

Panduan wajib agen FE & auditor UI/UX. Patuh ke dokumen ini sebelum mengubah tampilan.

## Prinsip

- **Mobile-first.** Semua layar harus benar di 390×844 sebelum dianggap selesai. Konten tidak boleh ketutup bottom nav atau kolom input.
- **Konsisten.** Warna, jarak, radius, dan gaya komponen diambil dari token di bawah — jangan hardcode nilai baru kalau sudah ada token.
- **Santai tapi rapi.** Tema retro Stardew: palet earthy, font pixel untuk angka/label, sans untuk paragraf.
- **Aksesibel.** Kontras teks minimal 4.5:1, target sentuh ≥ 40px, fokus keyboard terlihat (`--line-focus`).

## Warna (token CSS di `public/styles.css`)

| Token | Nilai | Pemakaian |
| --- | --- | --- |
| `--bg` | `#0c1017` | Latar utama (gelap) |
| `--panel` | `#151b24` | Kartu |
| `--panel2` | `#1c2430` | Area dalam kartu / chip |
| `--panel3` | `#242e3d` | Hover / elevasi |
| `--line` | `rgba(255,255,255,.08)` | Border halus |
| `--line2` | `rgba(255,255,255,.15)` | Border lebih tegas |
| `--txt` | `#f1f5f9` | Teks utama |
| `--txt-muted` | `#94a3b8` | Teks kedua |
| `--txt-dim` | `#64748b` | Teks tersier / timestamp |
| `--acc` | `#10b981` | Aksen utama (emerald) |
| `--warm` | `#f59e0b` | Status sibuk / peringatan |
| `--cyan` / `--violet` / `--rose` / `--blue` | — | Aksen per agen / kategori |
| `--ok` / `--warn` | — | Status sukses / peringatan |

Semua agen punya tema warna sendiri di `AGENT_THEMES` (`public/js/core.js`); pakai tema itu untuk avatar, badge, dan identitas agen.

## Tipografi

- Font pixel (VT323 / Press Start 2P) untuk judul, angka besar, label status — bukan untuk paragraf.
- Sans (system UI) untuk paragraf dan UI.
- Skala: judul 20–28px, sub 14–16px, isi 13–14px, caption 10–11px.
- Hierarki: judul (`--txt`, 700), isi (`--txt`), meta (`--txt-muted`), timestamp (`--txt-dim`).

## Spasi & Radius

- Satuan dasar **4px** (4 / 8 / 12 / 16 / 24 / 32).
- Padding kartu: 12–16px; gap antar elemen 8–12px.
- Radius: chip/pill 999px, kartu 12–16px, tombol 8–10px.
- Bar navigasi mobile (`bottomnav`) tinggi ±68px — konten scroll harus berhenti di atasnya.

## Komponen

- **Kartu**: `background: var(--panel)`, `border: 1px solid var(--line)`, radius 14px.
- **Chip/filter**: pill, `--panel2`, aktif = `rgba(var(--acc-rgb),.14)` + border `--line-focus`.
- **Badge**: pill uppercase 9–10px, warna per konteks (user biru, agen hijau, sibuk amber).
- **Tombol**: radius 8–10px, hover naikkan ke `--panel3`, fokus pakai `--line-focus`.
- **Empty state**: kartu putus-putus (`1px dashed var(--line2)`), teks `--txt-muted`, sejajar tengah.
- **Scroll internal**: area daftar (feed/log/board) `overflow-y: auto` dengan `min-height: 0`; jangan pernah mendorong elemen lain keluar layar.

## Layout & Responsif

- Breakpoint mobile `max-width: 860px`.
- Desktop: sidebar kiri; mobile: bottom nav (Home, Kantor, Chat AI, Log, Board, Monitor).
- Tinggi view mobile: `calc(100dvh - 280px)` (sisakan bottom nav); desktop: `calc(100dvh - 190px)`.
- Kolom chat: feed scroll internal, header + saran + input `flex-shrink: 0`. Input harus selalu terlihat.

## Motion

- Durasi 150–250ms, easing halus; status bubble animasi pendek.
- Hormati `prefers-reduced-motion` — matikan animasi.

## Checklist Audit (wajib sebelum task FE ditutup)

1. Screenshot **mobile 390×844** dan **desktop 1280×900** — tidak ada yang terpotong / tumpang tindih.
2. Kolom input / bottom nav tidak menutupi konten.
3. Scroll terjadi di dalam area daftar, bukan memanjangkan halaman.
4. Warna & radius pakai token, bukan nilai acak.
5. Spasi kelipatan 4px; hierarki teks jelas.
6. Status badge konsisten (user/agen/sibuk) dan timestamp `timeAgo`.
7. Empty state ada untuk daftar kosong.
8. Fokus keyboard & kontras teks lolos.
