// =============================================================================
// api/soal.js — POST /api/soal
// Body: { examType, subtest, count, forceNew? }
//
// Fitur:
//  1. Auto-select model Groq terbaik yang available (fallback chain)
//  2. Cache soal di Firebase Firestore — generate hanya jika belum ada
//  3. forceNew: true → paksa generate soal baru & timpa cache
//  4. SKB khusus materi Akuntansi (sesuai formasi CPNS Akuntansi)
// =============================================================================

const { handleCors, sendSuccess, sendError, createGroqClient, safeParseJSON } = require('../lib/utils');

// ─── Model Groq — urutan prioritas (terbaik → tercepat) ──────────────────────
// Sistem akan mencoba dari atas ke bawah hingga ada yang berhasil.
// Tambah/hapus model di sini sesuai ketersediaan di console.groq.com
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',   // Terbaik — reasoning kuat, lambat
  'llama-3.1-70b-versatile',   // Alternatif 70B
  'llama-3.1-8b-instant',      // Cepat, hemat token
  'llama3-70b-8192',           // Legacy 70B
  'llama3-8b-8192',            // Legacy 8B — last resort
];

// ─── System Prompts per subtest ───────────────────────────────────────────────
const SYSTEM_PROMPTS = {
  TWK: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Wawasan Kebangsaan (TWK).
Buat soal pilihan ganda berkualitas tinggi tentang: Pancasila, UUD 1945, NKRI, Bhinneka Tunggal Ika, sejarah kemerdekaan, sistem pemerintahan Indonesia.
Aturan ketat:
- Satu jawaban benar secara objektif dan tidak ambigu
- 4 pengecoh masuk akal namun jelas salah bagi yang paham
- Bahasa Indonesia baku sesuai PUEBI
- Referensi hukum/sejarah akurat dan terverifikasi
- Topik bervariasi, tidak mengulang soal yang sama
Output HANYA array JSON tanpa markdown, tanpa komentar:
[{"id":1,"subtest":"TWK","subtestFull":"Tes Wawasan Kebangsaan","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"B","nilai":{"benar":5,"salah":0}}]`,

  TIU: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Intelejensi Umum (TIU).
Buat soal pilihan ganda untuk: analogi kata, sinonim/antonim (KBBI), deret angka, aritmatika (jual-beli, kecepatan, persentase, campuran), silogisme, penalaran logis.
Aturan ketat:
- WAJIB hitung ulang semua jawaban numerik dari awal sebelum output
- Satu jawaban benar secara matematis/logis yang tidak bisa dibantah
- Pengecoh berupa hasil perhitungan dengan kesalahan umum (lupa konversi, salah operasi)
- Semua soal bisa dikerjakan tanpa kalkulator dalam 2 menit
- Variasikan antara soal verbal, numerik, dan logika
Output HANYA array JSON tanpa markdown, tanpa komentar:
[{"id":1,"subtest":"TIU","subtestFull":"Tes Intelejensi Umum","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"C","nilai":{"benar":5,"salah":0}}]`,

  TKP: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Karakteristik Pribadi (TKP).
Buat skenario situasional realistis di lingkungan kerja ASN yang mengukur: pelayanan publik prima, integritas dan anti-korupsi, kerja tim dan kolaborasi, inovasi dan kreativitas, profesionalisme.
Aturan KETAT yang tidak boleh dilanggar:
- Semua 5 opsi HARUS masuk akal sebagai pilihan nyata (tidak ada yang jelas bodoh atau melanggar hukum)
- Distribusi skor: nilai {1,2,3,4,5} masing-masing tepat SATU opsi — tidak boleh ada nilai yang sama
- Skor 5 = terbaik (proaktif, berintegritas, berorientasi solusi)
- Skor 4 = baik tapi kurang satu nuansa dari skor 5
- Skor 3 = cukup, ada upaya positif tapi terbatas
- Skor 2 = kurang tepat, cenderung pasif
- Skor 1 = tidak tepat tapi tidak ilegal
- Skenario harus cukup kompleks sehingga pilihan tidak terlalu obvious
Output HANYA array JSON tanpa markdown, tanpa komentar:
[{"id":1,"subtest":"TKP","subtestFull":"Tes Karakteristik Pribadi","tipe":"tkp","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"nilaiOpsi":{"A":3,"B":5,"C":1,"D":4,"E":2}}]`,

  // ── SKB AKUNTANSI ───────────────────────────────────────────────────────────
  // Sesuai kisi-kisi BKN untuk formasi Analis Keuangan / Auditor / Akuntan
  SKB: `Anda adalah pembuat soal CAT CPNS ahli untuk Seleksi Kompetensi Bidang (SKB) formasi Akuntansi.
Target peserta: lulusan S1 Akuntansi yang melamar jabatan Analis Keuangan, Auditor, Bendahara, atau Verifikator Keuangan di instansi pemerintah.

Materi yang harus dicakup (rotasikan secara merata):
1. Akuntansi Pemerintahan
   - Standar Akuntansi Pemerintahan (SAP) — PP No. 71 Tahun 2010
   - Sistem Akuntansi Instansi (SAI) — akrual basis
   - Laporan Keuangan Pemerintah: LRA, Neraca, LO, LPE, LAK, CaLK
   - Jurnal akrual dan kas basis di pemerintahan
2. Akuntansi Keuangan Umum
   - Siklus akuntansi: jurnal, buku besar, neraca saldo, laporan keuangan
   - Aset tetap: perolehan, penyusutan, pelepasan
   - Piutang, persediaan, liabilitas
   - Ekuitas dan perubahan ekuitas
3. Perpajakan
   - PPh Pasal 21, 22, 23, 25, 29
   - PPN dan PPnBM
   - Pajak Daerah dan Retribusi
4. Penganggaran & Keuangan Negara
   - UU No. 17 Tahun 2003 tentang Keuangan Negara
   - UU No. 1 Tahun 2004 tentang Perbendaharaan Negara
   - Mekanisme APBN/APBD: penyusunan, pelaksanaan, pertanggungjawaban
   - DIPA, RKA-KL, SP2D, SPM
5. Audit & Pengawasan
   - Standar audit pemerintahan (SPKN)
   - Peran BPK, BPKP, Inspektorat
   - Jenis-jenis opini audit
   - Temuan audit dan tindak lanjut
6. Manajemen Keuangan Daerah
   - Permendagri No. 77 Tahun 2020
   - Struktur APBD, pendapatan daerah, belanja daerah
   - Dana Transfer: DAU, DAK, DBH

Aturan ketat:
- Referensi peraturan yang MASIH BERLAKU per 2024 (cek apakah sudah direvisi)
- Satu jawaban benar secara akuntansi/hukum yang tidak bisa dibantah
- Untuk soal hitungan: HITUNG ULANG jawaban sebelum output, cantumkan angka yang bersih
- Pengecoh harus berupa jawaban yang terlihat meyakinkan tapi salah secara teknis
- Variasikan antara soal konseptual (60%) dan soal hitungan (40%)
- Tingkat kesulitan: sedang (50%) dan sulit (50%)
Output HANYA array JSON tanpa markdown, tanpa komentar:
[{"id":1,"subtest":"SKB","subtestFull":"Seleksi Kompetensi Bidang — Akuntansi","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"C","nilai":{"benar":5,"salah":0}}]`,
};

const VALID_SUBTESTS = {
  skd: ['TWK', 'TIU', 'TKP'],
  skb: ['SKB'],
};

// ─── Firebase REST API Helper ─────────────────────────────────────────────────
// Menggunakan Firebase Admin REST API agar tidak perlu install SDK besar.
// Env vars yang dibutuhkan di Vercel:
//   FIREBASE_PROJECT_ID    — dari Firebase Console → Project Settings
//   FIREBASE_CLIENT_EMAIL  — dari Service Account JSON
//   FIREBASE_PRIVATE_KEY   — dari Service Account JSON (dengan \n diganti newline)

async function getFirebaseToken() {
  const { FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) return null;

  // Buat JWT untuk Firebase Admin
  const crypto = require('crypto');
  const now    = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: FIREBASE_CLIENT_EMAIL,
    sub: FIREBASE_CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  })).toString('base64url');

  const privateKey = FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const sign       = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(privateKey, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  // Tukar JWT dengan access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) return null;
  const tokenData = await tokenRes.json();
  return tokenData.access_token || null;
}

// Firestore collection: soal_cache/{examType}_{subtest}_{batchIndex}
async function firestoreGet(docPath) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) return null;

  const token = await getFirebaseToken();
  if (!token) return null;

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;

  const doc = await res.json();
  if (!doc.fields) return null;

  // Parse Firestore value format ke JS object
  return JSON.parse(doc.fields.data?.stringValue || 'null');
}

async function firestoreSet(docPath, data) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) return false;

  const token = await getFirebaseToken();
  if (!token) return false;

  const url  = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
  const body = {
    fields: {
      data:      { stringValue: JSON.stringify(data) },
      createdAt: { stringValue: new Date().toISOString() },
      examType:  { stringValue: data[0]?.subtest || '' },
    },
  };

  const res = await fetch(url + '?updateMask.fieldPaths=data&updateMask.fieldPaths=createdAt&updateMask.fieldPaths=examType', {
    method:  'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  return res.ok;
}

// ─── Auto Model Selector ──────────────────────────────────────────────────────
// Coba model satu per satu sampai berhasil.
async function generateWithFallback(groq, systemPrompt, userPrompt) {
  const models = process.env.GROQ_MODEL
    ? [process.env.GROQ_MODEL, ...GROQ_MODELS.filter(m => m !== process.env.GROQ_MODEL)]
    : GROQ_MODELS;

  let lastError = null;

  for (const model of models) {
    try {
      console.log(`[soal.js] Mencoba model: ${model}`);
      const completion = await groq.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        temperature:     0.7,
        max_tokens:      6000,
        response_format: { type: 'json_object' },
      });

      const raw = completion.choices?.[0]?.message?.content || '';
      if (!raw) throw new Error('Response kosong');

      let parsed = safeParseJSON(raw);
      if (!Array.isArray(parsed)) {
        const key = ['questions','soal','data'].find(k => Array.isArray(parsed[k]))
          || Object.keys(parsed).find(k => Array.isArray(parsed[k]));
        parsed = key ? parsed[key] : [];
      }
      if (!parsed.length) throw new Error('Array soal kosong');

      console.log(`[soal.js] Berhasil dengan model: ${model} (${parsed.length} soal)`);
      return { questions: parsed, model };

    } catch (err) {
      // Rate limit → skip model ini, coba berikutnya
      if (err.status === 429 || err.status === 413) {
        console.warn(`[soal.js] Model ${model} tidak available (${err.status}), mencoba berikutnya...`);
        lastError = err;
        continue;
      }
      // Error lain (401, parse error) → lempar langsung
      throw err;
    }
  }

  throw new Error(`Semua model Groq tidak available. Error terakhir: ${lastError?.message}`);
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendError(res, 'Gunakan POST.', 405);

  const {
    examType,
    subtest,
    count: countRaw,
    batchIndex = 0,   // Urutan batch (untuk cache key unik)
    forceNew   = false, // true = bypass cache, generate soal baru
  } = req.body || {};

  const type  = (examType || '').toLowerCase();
  const sub   = (subtest  || '').toUpperCase();
  const count = Math.min(15, Math.max(1, parseInt(countRaw || '10', 10)));

  if (!VALID_SUBTESTS[type])               return sendError(res, '"examType" harus "skd" atau "skb".', 400);
  if (!VALID_SUBTESTS[type].includes(sub)) return sendError(res, `"subtest" harus: ${VALID_SUBTESTS[type].join(', ')}.`, 400);

  // ── Cek cache Firebase (kecuali forceNew) ──────────────────────────────────
  const cacheKey = `soal_cache/${type}_${sub}_batch${batchIndex}`;

  if (!forceNew) {
    try {
      const cached = await firestoreGet(cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        console.log(`[soal.js] Cache hit: ${cacheKey} (${cached.length} soal)`);
        return sendSuccess(res, {
          examType: type, subtest: sub,
          count: cached.length,
          questions: cached,
          source: 'cache',
        });
      }
    } catch (e) {
      console.warn('[soal.js] Cache read gagal (lanjut generate):', e.message);
    }
  }

  // ── Generate soal baru dari Groq ───────────────────────────────────────────
  try {
    const groq       = createGroqClient();
    const userPrompt = `Buat tepat ${count} soal ${sub} dengan topik yang bervariasi dan tidak mengulang. Output HANYA array JSON valid.`;
    const { questions, model } = await generateWithFallback(groq, SYSTEM_PROMPTS[sub], userPrompt);

    // Normalisasi
    questions.forEach((q, i) => {
      q.id    = i + 1;
      q.nilai = q.nilai || { benar: 5, salah: 0 };
    });

    // Simpan ke Firebase (async, tidak blokir response)
    firestoreSet(cacheKey, questions)
      .then(ok => console.log(`[soal.js] Cache ${ok ? 'tersimpan' : 'gagal simpan'}: ${cacheKey}`))
      .catch(e  => console.warn('[soal.js] Cache write error:', e.message));

    return sendSuccess(res, {
      examType: type, subtest: sub,
      count: questions.length,
      questions,
      source: 'generated',
      modelUsed: model,
    });

  } catch (err) {
    if (err.status === 401) return sendError(res, 'GROQ_API_KEY tidak valid.', 401);
    return sendError(res, 'Gagal generate soal: ' + err.message, 500);
  }
};
