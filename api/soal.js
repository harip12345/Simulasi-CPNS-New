// api/soal.js — POST /api/soal
// Soal tersimpan permanen di Firestore (bukan cache sementara).
// Device lain langsung pakai soal yang sudah ada tanpa generate ulang.

const Groq = require('groq-sdk');

// ─── CORS ─────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ─── Model fallback chain ──────────────────────────────────────
const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

// ─── System Prompts ────────────────────────────────────────────
const PROMPTS = {
  TWK: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Wawasan Kebangsaan (TWK).
Buat soal pilihan ganda berkualitas tinggi tentang: Pancasila, UUD 1945, NKRI, Bhinneka Tunggal Ika, sejarah kemerdekaan, sistem pemerintahan Indonesia. Referensi materi CPNS 2024-2025.
Aturan: satu jawaban benar objektif, 4 pengecoh masuk akal, bahasa Indonesia baku, referensi akurat, topik bervariasi.
Wajib sertakan pembahasanSingkat yang menjelaskan mengapa jawaban benar, dan referensi pasal/sumber.
Output HANYA array JSON (tanpa markdown, tanpa komentar):
[{"id":1,"subtest":"TWK","subtestFull":"Tes Wawasan Kebangsaan","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"B","pembahasanSingkat":"Penjelasan mengapa B benar...","referensi":"Pasal X UUD 1945","nilai":{"benar":5,"salah":0}}]`,

  TIU: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Intelejensi Umum (TIU).
Buat soal untuk: analogi kata, sinonim/antonim (KBBI), deret angka, aritmatika (jual-beli, kecepatan, persentase), silogisme. Referensi materi CPNS 2024-2025.
Aturan: hitung ulang semua jawaban numerik, satu jawaban benar, pengecoh dekat jawaban benar, bisa dikerjakan tanpa kalkulator dalam 2 menit.
Untuk soal hitungan, pembahasanSingkat WAJIB berisi langkah-langkah penyelesaian secara lengkap.
Output HANYA array JSON (tanpa markdown, tanpa komentar):
[{"id":1,"subtest":"TIU","subtestFull":"Tes Intelejensi Umum","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"C","pembahasanSingkat":"Langkah 1: ... Langkah 2: ... Jawaban: C","nilai":{"benar":5,"salah":0}}]`,

  TKP: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Karakteristik Pribadi (TKP).
Buat skenario situasional ASN: pelayanan publik, integritas, kerja tim, inovasi, profesionalisme. Referensi materi CPNS 2024-2025.
Aturan KETAT: semua 5 opsi masuk akal, skor {1,2,3,4,5} masing-masing TEPAT SATU opsi, skenario realistis di kantor pemerintahan.
Sertakan alasanSkor untuk setiap opsi menjelaskan mengapa mendapat skor tersebut.
Output HANYA array JSON (tanpa markdown, tanpa komentar):
[{"id":1,"subtest":"TKP","subtestFull":"Tes Karakteristik Pribadi","tipe":"tkp","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"nilaiOpsi":{"A":3,"B":5,"C":1,"D":4,"E":2},"alasanSkor":{"A":"alasan...","B":"alasan...","C":"alasan...","D":"alasan...","E":"alasan..."}}]`,

  SKB: `Anda adalah pembuat soal CAT CPNS ahli untuk SKB formasi Akuntansi (Analis Keuangan/Auditor/Bendahara).
Materi: Akuntansi Pemerintahan (SAP PP71/2010), Laporan Keuangan Pemerintah (LRA/Neraca/LO/LAK), Keuangan Negara (UU17/2003, UU1/2004), Perpajakan (PPh21/22/23, PPN), Audit (BPK/BPKP/SPKN), APBD (Permendagri77/2020). Referensi CPNS 2024-2025.
Aturan: referensi peraturan masih berlaku, satu jawaban benar, hitung ulang soal hitungan (40%), pengecoh meyakinkan tapi salah teknis.
pembahasanSingkat untuk hitungan WAJIB berisi langkah penyelesaian lengkap. Sertakan referensi UU/PP.
Output HANYA array JSON (tanpa markdown, tanpa komentar):
[{"id":1,"subtest":"SKB","subtestFull":"Seleksi Kompetensi Bidang — Akuntansi","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"C","pembahasanSingkat":"Langkah/penjelasan lengkap...","referensi":"UU No. X Tahun X","nilai":{"benar":5,"salah":0}}]`,
};

const VALID = { skd:['TWK','TIU','TKP'], skb:['SKB'] };

// ─── Firebase REST Helper ──────────────────────────────────────
async function getToken() {
  const { FIREBASE_CLIENT_EMAIL: email, FIREBASE_PRIVATE_KEY: key } = process.env;
  if (!email || !key) return null;
  try {
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const hdr = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
    const pay = Buffer.from(JSON.stringify({
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
      body: new URLSearchParams({
        grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion:`${hdr}.${pay}.${sig}`,
      }),
    });
    return r.ok ? (await r.json()).access_token : null;
  } catch { return null; }
}

function fsUrl(pid, col, doc) {
  return `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${col}/${doc}`;
}

async function fsGet(col, doc) {
  const pid = process.env.FIREBASE_PROJECT_ID;
  if (!pid) return null;
  const token = await getToken();
  if (!token) return null;
  try {
    const r = await fetch(fsUrl(pid, col, doc), {
      headers:{ Authorization:`Bearer ${token}` }
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.fields?.data?.stringValue ? JSON.parse(d.fields.data.stringValue) : null;
  } catch { return null; }
}

async function fsSet(col, doc, data, extraFields = {}) {
  const pid = process.env.FIREBASE_PROJECT_ID;
  if (!pid) return false;
  const token = await getToken();
  if (!token) return false;
  try {
    const fields = {
      data:    { stringValue: JSON.stringify(data) },
      savedAt: { stringValue: new Date().toISOString() },
    };
    Object.entries(extraFields).forEach(([k,v]) => {
      fields[k] = typeof v === 'number' ? { integerValue: v } : { stringValue: String(v) };
    });
    // Build updateMask
    const mask = Object.keys(fields).map(k=>`updateMask.fieldPaths=${k}`).join('&');
    const r = await fetch(`${fsUrl(pid, col, doc)}?${mask}`, {
      method:'PATCH',
      headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ fields }),
    });
    return r.ok;
  } catch(e) { console.warn('fsSet error:', e.message); return false; }
}

// ─── Parse JSON dari Groq ──────────────────────────────────────
function parseGroqJSON(raw) {
  const clean = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
  let parsed = JSON.parse(clean);
  if (Array.isArray(parsed)) return parsed;
  const key = ['questions','soal','data','items']
    .find(k => Array.isArray(parsed[k]))
    || Object.keys(parsed).find(k => Array.isArray(parsed[k]));
  if (key) return parsed[key];
  throw new Error('Tidak ada array soal ditemukan');
}

// ─── Generate dengan model fallback ───────────────────────────
async function generate(groq, subtest, count) {
  const models = process.env.GROQ_MODEL
    ? [process.env.GROQ_MODEL, ...MODELS.filter(m => m !== process.env.GROQ_MODEL)]
    : MODELS;
  
  let lastErr = null;
  
  for (const model of models) {
    try {
      console.log(`Trying: ${model}`);
      const res = await groq.chat.completions.create({
        model,
        messages: [
          { role:'system', content: PROMPTS[subtest] },
          { role:'user',   content: `Buat tepat ${count} soal ${subtest} dengan topik bervariasi. Output HANYA array JSON valid.` },
        ],
        temperature: 0.7, 
        max_tokens: 6000,
        response_format: { type:'json_object' },
      });
      
      const raw = res.choices?.[0]?.message?.content || '';
      if (!raw) throw new Error('Empty response');
      
      const questions = parseGroqJSON(raw);
      if (!questions.length) throw new Error('Empty array');
      
      console.log(`OK: ${model} → ${questions.length} soal`);
      return { questions, model };
      
    } catch(err) {
      console.warn(`Gagal menggunakan ${model}: ${err.message}`);
      
      // Jika error adalah unauthorized/API Key salah, langsung hentikan
      if (err.status === 401) {
        throw err;
      }
      
      // Simpan error terakhir dan lanjutkan ke model berikutnya di array
      // Mencakup error 400 (model decommissioned), 429 (rate limit), 5xx (server error)
      lastErr = err; 
      continue;
    }
  }
  
  // Jika loop selesai tapi tidak ada yang berhasil, lempar error terakhir
  throw new Error('Semua model gagal memproses permintaan: ' + (lastErr?.message || 'Unknown error'));
}

// ─── Main Handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success:false, error:'Gunakan POST.' });

  const { examType, subtest, count:cRaw, batchIndex=0, forceNew=false } = req.body || {};
  const type  = (examType||'').toLowerCase();
  const sub   = (subtest||'').toUpperCase();
  const count = Math.min(15, Math.max(1, parseInt(cRaw||'10', 10)));

  if (!VALID[type])               return res.status(400).json({ success:false, error:'"examType" harus "skd"/"skb".' });
  if (!VALID[type].includes(sub)) return res.status(400).json({ success:false, error:`"subtest" harus: ${VALID[type].join(', ')}.` });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ success:false, error:'GROQ_API_KEY belum diset.' });

  // Dokumen Firestore: soal_bank/skd_TWK_b0, skd_TWK_b1, dst.
  const docId = `${type}_${sub}_b${batchIndex}`;

  // ── Cek database dulu (kecuali forceNew) ──────────────────
  if (!forceNew) {
    try {
      const stored = await fsGet('soal_bank', docId);
      if (stored?.length) {
        console.log(`DB hit: ${docId} (${stored.length} soal)`);
        return res.status(200).json({
          success:true, examType:type, subtest:sub,
          count:stored.length, questions:stored, source:'database',
        });
      }
    } catch(e) { console.warn('DB read error:', e.message); }
  }

  // ── Generate dari Groq ─────────────────────────────────────
  try {
    const groq = new Groq({ apiKey });
    const { questions, model } = await generate(groq, sub, count);

    questions.forEach((q,i) => {
      q.id    = i + 1;
      q.nilai = q.nilai || { benar:5, salah:0 };
    });

    // Simpan permanen ke Firestore
    fsSet('soal_bank', docId, questions, {
      examType: type, subtest: sub, batchIndex, count: questions.length,
    }).then(ok => console.log(`DB save ${ok?'OK':'FAIL'}: ${docId}`))
      .catch(e => console.warn('DB save error:', e.message));

    return res.status(200).json({
      success:true, examType:type, subtest:sub,
      count:questions.length, questions,
      source:'generated', modelUsed:model,
    });
  } catch(err) {
    console.error('Generate error:', err.message);
    if (err.status === 401) return res.status(401).json({ success:false, error:'GROQ_API_KEY tidak valid.' });
    return res.status(500).json({ success:false, error: err.message });
  }
};
