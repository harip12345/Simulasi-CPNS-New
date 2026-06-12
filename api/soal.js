// api/soal.js — POST /api/soal
// Menerima { examType, subtest } dan generate soal untuk SATU subtest saja.
// Dipanggil berkali-kali dari frontend (satu request per subtest).
// Setiap request selesai < 15 detik, jauh di bawah limit Vercel 60 detik.

const { handleCors, sendSuccess, sendError, createGroqClient, safeParseJSON } = require('../lib/utils');

const SOAL_CONFIG = {
  skd: { TWK: 10, TIU: 10, TKP: 10 },
  skb: { SKB: 15 },
};

const MODEL = 'llama-3.1-8b-instant';

const SYSTEM_PROMPTS = {
  TWK: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Wawasan Kebangsaan (TWK).
Buat soal pilihan ganda berkualitas tinggi tentang: Pancasila, UUD 1945, NKRI, Bhinneka Tunggal Ika, sejarah kemerdekaan, sistem pemerintahan.
Aturan: satu jawaban benar objektif, 4 pengecoh masuk akal, bahasa Indonesia baku, referensi akurat.
Output HANYA array JSON tanpa markdown:
[{"id":1,"subtest":"TWK","subtestFull":"Tes Wawasan Kebangsaan","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"B","nilai":{"benar":5,"salah":0}}]`,

  TIU: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Intelejensi Umum (TIU).
Buat soal untuk: analogi kata, sinonim/antonim (KBBI), deret angka, aritmatika (jual-beli, kecepatan, persentase), silogisme.
Aturan: hitung ulang semua jawaban numerik, satu jawaban benar, pengecoh dekat dengan jawaban benar, bisa dikerjakan tanpa kalkulator.
Output HANYA array JSON tanpa markdown:
[{"id":1,"subtest":"TIU","subtestFull":"Tes Intelejensi Umum","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"C","nilai":{"benar":5,"salah":0}}]`,

  TKP: `Anda adalah pembuat soal CAT CPNS ahli untuk Tes Karakteristik Pribadi (TKP).
Buat skenario situasional ASN: pelayanan publik, integritas, kerja tim, inovasi, profesionalisme.
Aturan KETAT: semua 5 opsi masuk akal, skor {1,2,3,4,5} masing-masing tepat SATU opsi, skenario realistis di kantor pemerintahan.
Output HANYA array JSON tanpa markdown:
[{"id":1,"subtest":"TKP","subtestFull":"Tes Karakteristik Pribadi","tipe":"tkp","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"nilaiOpsi":{"A":3,"B":5,"C":1,"D":4,"E":2}}]`,

  SKB: `Anda adalah pembuat soal CAT CPNS ahli untuk Seleksi Kompetensi Bidang (SKB) administrasi ASN.
Buat soal tentang: UU ASN No.20/2023, manajemen kinerja, disiplin ASN, pelayanan publik, SAKIP, pengadaan barang/jasa.
Aturan: referensi peraturan masih berlaku, satu jawaban benar secara hukum, pengecoh meyakinkan tapi salah teknis.
Output HANYA array JSON tanpa markdown:
[{"id":1,"subtest":"SKB","subtestFull":"Seleksi Kompetensi Bidang","tipe":"pilihan_ganda","text":"...","options":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"kunciJawaban":"C","nilai":{"benar":5,"salah":0}}]`,
};

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendError(res, 'Gunakan POST.', 405);

  const { examType, subtest } = req.body || {};

  if (!examType || !['skd','skb'].includes(examType.toLowerCase())) {
    return sendError(res, '"examType" harus "skd" atau "skb".', 400);
  }

  const type    = examType.toLowerCase();
  const config  = SOAL_CONFIG[type];
  const validSubs = Object.keys(config);

  // Jika subtest tidak dikirim, ambil semua (tapi hanya untuk SKB yang cuma 1 subtest)
  const subtestKey = subtest ? subtest.toUpperCase() : validSubs[0];

  if (!validSubs.includes(subtestKey)) {
    return sendError(res, `"subtest" untuk ${type} harus salah satu dari: ${validSubs.join(', ')}.`, 400);
  }

  const count        = config[subtestKey];
  const systemPrompt = SYSTEM_PROMPTS[subtestKey];

  try {
    const groq  = createGroqClient();
    const model = process.env.GROQ_MODEL || MODEL;

    const completion = await groq.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `Buat tepat ${count} soal ${subtestKey} dengan topik yang bervariasi. Output HANYA array JSON valid.` },
      ],
      temperature: 0.7,
      max_tokens:  6000,
      response_format: { type: 'json_object' },
    });

    const raw  = completion.choices?.[0]?.message?.content || '';
    let parsed = safeParseJSON(raw);

    // Normalisasi ke array
    if (!Array.isArray(parsed)) {
      const key = ['questions','soal','data'].find(k => Array.isArray(parsed[k]))
        || Object.keys(parsed).find(k => Array.isArray(parsed[k]));
      parsed = key ? parsed[key] : [];
    }

    if (parsed.length === 0) throw new Error('Tidak ada soal yang dihasilkan.');

    // Tambah field nilai jika tidak ada
    parsed.forEach((q, i) => {
      q.id    = i + 1;
      q.nilai = q.nilai || { benar: 5, salah: 0 };
    });

    return sendSuccess(res, { examType: type, subtest: subtestKey, count: parsed.length, questions: parsed });

  } catch (err) {
    if (err.status === 429) return sendError(res, 'Rate limit Groq. Tunggu sebentar lalu coba lagi.', 429);
    if (err.status === 401) return sendError(res, 'GROQ_API_KEY tidak valid.', 401);
    return sendError(res, 'Gagal generate soal: ' + err.message, 500);
  }
};
