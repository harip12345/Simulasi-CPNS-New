const Groq = require('groq-sdk');

// ─── CORS ────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ─── Model fallback chain ─────────────────────────────────────
const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'llama3-8b-8192',
];

// ─── System Prompts ───────────────────────────────────────────
const PROMPTS = {
  TWK: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Wawasan Kebangsaan (TWK).
Buat soal pilihan ganda berkualitas tinggi tentang: Pancasila, UUD 1945, NKRI, Bhinneka Tunggal Ika, sejarah kemerdekaan, sistem pemerintahan Indonesia. Referensi materi CPNS 2024-2025.
Aturan: satu jawaban benar objektif, 4 pengecoh masuk akal, bahasa Indonesia baku, referensi akurat, topik bervariasi tidak mengulang.
Output HANYA array JSON (tanpa markdown, tanpa komentar, tanpa teks lain):
[{"id":1,"subtest":"TWK","subtestFull":"Tes Wawasan Kebangsaan","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"B","nilai":{"benar":5,"salah":0}}]`,

  TIU: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Intelejensi Umum (TIU).
Buat soal untuk: analogi kata, sinonim/antonim (KBBI), deret angka, aritmatika (jual-beli, kecepatan, persentase), silogisme. Referensi materi CPNS 2024-2025.
Aturan: hitung ulang semua jawaban numerik, satu jawaban benar, pengecoh dekat jawaban benar, bisa dikerjakan tanpa kalkulator dalam 2 menit, variasikan tipe soal.
Output HANYA array JSON (tanpa markdown, tanpa komentar, tanpa teks lain):
[{"id":1,"subtest":"TIU","subtestFull":"Tes Intelejensi Umum","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"C","nilai":{"benar":5,"salah":0}}]`,

  TKP: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Karakteristik Pribadi (TKP).
Buat skenario situasional ASN yang mengukur: pelayanan publik, integritas, kerja tim, inovasi, profesionalisme. Referensi materi CPNS 2024-2025.
Aturan KETAT: semua 5 opsi masuk akal (tidak ada yang jelas salah/bodoh), distribusi skor {1,2,3,4,5} masing-masing TEPAT SATU opsi (tidak boleh ada nilai sama), skenario realistis di kantor pemerintahan.
Output HANYA array JSON (tanpa markdown, tanpa komentar, tanpa teks lain):
[{"id":1,"subtest":"TKP","subtestFull":"Tes Karakteristik Pribadi","tipe":"tkp","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"nilaiOpsi":{"A":3,"B":5,"C":1,"D":4,"E":2}}]`,

  SKB: `Anda adalah pembuat soal CAT CPNS ahli untuk SKB formasi Akuntansi (Analis Keuangan/Auditor/Bendahara).
Materi: Akuntansi Pemerintahan (SAP PP71/2010), Laporan Keuangan Pemerintah (LRA/Neraca/LO/LAK), Keuangan Negara (UU17/2003, UU1/2004), Perpajakan (PPh21/22/23, PPN), Audit (BPK/BPKP/SPKN), APBD (Permendagri77/2020), SAI akrual. Referensi CPNS 2024-2025.
Aturan: referensi peraturan masih berlaku, satu jawaban benar secara akuntansi/hukum, hitung ulang soal hitungan, 40% soal hitungan 60% konseptual, pengecoh meyakinkan tapi salah teknis.
Output HANYA array JSON (tanpa markdown, tanpa komentar, tanpa teks lain):
[{"id":1,"subtest":"SKB","subtestFull":"Seleksi Kompetensi Bidang — Akuntansi","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"C","nilai":{"benar":5,"salah":0}}]`,
};

const VALID = { skd:['TWK','TIU','TKP'], skb:['SKB'] };

// ─── Firebase cache helpers ───────────────────────────────────
async function getToken() {
  const { FIREBASE_CLIENT_EMAIL: email, FIREBASE_PRIVATE_KEY: key } = process.env;
  if (!email || !key) return null;
  try {
    const crypto = require('crypto');
    const now    = Math.floor(Date.now() / 1000);
    const hdr    = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
    const pay    = Buffer.from(JSON.stringify({
      iss:email, sub:email,
      aud:'https://oauth2.googleapis.com/token',
      iat:now, exp:now+3600,
      scope:'https://www.googleapis.com/auth/datastore',
    })).toString('base64url');
    const sig = crypto.createSign('RSA-SHA256')
      .update(`${hdr}.${pay}`)
      .sign(key.replace(/\\n/g,'\n'), 'base64url');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${hdr}.${pay}.${sig}`}),
    });
    return r.ok ? (await r.json()).access_token : null;
  } catch { return null; }
}

async function cacheGet(key) {
  const pid = process.env.FIREBASE_PROJECT_ID;
  if (!pid) return null;
  const token = await getToken();
  if (!token) return null;
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/soal_cache/${key}`,
      { headers:{ Authorization:`Bearer ${token}` } });
    if (!r.ok) return null;
    const doc = await r.json();
    return doc.fields?.data?.stringValue ? JSON.parse(doc.fields.data.stringValue) : null;
  } catch { return null; }
}

async function cacheSet(key, data) {
  const pid = process.env.FIREBASE_PROJECT_ID;
  if (!pid) return;
  const token = await getToken();
  if (!token) return;
  try {
    await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/soal_cache/${key}?updateMask.fieldPaths=data&updateMask.fieldPaths=savedAt`, {
      method:'PATCH',
      headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ fields:{
        data:    { stringValue: JSON.stringify(data) },
        savedAt: { stringValue: new Date().toISOString() },
      }}),
    });
  } catch(e) { console.warn('cacheSet error:', e.message); }
}

// ─── Parse JSON dari Groq ─────────────────────────────────────
function parseGroqJSON(raw) {
  const clean = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
  let parsed  = JSON.parse(clean);
  if (Array.isArray(parsed)) return parsed;
  const key = ['questions','soal','data','items']
    .find(k => Array.isArray(parsed[k]))
    || Object.keys(parsed).find(k => Array.isArray(parsed[k]));
  if (key) return parsed[key];
  throw new Error('Tidak ada array soal ditemukan dalam response');
}

// ─── Generate dengan model fallback ──────────────────────────
async function generate(groq, subtest, count) {
  const models = process.env.GROQ_MODEL
    ? [process.env.GROQ_MODEL, ...MODELS.filter(m => m !== process.env.GROQ_MODEL)]
    : MODELS;

  for (const model of models) {
    try {
      console.log(`Trying model: ${model}`);
      const res = await groq.chat.completions.create({
        model,
        messages: [
          { role:'system', content: PROMPTS[subtest] },
          { role:'user',   content: `Buat tepat ${count} soal ${subtest} dengan topik bervariasi. Output HANYA array JSON valid, langsung tanpa teks pembuka atau penutup.` },
        ],
        temperature: 0.7,
        max_tokens:  6000,
        response_format: { type:'json_object' },
      });
      const raw  = res.choices?.[0]?.message?.content || '';
      if (!raw) throw new Error('Empty response');
      const questions = parseGroqJSON(raw);
      if (!questions.length) throw new Error('Empty questions array');
      console.log(`Success: ${model} → ${questions.length} soal`);
      return { questions, model };
    } catch(err) {
      if (err.status === 429 || err.status === 413 || err.status === 503) {
        console.warn(`Model ${model} unavailable (${err.status}), trying next...`);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Semua model Groq tidak tersedia saat ini. Coba beberapa menit lagi.');
}

// ─── Main handler ─────────────────────────────────────────────
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success:false, error:'Gunakan POST.' });

  const { examType, subtest, count:countRaw, batchIndex=0, forceNew=false } = req.body || {};
  const type  = (examType||'').toLowerCase();
  const sub   = (subtest||'').toUpperCase();
  const count = Math.min(15, Math.max(1, parseInt(countRaw||'10', 10)));

  if (!VALID[type])              return res.status(400).json({ success:false, error:'"examType" harus "skd" atau "skb".' });
  if (!VALID[type].includes(sub)) return res.status(400).json({ success:false, error:`"subtest" harus: ${VALID[type].join(', ')}.` });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ success:false, error:'GROQ_API_KEY belum diset di Vercel Environment Variables.' });

  // Cek cache
  const cacheKey = `${type}_${sub}_b${batchIndex}`;
  if (!forceNew) {
    try {
      const cached = await cacheGet(cacheKey);
      if (cached?.length) {
        console.log(`Cache hit: ${cacheKey}`);
        return res.status(200).json({ success:true, examType:type, subtest:sub, count:cached.length, questions:cached, source:'cache' });
      }
    } catch(e) { console.warn('Cache read error:', e.message); }
  }

  // Generate
  try {
    const groq = new Groq({ apiKey });
    const { questions, model } = await generate(groq, sub, count);

    questions.forEach((q,i) => {
      q.id    = i + 1;
      q.nilai = q.nilai || { benar:5, salah:0 };
    });

    // Simpan cache async
    cacheSet(cacheKey, questions).catch(() => {});

    return res.status(200).json({ success:true, examType:type, subtest:sub, count:questions.length, questions, source:'generated', modelUsed:model });

  } catch(err) {
    console.error('Generate error:', err.message);
    if (err.status === 401) return res.status(401).json({ success:false, error:'GROQ_API_KEY tidak valid.' });
    return res.status(500).json({ success:false, error: err.message });
  }
};
