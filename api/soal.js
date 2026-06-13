// api/soal.js — POST /api/soal
// Soal tersimpan PERMANEN di Firestore koleksi soal_bank.
// Device lain langsung pakai soal yang sama tanpa generate ulang.
// forceNew=true → generate baru dan timpa database.

const Groq = require('groq-sdk');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'llama3-8b-8192',
];

// ─── SYSTEM PROMPTS — Expert Level, Anti-Repetisi ─────────────
const PROMPTS = {
  TWK: `Anda adalah Tim Penyusun Soal Senior BKN dengan 15 tahun pengalaman membuat soal CPNS tingkat EXPERT.

STANDAR KUALITAS EXPERT (WAJIB):
- Tingkat kesulitan: SULIT dan SANGAT SULIT (80% sulit, 20% sangat sulit)
- DILARANG membuat soal hafalan sederhana (siapa tokoh X, kapan tanggal Y)
- Soal WAJIB mengukur pemahaman mendalam, analisis, dan penerapan konsep
- Gunakan kasus nyata, konteks kontemporer, atau skenario kompleks
- Pengecoh HARUS sangat meyakinkan — bahkan peserta yang cukup paham bisa terkecoh

TOPIK EXPERT yang harus dicakup (rotasi ketat, JANGAN ULANGI topik yang sama):
- Analisis pasal UUD 1945 dalam konteks kasus hukum nyata
- Implementasi nilai Pancasila dalam kebijakan publik kontroversial
- Perbandingan sistem pemerintahan Indonesia dengan negara lain
- Sejarah diplomatik dan perjanjian internasional Indonesia
- Penafsiran hukum tata negara yang kompleks dan multi-tafsir
- Otonomi daerah, konflik kewenangan pusat-daerah
- Wawasan Nusantara dalam konteks geopolitik modern
- Ketahanan nasional menghadapi ancaman non-militer (siber, ekonomi, ideologi)
- Mahkamah Konstitusi, judicial review, dan putusan landmark
- Sistem pemilihan umum, demokrasi deliberatif, dan representasi

ANTI-REPETISI: Setiap soal WAJIB mengangkat aspek yang berbeda dari topik berbeda.
Jika soal tentang Pancasila, fokus pada satu sila spesifik dengan konteks yang unik.

STRUKTUR PENGECOH EXPERT:
- Pengecoh A-E harus semua tampak benar pada pandangan pertama
- Perbedaan antara jawaban benar dan pengecoh terbaik hanya pada satu kata/frasa kunci
- Hindari pengecoh yang jelas salah secara logika

Output HANYA array JSON valid (tanpa markdown, tanpa komentar, tanpa teks lain):
[{"id":1,"subtest":"TWK","subtestFull":"Tes Wawasan Kebangsaan","tipe":"pilihan_ganda",
"tingkatKesulitan":"sulit","topik":"spesifik topik soal ini",
"text":"teks soal lengkap dan kompleks",
"options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},
"kunciJawaban":"B",
"pembahasanSingkat":"Penjelasan mendalam mengapa B benar dan mengapa pengecoh lain salah",
"referensi":"Pasal/UU/Sejarah yang spesifik",
"nilai":{"benar":5,"salah":0}}]`,

  TIU: `Anda adalah Tim Penyusun Soal Senior BKN dengan 15 tahun pengalaman membuat soal TIU tingkat EXPERT.

STANDAR KUALITAS EXPERT (WAJIB):
- Tingkat kesulitan: SULIT dan SANGAT SULIT
- Soal numerik: multi-langkah, membutuhkan 2-4 tahap perhitungan
- Soal verbal: sinonim/antonim kata-kata tidak umum, analogi kompleks
- Soal logika: silogisme multi-premis, penalaran kondisional bersarang
- DILARANG soal satu langkah atau definisi sederhana

VARIASI TIPE EXPERT (rotasi ketat):
1. Aritmatika kompleks: persentase bertingkat, bunga majemuk, campuran dua zat
2. Deret angka: pola fibonacci modifikasi, deret kuadrat-kubik, pola alternating
3. Analogi kata tingkat lanjut: hubungan kausalitas, hierarki konsep abstrak  
4. Silogisme: 3+ premis, negasi, kontraposisi
5. Soal cerita: kondisi simultan, sistem persamaan 2-3 variabel
6. Perbandingan senilai/berbalik nilai dalam konteks kompleks
7. Peluang dasar: kombinasi kejadian, dengan/tanpa pengembalian
8. Geometri analitik sederhana: jarak, luas, volume

WAJIB: Hitung ulang semua jawaban dari nol sebelum output.
Cantumkan langkah lengkap di pembahasanSingkat untuk soal hitungan.

Output HANYA array JSON valid:
[{"id":1,"subtest":"TIU","subtestFull":"Tes Intelejensi Umum","tipe":"pilihan_ganda",
"tingkatKesulitan":"sulit","kategori":"numerik/verbal/logika",
"text":"soal kompleks",
"options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},
"kunciJawaban":"C",
"pembahasanSingkat":"Langkah 1: ... Langkah 2: ... Langkah 3: ... Jawaban: C karena ...",
"nilai":{"benar":5,"salah":0}}]`,

  TKP: `Anda adalah Tim Psikometri Senior BKN dengan keahlian menyusun soal TKP tingkat EXPERT untuk seleksi CPNS.

STANDAR EXPERT TKP:
- Skenario KOMPLEKS dengan dilema etika nyata — bukan situasi hitam-putih
- Setiap skenario melibatkan KONFLIK antara dua nilai ASN yang sama-sama penting
  (misal: efisiensi vs prosedur, loyalitas vs integritas, pelayanan vs aturan)
- Semua 5 opsi HARUS terlihat benar — peserta yang tidak cermat pasti salah
- Perbedaan skor 4 dan 5 hanya pada satu nuansa tindakan yang halus
- DILARANG skenario dangkal yang jawabannya obvious

ASPEK YANG DIUKUR (rotasi ketat, setiap soal satu aspek berbeda):
1. Integritas menghadapi tekanan atasan yang tidak etis
2. Inovasi vs kepatuhan prosedur birokrasi
3. Konflik kepentingan pribadi vs kepentingan publik
4. Pengelolaan tim dengan anggota bermasalah
5. Respons terhadap keluhan publik yang viral/media
6. Pengambilan keputusan dengan data tidak lengkap dan waktu terbatas
7. Kolaborasi lintas instansi yang saling bersaing kepentingan
8. Whistleblowing: dilema melapor vs loyalitas kolega
9. Pelayanan publik kepada kelompok rentan dengan keterbatasan anggaran
10. Adaptasi terhadap kebijakan baru yang bertentangan dengan kebiasaan

DISTRIBUSI SKOR KETAT: {1,2,3,4,5} masing-masing TEPAT SATU opsi.

Output HANYA array JSON valid:
[{"id":1,"subtest":"TKP","subtestFull":"Tes Karakteristik Pribadi","tipe":"tkp",
"aspek":"nama aspek yang diukur",
"text":"skenario kompleks dengan dilema nyata",
"options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},
"nilaiOpsi":{"A":3,"B":5,"C":1,"D":4,"E":2},
"alasanSkor":{"A":"mengapa skor 3...","B":"mengapa skor 5 — terbaik karena...","C":"mengapa skor 1...","D":"mengapa skor 4...","E":"mengapa skor 2..."}}]`,

  SKB: `Anda adalah Tim Penyusun Soal Senior BKN spesialis SKB Akuntansi Pemerintahan tingkat EXPERT.

STANDAR EXPERT SKB AKUNTANSI:
- Tingkat kesulitan: SULIT dan SANGAT SULIT  
- 50% soal hitungan multi-langkah (jurnal, laporan keuangan, perhitungan pajak)
- 50% soal konseptual analitik (interpretasi standar, kasus audit, analisis kebijakan)
- DILARANG soal definisi sederhana atau pengertian dasar
- Semua referensi peraturan WAJIB masih berlaku per 2024

TOPIK EXPERT (rotasi ketat):
1. Jurnal akrual pemerintah: pengakuan pendapatan LO vs LRA, koreksi kesalahan
2. Konsolidasi laporan keuangan entitas pemerintah
3. Penyusutan aset tetap pemerintah: metode, nilai sisa, revaluasi
4. Perhitungan PPh 21 karyawan dengan PTKP, tunjangan, natura
5. PPN: faktur pajak, kredit pajak masukan, PKP threshold
6. Rekonsiliasi fiskal: koreksi positif/negatif, kompensasi kerugian
7. Analisis varians anggaran APBN/APBD, efisiensi, efektivitas
8. Temuan audit BPK: klasifikasi, rekomendasi, tindak lanjut
9. Sistem pengendalian internal: COSO framework dalam pemerintahan
10. Dana transfer daerah: DAU formula, DAK penggunaan, DBH perhitungan

WAJIB untuk soal hitungan:
- Sajikan data numerik yang realistis dan spesifik
- Tampilkan langkah penyelesaian lengkap di pembahasanSingkat
- Hitung ulang sebelum menetapkan kunci jawaban

Output HANYA array JSON valid:
[{"id":1,"subtest":"SKB","subtestFull":"Seleksi Kompetensi Bidang — Akuntansi","tipe":"pilihan_ganda",
"tingkatKesulitan":"sulit","jenissoal":"hitungan/konseptual",
"text":"soal kompleks dengan data lengkap",
"options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},
"kunciJawaban":"C",
"pembahasanSingkat":"Langkah penyelesaian detail atau analisis mendalam mengapa C benar",
"referensi":"PP/UU/Permendagri yang spesifik dan masih berlaku",
"nilai":{"benar":5,"salah":0}}]`,
};

