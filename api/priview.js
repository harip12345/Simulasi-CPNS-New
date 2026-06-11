// =============================================================================
// api/preview.js — GET /api/preview?type=skd&subtest=TWK&count=2
//
// Endpoint untuk PREVIEW dan TESTING — generate soal dalam jumlah kecil
// untuk memverifikasi kualitas output sebelum integrasi ke frontend.
//
// Query params:
//   type    — 'skd' | 'skb'  (wajib)
//   subtest — 'TWK' | 'TIU' | 'TKP' | 'SKB'  (wajib)
//   count   — jumlah soal, 1–10  (opsional, default: 2)
//
// Contoh:
//   GET /api/preview?type=skd&subtest=TKP&count=3
//   GET /api/preview?type=skb&subtest=SKB&count=2
// =============================================================================

const {
  handleCors, sendSuccess, sendError,
  createGroqClient, safeParseJSON, validateQuestions,
} = require('../lib/utils');

const { SYSTEM_PROMPTS, buildUserPrompt } = require('../lib/prompts');

const VALID_SUBTESTS = {
  skd: ['TWK', 'TIU', 'TKP'],
  skb: ['SKB'],
};

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 'Method not allowed. Gunakan GET.', 405);
  }

  // ── Parse & validasi query params ──────────────────────────────────────────
  const { type, subtest, count: countRaw } = req.query;

  const normalizedType    = (type || '').toLowerCase();
  const normalizedSubtest = (subtest || '').toUpperCase();
  const count             = Math.min(10, Math.max(1, parseInt(countRaw || '2', 10)));

  if (!['skd', 'skb'].includes(normalizedType)) {
    return sendError(res, 'Query param "type" harus "skd" atau "skb".', 400);
  }

  const allowedSubtests = VALID_SUBTESTS[normalizedType];
  if (!allowedSubtests.includes(normalizedSubtest)) {
    return sendError(
      res,
      `Query param "subtest" untuk type="${normalizedType}" harus salah satu dari: ` +
      allowedSubtests.join(', ') + '.',
      400
    );
  }

  console.log(`[preview.js] Preview: type=${normalizedType} subtest=${normalizedSubtest} count=${count}`);

  try {
    const groq         = createGroqClient();
    const model        = process.env.GROQ_MODEL || DEFAULT_MODEL;
    const systemPrompt = SYSTEM_PROMPTS[normalizedSubtest];
    const userPrompt   = buildUserPrompt(normalizedSubtest, count);

    const completion = await groq.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      temperature:     0.7,
      max_tokens:      4096,
      top_p:           0.9,
      stream:          false,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Groq mengembalikan response kosong.');

    let parsed = safeParseJSON(raw);
    let questions = Array.isArray(parsed) ? parsed : (
      parsed.questions || parsed.soal || parsed.data ||
      parsed[Object.keys(parsed).find(k => Array.isArray(parsed[k]))]
    );

    if (!Array.isArray(questions)) {
      throw new Error('Output tidak mengandung array soal.');
    }

    // Validasi schema
    const tipeCheck = normalizedSubtest === 'TKP' ? 'tkp' : 'pg';
    validateQuestions(questions, tipeCheck);

    // Tambahkan metadata
    questions = questions.map((q, i) => ({ ...q, id: i + 1 }));

    return sendSuccess(res, {
      examType:  normalizedType,
      subtest:   normalizedSubtest,
      count:     questions.length,
      model,
      questions,
      // Tampilkan usage token untuk monitoring biaya
      usage: completion.usage || null,
    });

  } catch (err) {
    console.error('[preview.js] Error:', err.message);

    if (err.status === 429) return sendError(res, 'Rate limit Groq. Coba lagi.', 429);
    if (err.status === 401) return sendError(res, 'GROQ_API_KEY tidak valid.', 401);

    return sendError(res, 'Gagal generate preview: ' + err.message, 500);
  }
};
