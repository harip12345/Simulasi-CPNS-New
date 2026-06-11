# 🏛️ CAT CPNS API — Bank Soal Berbasis Groq AI

Backend serverless untuk menghasilkan soal ujian CAT CPNS secara dinamis menggunakan **Groq AI (LLaMA 3.3 70B)**. Dirancang untuk di-deploy di **Vercel** dan diintegrasikan dengan frontend simulasi CAT.

---

## 📁 Struktur Proyek

```
cat-cpns-api/
├── api/
│   ├── soal.js          ← Endpoint utama: POST /api/soal
│   ├── preview.js       ← Endpoint testing: GET /api/preview
│   └── health.js        ← Health check: GET /api/health
├── lib/
│   ├── prompts.js       ← System prompt ketat per subtest (TWK/TIU/TKP/SKB)
│   └── utils.js         ← CORS, response helper, Groq client, validator
├── .env.example         ← Template environment variables
├── .gitignore
├── package.json
├── vercel.json
└── README.md
```

---

## 🚀 Cara Deploy ke Vercel

### Langkah 1 — Push ke GitHub

```bash
# Buat repo baru di GitHub, lalu:
git init
git add .
git commit -m "feat: initial CAT CPNS API"
git branch -M main
git remote add origin https://github.com/<username>/<repo-name>.git
git push -u origin main
```

### Langkah 2 — Import ke Vercel