const VALID = { skd:['TWK','TIU','TKP'], skb:['SKB'] };

// ─── Firebase ──────────────────────────────────────────────────
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

const FS_BASE = (pid) =>
  `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;

async function fsGet(col, doc) {
  const pid = process.env.FIREBASE_PROJECT_ID;
  if (!pid) return null;
  const token = await getToken();
  if (!token) return null;
  try {
    const r = await fetch(`${FS_BASE(pid)}/${col}/${doc}`,
      { headers:{ Authorization:`Bearer ${token}` } });
    if (!r.ok) return null;
    const d = await r.json();
    return d.fields?.data?.stringValue ? JSON.parse(d.fields.data.stringValue) : null;
  } catch { return null; }
}

async function fsSet(col, doc, data, extra={}) {
  const pid = process.env.FIREBASE_PROJECT_ID;
  if (!pid) return false;
  const token = await getToken();
  if (!token) return false;
  try {
    const fields = {
      data:    { stringValue: JSON.stringify(data) },
      savedAt: { stringValue: new Date().toISOString() },
    };
    Object.entries(extra).forEach(([k,v]) => {
      fields[k] = typeof v==='number' ? {integerValue:v} : {stringValue:String(v)};
    });
    const mask = Object.keys(fields).map(k=>`updateMask.fieldPaths=${k}`).join('&');
    const r = await fetch(`${FS_BASE(pid)}/${col}/${doc}?${mask}`, {
      method:'PATCH',
      headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ fields }),
    });
    return r.ok;
  } catch(e) { console.warn('fsSet error:', e.message); return false; }
}

// ─── Parse JSON ────────────────────────────────────────────────
function parseJSON(raw) {
  const clean = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
  let p = JSON.parse(clean);
  if (Array.isArray(p)) return p;
  const key = ['questions','soal','data','items'].find(k=>Array.isArray(p[k]))
    || Object.keys(p).find(k=>Array.isArray(p[k]));
  if (key) return p[key];
  throw new Error('Tidak ada array soal');
}

// ─── Generate dengan model fallback ───────────────────────────
async function generate(groq, subtest, count, batchIndex) {
  const models = process.env.GROQ_MODEL
    ? [process.env.GROQ_MODEL, ...MODELS.filter(m=>m!==process.env.GROQ_MODEL)]
    : MODELS;

  // Tambahkan instruksi anti-repetisi berdasarkan batchIndex
  const antiRepeat = batchIndex > 0
    ? `\nPENTING: Ini adalah batch ke-${batchIndex+1}. Buat soal dengan topik dan konteks yang BERBEDA TOTAL dari batch sebelumnya. Jangan ulangi konsep, tokoh, pasal, atau angka yang sudah pernah digunakan.`
    : '\nPENTING: Variasikan topik setiap soal. Tidak ada dua soal dengan konsep yang sama.';

  const userPrompt = `Buat tepat ${count} soal ${subtest} tingkat EXPERT/SANGAT SULIT untuk seleksi CPNS 2024-2025.${antiRepeat}\nOutput HANYA array JSON valid langsung tanpa teks pembuka atau penutup.`;

  let lastErr = null;
  for (const model of models) {
    try {
      console.log(`Trying: ${model} for ${subtest} batch ${batchIndex}`);
      const res = await groq.chat.completions.create({
        model,
        messages: [
          { role:'system', content: PROMPTS[subtest] },
          { role:'user',   content: userPrompt },
        ],
        temperature: 0.85, // Lebih tinggi untuk variasi lebih besar
        max_tokens:  7000,
        response_format: { type:'json_object' },
      });
      const raw = res.choices?.[0]?.message?.content || '';
      if (!raw) throw new Error('Empty response');
      const questions = parseJSON(raw);
      if (!questions.length) throw new Error('Empty array');
      console.log(`OK: ${model} → ${questions.length} soal`);
      return { questions, model };
    } catch(err) {
      if ([429,413,503].includes(err.status)) { lastErr=err; continue; }
      throw err;
    }
  }
  throw new Error('Semua model tidak tersedia: ' + lastErr?.message);
}

// ─── Main Handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method==='OPTIONS') return res.status(204).end();
  if (req.method!=='POST') return res.status(405).json({success:false,error:'Gunakan POST.'});

  const { examType, subtest, count:cRaw, batchIndex=0, forceNew=false } = req.body||{};
  const type  = (examType||'').toLowerCase();
  const sub   = (subtest||'').toUpperCase();
  const count = Math.min(15, Math.max(1, parseInt(cRaw||'10',10)));
  const bIdx  = parseInt(batchIndex)||0;

  if (!VALID[type])                return res.status(400).json({success:false,error:'"examType" harus "skd"/"skb".'});
  if (!VALID[type].includes(sub))  return res.status(400).json({success:false,error:`"subtest" harus: ${VALID[type].join(', ')}.`});

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({success:false,error:'GROQ_API_KEY belum diset.'});

  // Dokumen: soal_bank/skd_TWK_b0, skd_TWK_b1, dst.
  const docId = `${type}_${sub}_b${bIdx}`;

  // ── Cek database dulu ──────────────────────────────────────
  if (!forceNew) {
    const stored = await fsGet('soal_bank', docId);
    if (stored?.length) {
      console.log(`DB hit: ${docId} (${stored.length} soal)`);
      return res.status(200).json({
        success:true, examType:type, subtest:sub,
        count:stored.length, questions:stored, source:'database',
      });
    }
  }

  // ── Generate dari Groq ─────────────────────────────────────
  try {
    const groq = new Groq({ apiKey });
    const { questions, model } = await generate(groq, sub, count, bIdx);

    questions.forEach((q,i) => {
      q.id    = i + 1;
      q.nilai = q.nilai || {benar:5,salah:0};
    });

    // Simpan PERMANEN ke Firestore (async, tidak blokir response)
    fsSet('soal_bank', docId, questions, {
      examType:type, subtest:sub, batchIndex:bIdx, count:questions.length,
    }).then(ok => console.log(`DB ${ok?'saved':'FAIL'}: ${docId}`))
      .catch(e => console.warn('DB save error:', e.message));

    return res.status(200).json({
      success:true, examType:type, subtest:sub,
      count:questions.length, questions,
      source:'generated', modelUsed:model,
    });
  } catch(err) {
    console.error('Generate error:', err.message);
    if (err.status===401) return res.status(401).json({success:false,error:'GROQ_API_KEY tidak valid.'});
    return res.status(500).json({success:false,error:err.message});
  }
};
