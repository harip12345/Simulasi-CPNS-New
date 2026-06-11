// =============================================================================
// api/health.js — GET /api/health
//
// Endpoint untuk memverifikasi bahwa API berjalan dan environment terkonfigurasi
// dengan benar. Berguna untuk monitoring uptime (UptimeRobot, Better Uptime, dll).
// =============================================================================

const { handleCors, sendSuccess, sendError } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 'Method not allowed.', 405);
  }

  const checks = {
    api:         true,
    groqApiKey:  !!process.env.GROQ_API_KEY,
    groqModel:   process.env.GROQ_MODEL || 'llama-3.3-70b-versatile (default)',
    nodeVersion: process.version,
    environment: process.env.VERCEL_ENV || 'development',
    region:      process.env.VERCEL_REGION || 'unknown',
  };

  const allOk = checks.groqApiKey;

  if (!allOk) {
    return sendError(
      res,
      'Konfigurasi tidak lengkap. Periksa environment variables.',
      503
    );
  }

  return sendSuccess(res, {
    status:  'ok',
    message: 'CAT CPNS API berjalan normal.',
    checks,
  });
};
