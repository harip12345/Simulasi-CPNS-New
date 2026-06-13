// api/leaderboard.js
// GET  /api/leaderboard?examType=skd  → ambil top 50 peserta
// POST /api/leaderboard               → simpan hasil ujian peserta

const crypto = require('crypto');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

async function getToken() {
  const { FIREBASE_CLIENT_EMAIL: email, FIREBASE_PRIVATE_KEY: key } = process.env;
  if (!email || !key) return null;
  try {
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

const BASE = (pid) =>
  `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;

// Simpan satu dokumen leaderboard
async function saveEntry(pid, token, entry) {
  const docId = `${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const fields = {
    nama:       { stringValue: entry.nama },
    examType:   { stringValue: entry.examType },
    totalSkor:  { integerValue: entry.totalSkor },
    skorTWK:    { integerValue: entry.skorTWK  || 0 },
    skorTIU:    { integerValue: entry.skorTIU  || 0 },
    skorTKP:    { integerValue: entry.skorTKP  || 0 },
    jumlahSoal: { integerValue: entry.jumlahSoal || 0 },
    lulusSkd:   { booleanValue: entry.lulusSkd || false },
    waktu:      { stringValue: new Date().toISOString() },
    device:     { stringValue: entry.device || 'unknown' },
  };
  const r = await fetch(`${BASE(pid)}/leaderboard/${docId}`, {
    method:'PATCH',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ fields }),
  });
  return r.ok ? docId : null;
}

// Ambil semua entri leaderboard, filter by examType, sort by totalSkor DESC
async function getEntries(pid, token, examType) {
  const url = `${BASE(pid)}/leaderboard?pageSize=200`;
  const r   = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
  if (!r.ok) return [];
  const data = await r.json();
  if (!data.documents) return [];

  return data.documents
    .map(doc => {
      const f = doc.fields || {};
      return {
        nama:       f.nama?.stringValue       || 'Anonim',
        examType:   f.examType?.stringValue   || 'skd',
        totalSkor:  parseInt(f.totalSkor?.integerValue || 0),
        skorTWK:    parseInt(f.skorTWK?.integerValue   || 0),
        skorTIU:    parseInt(f.skorTIU?.integerValue   || 0),
        skorTKP:    parseInt(f.skorTKP?.integerValue   || 0),
        jumlahSoal: parseInt(f.jumlahSoal?.integerValue || 0),
        lulusSkd:   f.lulusSkd?.booleanValue  || false,
        waktu:      f.waktu?.stringValue      || '',
      };
    })
    .filter(e => !examType || e.examType === examType)
    .sort((a,b) => b.totalSkor - a.totalSkor)
    .slice(0, 50);
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const pid = process.env.FIREBASE_PROJECT_ID;
  if (!pid) return res.status(500).json({ success:false, error:'Firebase tidak dikonfigurasi.' });

  const token = await getToken();
  if (!token) return res.status(500).json({ success:false, error:'Gagal autentikasi Firebase.' });

  // ── GET: ambil leaderboard ──────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { examType } = req.query;
      const entries = await getEntries(pid, token, examType);
      return res.status(200).json({ success:true, entries });
    } catch(e) {
      return res.status(500).json({ success:false, error: e.message });
    }
  }

  // ── POST: simpan hasil ujian ────────────────────────────────
  if (req.method === 'POST') {
    const { nama, examType, totalSkor, skorTWK, skorTIU, skorTKP, jumlahSoal, lulusSkd, device } = req.body || {};
    if (!nama || !examType || totalSkor === undefined) {
      return res.status(400).json({ success:false, error:'nama, examType, dan totalSkor wajib diisi.' });
    }
    try {
      const docId = await saveEntry(pid, token, { nama, examType, totalSkor, skorTWK, skorTIU, skorTKP, jumlahSoal, lulusSkd, device });
      return res.status(200).json({ success:true, docId });
    } catch(e) {
      return res.status(500).json({ success:false, error: e.message });
    }
  }

  return res.status(405).json({ success:false, error:'Method not allowed.' });
};
