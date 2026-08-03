/**
 * Vercel serverless function — GET /api/healthz
 * Simple liveness check: visit /api/healthz on your deployed URL to
 * confirm the API routes are deploying correctly (independent of whether
 * ANTHROPIC_API_KEY is set).
 */
module.exports = function handler(req, res) {
  res.status(200).json({ ok: true });
};