1. Buka [vercel.com](https://vercel.com) → **New Project**
2. Pilih repo GitHub yang baru dibuat
3. Framework Preset: **Other** (bukan Next.js)
4. Klik **Deploy** — Vercel akan detect `vercel.json` otomatis

### Langkah 3 — Set Environment Variables di Vercel

1. Di Vercel Dashboard → Project → **Settings** → **Environment Variables**
2. Tambahkan variabel berikut:

| Variable | Value | Environment |
|---|---|---|
| `GROQ_API_KEY` | `gsk_xxxx...` (dari [console.groq.com](https://console.groq.com/keys)) | Production, Preview, Development |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Production, Preview, Development |
| `MAX_RETRIES` | `2` | Production, Preview, Development |

3. Klik **Save** → **Redeploy** (penting! env vars baru perlu redeploy)

### Langkah 4 — Verifikasi

```bash
# Cek health endpoint
curl https://<nama-project>.vercel.app/api/health

# Preview 2 soal TWK
curl "https://<nama-project>.vercel.app/api/preview?type=skd&subtest=TWK&count=2"

# Generate soal SKD lengkap (hati-hati: memakan waktu & token)
curl -X POST https://<nama-project>.vercel.app/api/soal \
  -H "Content-Type: application/json" \
  -d '{"examType": "skd"}'
```

---

## 📡 API Reference

### `GET /api/health`

Cek status API dan konfigurasi.

**Response sukses:**
```json
{
  "success": true,
  "status": "ok",
  "message": "CAT CPNS API berjalan normal.",
  "checks": {
    "groqApiKey": true,
    "groqModel": "llama-3.3-70b-versatile",
    "environment": "production"
  }
}
```

---

### `POST /api/soal`

Generate soal lengkap untuk satu sesi ujian.

**Request Body:**
```json
{ "examType": "skd" }
```
atau
```json
{ "examType": "skb" }
```

**Response sukses (SKD):**
```json
{
  "success": true,
  "examType": "skd",
  "totalSoal": 110,
  "subtestBreakdown": { "TWK": 30, "TIU": 35, "TKP": 45 },
  "model": "llama-3.3-70b-versatile",
  "questions": [
    {
      "id": 1,
      "subtest": "TWK",
      "subtestFull": "Tes Wawasan Kebangsaan",
      "tipe": "pilihan_ganda",
      "topik": "Nilai-nilai Pancasila",
      "tingkatKesulitan": "sedang",
      "text": "Pancasila sebagai...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "...", "E": "..." },
      "kunciJawaban": "B",
      "pembahasanSingkat": "...",
      "referensi": "Sidang BPUPKI 1 Juni 1945",
      "nilai": { "benar": 5, "salah": 0 }
    },
    {
      "id": 31,
      "subtest": "TKP",
      "tipe": "tkp",
      "aspek": "pelayanan publik",
      "text": "Skenario situasional...",
      "options": { "A": "...", ... },
      "nilaiOpsi": { "A": 3, "B": 5, "C": 1, "D": 4, "E": 2 },
      "alasanSkor": { "A": "...", ... }
    }
  ]
}
```

> ⚠️ **Peringatan:** Request SKD (110 soal) memakan waktu **30–60 detik** dan sekitar **50.000–80.000 token** Groq. Gunakan caching atau pre-generate soal untuk produksi.

---

### `GET /api/preview`

Generate soal dalam jumlah kecil untuk testing kualitas.

**Query params:**

| Param | Wajib | Nilai | Default |
|---|---|---|---|
| `type` | ✅ | `skd` \| `skb` | — |
| `subtest` | ✅ | `TWK` \| `TIU` \| `TKP` \| `SKB` | — |
| `count` | ❌ | `1`–`10` | `2` |

**Contoh:**
```
GET /api/preview?type=skd&subtest=TKP&count=3
GET /api/preview?type=skb&subtest=SKB&count=5
```

---

## 🧠 Arsitektur Sistem Prompt

Setiap subtest memiliki **system prompt terpisah** di `lib/prompts.js` yang:

| Subtest | Keistimewaan Prompt |
|---|---|
| **TWK** | Verifikasi referensi hukum/sejarah, anti-SARA, kunci jawaban objektif |
| **TIU** | Wajib hitung ulang jawaban numerik, validasi KBBI untuk verbal |
| **TKP** | Distribusi skor 1–5 unik, semua opsi masuk akal, tidak ada jawaban "jelas salah" |
| **SKB** | Referensi UU yang masih berlaku, soal aplikatif berbasis kasus |

---

## ⚙️ Development Lokal

```bash
# Clone repo
git clone https://github.com/<username>/<repo>.git
cd cat-cpns-api

# Install dependencies
npm install

# Setup env
cp .env.example .env
# Edit .env, isi GROQ_API_KEY

# Jalankan Vercel dev server
npm run dev
# → API tersedia di http://localhost:3000
```

---

## 💡 Tips Produksi

### 1. Caching Soal (direkomendasikan)
Request ke `/api/soal` memakan waktu lama. Pertimbangkan untuk:
- Pre-generate soal setiap hari via cron job (Vercel Cron)
- Simpan hasilnya di database (Vercel KV, Supabase, MongoDB Atlas)
- Frontend mengambil dari cache, bukan generate real-time

### 2. Monitoring Biaya Groq
Pantau penggunaan token di [console.groq.com](https://console.groq.com).
Groq saat ini **gratis** dengan rate limit yang cukup longgar.

### 3. Proteksi API (opsional)
Tambahkan header `X-API-Key` jika API ini publik:
```javascript
// Di setiap handler, tambahkan:
const apiKey = req.headers['x-api-key'];
if (apiKey !== process.env.INTERNAL_API_KEY) {
  return sendError(res, 'Unauthorized', 401);
}
```

### 4. Vercel Function Timeout
`vercel.json` sudah mengatur `maxDuration: 60` detik.
Untuk Vercel Pro, bisa dinaikkan ke 300 detik jika generate soal lambat.

---

## 🔗 Integrasi dengan Frontend

Di file `cat-cpns-bkn.html`, cari komentar:

```javascript
// ⚙️ TITIK INTEGRASI API ASLI:
```

Ganti fungsi `loadMockData` dengan:

```javascript
async function loadRealData(examType) {
  const res = await fetch('https://<nama-project>.vercel.app/api/soal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ examType })
  });
  if (!res.ok) throw new Error('API error: ' + res.status);
  const data = await res.json();
  return data.questions;
}
```

---

## 📄 Lisensi

MIT — Bebas digunakan untuk keperluan pendidikan dan latihan ujian CPNS.
