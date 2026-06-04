# Instagram Bulk Downloader

Electron desktop app untuk preview dan download konten Instagram menggunakan cookies login pengguna.

## Fitur

- Preview posts, stories, dan highlights.
- Preview popup dengan navigasi slide untuk carousel post dan isi highlight.
- Download satu per satu dari popup preview.
- Untuk video, tersedia download video dan download thumbnail sebagai image.
- Bulk download per kategori: posts, stories, highlights, atau semua.
- Saved targets dan saved cookies dipisah.
- Dark mode.
- Output download otomatis dipisah per target dan jenis media.

## Struktur Data Lokal

Saved target dan saved cookies disimpan sebagai JSON di folder project saat mode dev:

```text
data/targets.json
data/cookies.json
```

Pada build portable Windows, folder `data` dibuat di folder yang sama dengan file `.exe`.

Hasil download disimpan dengan struktur:

```text
downloads/
  target-username/
    gambar/
    video/
```

## Teknologi dan Repo yang Digunakan

- Electron: runtime desktop app.
  Repo: https://github.com/electron/electron
- electron-builder: build portable Windows.
  Repo: https://github.com/electron-userland/electron-builder
- axios: request HTTP dari proses Electron.
  Repo: https://github.com/axios/axios
- fs-extra: operasi file/folder yang lebih praktis.
  Repo: https://github.com/jprichardson/node-fs-extra
- Instaloader: bridge Python untuk akses/download konten Instagram.
  Repo: https://github.com/instaloader/instaloader
- Python embeddable/portable runtime untuk menjalankan `downloader.py` pada Windows.
  Sumber: https://www.python.org/downloads/windows/

## Cara Menjalankan Mode Dev

```powershell
npm install
npm start
```

Pastikan folder `python-portable` sudah ada dan sudah memiliki dependency Python yang dibutuhkan, terutama `instaloader` dan `requests`.

## Build Windows Portable

```powershell
npm run build:win
```

Artifact build akan dibuat di folder:

```text
dist/
```

## Catatan Cookies

App ini membutuhkan cookies Instagram dari sesi login pengguna. Cookies disimpan lokal di file `data/cookies.json` dan tidak dikirim ke server pihak ketiga oleh app ini, selain digunakan untuk request ke Instagram.
